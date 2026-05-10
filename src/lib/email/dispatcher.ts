import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';

import { withOrgContext, withSystemContext } from '@/lib/db/context';
import {
  appointments,
  authSignins,
  campaignStats,
  campaigns,
  calls,
  contacts,
  memberships,
  organizations,
  userNotificationPreferences,
  users,
} from '@/lib/db/schema';
import { sendEmail } from '@/lib/email';
import { hasRecentEmailSent, hasRecentEmailSentForRef } from '@/lib/email/idempotency';
import { renderAppointmentBookedEmail } from '@/lib/email/templates/appointment-booked';
import { renderCampaignCompletedEmail } from '@/lib/email/templates/campaign-completed';
import { renderLowBalanceEmail } from '@/lib/email/templates/low-balance';
import { renderMemberInviteEmail } from '@/lib/email/templates/member-invite';
import { renderQualifiedLeadEmail } from '@/lib/email/templates/qualified-lead';
import { renderSuspiciousLoginEmail } from '@/lib/email/templates/suspicious-login';
import { renderWeeklySummaryEmail } from '@/lib/email/templates/weekly-summary';
import { env } from '@/lib/env';
import { getBalance } from '@/lib/services/credit';
import {
  buildWeeklySummaryData,
  getWeeklySummaryRecipients,
  type WeeklySummaryRange,
} from '@/lib/services/weekly-summary';

// ─── Internal helpers ─────────────────────────────────────────────────────────

type OrgPrefKey =
  | 'appointment_booked'
  | 'qualified_lead'
  | 'low_credit'
  | 'campaign_completed'
  | 'weekly_summary';

const PREF_DEFAULTS: Record<OrgPrefKey, boolean> = {
  appointment_booked: true,
  qualified_lead: true,
  low_credit: true,
  campaign_completed: true,
  weekly_summary: false,
};

interface OrgRecipient {
  userId: string;
  email: string;
  fullName: string | null;
  locale: 'it' | 'en';
}

function prefColumn(key: OrgPrefKey) {
  return userNotificationPreferences[key];
}

async function getOrgOwnerRecipients(
  orgId: string,
  prefKey: OrgPrefKey,
): Promise<OrgRecipient[]> {
  return withSystemContext(async (tx) => {
    const rows = await tx
      .select({
        userId: users.id,
        email: users.email,
        fullName: users.full_name,
        locale: users.locale,
        prefEnabled: prefColumn(prefKey),
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.user_id))
      .leftJoin(
        userNotificationPreferences,
        and(
          eq(userNotificationPreferences.user_id, memberships.user_id),
          eq(userNotificationPreferences.org_id, memberships.org_id),
        ),
      )
      .where(
        and(
          eq(memberships.org_id, orgId),
          eq(memberships.role, 'owner'),
          isNotNull(memberships.accepted_at),
        ),
      );

    const defaultEnabled = PREF_DEFAULTS[prefKey];
    return rows
      .filter((r) => r.prefEnabled ?? defaultEnabled)
      .map((r) => ({
        userId: r.userId,
        email: r.email,
        fullName: r.fullName,
        locale: (r.locale === 'en' ? 'en' : 'it') as 'it' | 'en',
      }));
  });
}

function buildAbsoluteUrl(path: string): string {
  const base = env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') ?? '';
  return base ? `${base}${path}` : path;
}

function contactDisplayName(
  firstName: string | null,
  lastName: string | null,
  phone: string,
): string {
  const name = [firstName, lastName].filter(Boolean).join(' ').trim();
  return name || phone;
}

// ─── Dispatch functions ───────────────────────────────────────────────────────

export async function sendAppointmentBookedEmail(params: {
  orgId: string;
  appointmentId: string;
}): Promise<void> {
  if (await hasRecentEmailSentForRef('appointment-booked', params.appointmentId, 1)) return;

  const data = await withOrgContext(params.orgId, async (tx) => {
    const [row] = await tx
      .select({
        scheduledAt: appointments.scheduled_at,
        notes: appointments.notes,
        callId: appointments.call_id,
        contactFirstName: contacts.first_name,
        contactLastName: contacts.last_name,
        contactPhone: contacts.phone_e164,
        campaignName: campaigns.name,
        orgName: organizations.name,
      })
      .from(appointments)
      .innerJoin(contacts, eq(contacts.id, appointments.contact_id))
      .innerJoin(calls, eq(calls.id, appointments.call_id))
      .leftJoin(campaigns, eq(campaigns.id, calls.campaign_id))
      .innerJoin(organizations, eq(organizations.id, appointments.org_id))
      .where(
        and(eq(appointments.id, params.appointmentId), eq(appointments.org_id, params.orgId)),
      );
    return row;
  });

  if (!data) return;

  const recipients = await getOrgOwnerRecipients(params.orgId, 'appointment_booked');
  if (recipients.length === 0) return;

  const contactName = contactDisplayName(
    data.contactFirstName,
    data.contactLastName,
    data.contactPhone,
  );

  for (const recipient of recipients) {
    const { subject, html, text } = await renderAppointmentBookedEmail({
      locale: recipient.locale,
      ...(recipient.fullName ? { recipientName: recipient.fullName } : {}),
      orgName: data.orgName,
      contactName,
      scheduledAt: data.scheduledAt,
      campaignName: data.campaignName ?? '',
      ...(data.notes ? { transcriptSnippet: data.notes } : {}),
      callDetailUrl: buildAbsoluteUrl(`/calls/${data.callId}`),
      preferencesUrl: buildAbsoluteUrl('/settings/notifications'),
      appUrl: buildAbsoluteUrl('/'),
    });

    await sendEmail({
      to: recipient.email,
      subject,
      html,
      text,
      tags: [
        { name: 'template', value: 'appointment-booked' },
        { name: 'org_id', value: params.orgId },
        { name: 'ref_id', value: params.appointmentId },
      ],
    });
  }
}

export async function sendQualifiedLeadEmail(params: {
  orgId: string;
  callId: string;
}): Promise<void> {
  if (await hasRecentEmailSentForRef('qualified-lead', params.callId, 1)) return;

  const data = await withOrgContext(params.orgId, async (tx) => {
    const [row] = await tx
      .select({
        contactFirstName: contacts.first_name,
        contactLastName: contacts.last_name,
        contactPhone: contacts.phone_e164,
        contactEmail: contacts.email,
        campaignName: campaigns.name,
        orgName: organizations.name,
      })
      .from(calls)
      .leftJoin(contacts, eq(contacts.id, calls.contact_id))
      .leftJoin(campaigns, eq(campaigns.id, calls.campaign_id))
      .innerJoin(organizations, eq(organizations.id, calls.org_id))
      .where(and(eq(calls.id, params.callId), eq(calls.org_id, params.orgId)));
    return row;
  });

  if (!data || !data.contactPhone) return;

  const recipients = await getOrgOwnerRecipients(params.orgId, 'qualified_lead');
  if (recipients.length === 0) return;

  const contactName = contactDisplayName(
    data.contactFirstName,
    data.contactLastName,
    data.contactPhone,
  );

  for (const recipient of recipients) {
    const { subject, html, text } = await renderQualifiedLeadEmail({
      locale: recipient.locale,
      ...(recipient.fullName ? { recipientName: recipient.fullName } : {}),
      orgName: data.orgName,
      contactName,
      contactPhone: data.contactPhone,
      ...(data.contactEmail ? { contactEmail: data.contactEmail } : {}),
      campaignName: data.campaignName ?? '',
      callDetailUrl: buildAbsoluteUrl(`/calls/${params.callId}`),
      preferencesUrl: buildAbsoluteUrl('/settings/notifications'),
      appUrl: buildAbsoluteUrl('/'),
    });

    await sendEmail({
      to: recipient.email,
      subject,
      html,
      text,
      tags: [
        { name: 'template', value: 'qualified-lead' },
        { name: 'org_id', value: params.orgId },
        { name: 'ref_id', value: params.callId },
      ],
    });
  }
}

export async function sendLowBalanceEmail(params: { orgId: string }): Promise<void> {
  if (await hasRecentEmailSent(params.orgId, 'low-balance', 24)) return;

  const orgRow = await withOrgContext(params.orgId, async (tx) => {
    const [row] = await tx
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, params.orgId));
    return row;
  });

  if (!orgRow) return;

  const { remainingMinutes } = await getBalance(params.orgId);

  const avgDailyMinutes = await withOrgContext(params.orgId, async (tx) => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [row] = await tx
      .select({
        totalSeconds: sql<number>`COALESCE(SUM(${calls.billable_seconds}), 0)::int`,
      })
      .from(calls)
      .where(
        and(
          eq(calls.org_id, params.orgId),
          gte(calls.created_at, sevenDaysAgo),
          isNotNull(calls.billable_seconds),
        ),
      );
    return Math.floor((row?.totalSeconds ?? 0) / 60 / 7);
  });

  const estimatedDaysRemaining =
    avgDailyMinutes > 0 ? Math.floor(remainingMinutes / avgDailyMinutes) : 0;

  const recipients = await getOrgOwnerRecipients(params.orgId, 'low_credit');
  if (recipients.length === 0) return;

  for (const recipient of recipients) {
    const { subject, html, text } = await renderLowBalanceEmail({
      locale: recipient.locale,
      ...(recipient.fullName ? { recipientName: recipient.fullName } : {}),
      orgName: orgRow.name,
      remainingMinutes,
      avgDailyMinutes,
      estimatedDaysRemaining,
      topupUrl: buildAbsoluteUrl('/credit/topup'),
      preferencesUrl: buildAbsoluteUrl('/settings/notifications'),
      appUrl: buildAbsoluteUrl('/'),
    });

    await sendEmail({
      to: recipient.email,
      subject,
      html,
      text,
      tags: [
        { name: 'template', value: 'low-balance' },
        { name: 'org_id', value: params.orgId },
      ],
    });
  }
}

export async function sendCampaignCompletedEmail(params: {
  orgId: string;
  campaignId: string;
}): Promise<void> {
  if (await hasRecentEmailSentForRef('campaign-completed', params.campaignId, 1)) return;

  const data = await withOrgContext(params.orgId, async (tx) => {
    const [row] = await tx
      .select({
        campaignName: campaigns.name,
        orgName: organizations.name,
        totalCalls: campaignStats.total_calls,
        completedCalls: campaignStats.completed_calls,
        failedCalls: campaignStats.failed_calls,
        appointmentsBooked: campaignStats.outcome_appointment_booked,
        qualifiedLeads: sql<number>`(${campaignStats.outcome_interested} + ${campaignStats.outcome_appointment_booked})::int`,
        totalCostCents: campaignStats.total_cost_cents,
        totalBilledSeconds: campaignStats.total_billed_seconds,
      })
      .from(campaigns)
      .leftJoin(campaignStats, eq(campaignStats.campaign_id, campaigns.id))
      .innerJoin(organizations, eq(organizations.id, campaigns.org_id))
      .where(and(eq(campaigns.id, params.campaignId), eq(campaigns.org_id, params.orgId)));
    return row;
  });

  if (!data) return;

  const completedCalls = data.completedCalls ?? 0;
  const avgDurationSeconds =
    completedCalls > 0 ? Math.floor((data.totalBilledSeconds ?? 0) / completedCalls) : 0;

  const recipients = await getOrgOwnerRecipients(params.orgId, 'campaign_completed');
  if (recipients.length === 0) return;

  for (const recipient of recipients) {
    const { subject, html, text } = await renderCampaignCompletedEmail({
      locale: recipient.locale,
      ...(recipient.fullName ? { recipientName: recipient.fullName } : {}),
      orgName: data.orgName,
      campaignName: data.campaignName,
      totalCalls: data.totalCalls ?? 0,
      completedCalls,
      failedCalls: data.failedCalls ?? 0,
      qualifiedLeads: data.qualifiedLeads ?? 0,
      appointments: data.appointmentsBooked ?? 0,
      totalCostCents: data.totalCostCents ?? 0,
      avgDurationSeconds,
      campaignUrl: buildAbsoluteUrl(`/campaigns/${params.campaignId}`),
      reportDownloadUrl: buildAbsoluteUrl(`/campaigns/${params.campaignId}`),
      preferencesUrl: buildAbsoluteUrl('/settings/notifications'),
      appUrl: buildAbsoluteUrl('/'),
    });

    await sendEmail({
      to: recipient.email,
      subject,
      html,
      text,
      tags: [
        { name: 'template', value: 'campaign-completed' },
        { name: 'org_id', value: params.orgId },
        { name: 'ref_id', value: params.campaignId },
      ],
    });
  }
}

export async function sendWeeklySummaryEmail(params: {
  orgId: string;
  weekStart: Date;
}): Promise<void> {
  const weekEnd = new Date(params.weekStart.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
  const range: WeeklySummaryRange = {
    start: params.weekStart,
    end: weekEnd,
    weekStart: params.weekStart,
    weekEnd,
  };

  const orgRow = await withSystemContext(async (tx) => {
    const [row] = await tx
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, params.orgId));
    return row;
  });

  if (!orgRow) return;

  const [summaryData, recipients] = await Promise.all([
    buildWeeklySummaryData(params.orgId, orgRow.name, range),
    getWeeklySummaryRecipients(params.orgId),
  ]);

  for (const recipient of recipients) {
    const { subject, html, text } = await renderWeeklySummaryEmail({
      locale: recipient.locale,
      ...(recipient.fullName ? { recipientName: recipient.fullName } : {}),
      orgName: summaryData.orgName,
      weekStart: summaryData.weekStart,
      weekEnd: summaryData.weekEnd,
      totalCalls: summaryData.totalCalls,
      completedCalls: summaryData.completedCalls,
      failedCalls: summaryData.failedCalls,
      qualifiedLeads: summaryData.qualifiedLeads,
      appointments: summaryData.appointments,
      topCampaigns: summaryData.topCampaigns,
      alerts: summaryData.alerts,
      dashboardUrl: buildAbsoluteUrl('/dashboard'),
      preferencesUrl: buildAbsoluteUrl('/settings/notifications'),
      appUrl: buildAbsoluteUrl('/'),
    });

    await sendEmail({
      to: recipient.email,
      subject,
      html,
      text,
      tags: [
        { name: 'template', value: 'weekly-summary' },
        { name: 'org_id', value: params.orgId },
      ],
    });
  }
}

export async function sendMemberInviteEmail(params: {
  orgId: string;
  membershipId: string;
}): Promise<void> {
  const data = await withSystemContext(async (tx) => {
    const [row] = await tx
      .select({
        inviteeEmail: users.email,
        inviteeFullName: users.full_name,
        inviteeLocale: users.locale,
        role: memberships.role,
        orgName: organizations.name,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.user_id))
      .innerJoin(organizations, eq(organizations.id, memberships.org_id))
      .where(
        and(eq(memberships.id, params.membershipId), eq(memberships.org_id, params.orgId)),
      );
    return row;
  });

  if (!data) return;

  const locale = (data.inviteeLocale === 'en' ? 'en' : 'it') as 'it' | 'en';
  const inviterFallback = locale === 'en' ? 'A team member' : 'Un membro del team';

  const { subject, html, text } = await renderMemberInviteEmail({
    locale,
    orgName: data.orgName,
    inviterName: inviterFallback,
    role: data.role,
    acceptUrl: buildAbsoluteUrl('/login'),
    ...(data.inviteeFullName ? { recipientName: data.inviteeFullName } : {}),
    appUrl: buildAbsoluteUrl('/'),
  });

  await sendEmail({
    to: data.inviteeEmail,
    subject,
    html,
    text,
    tags: [
      { name: 'template', value: 'member-invite' },
      { name: 'org_id', value: params.orgId },
      { name: 'ref_id', value: params.membershipId },
    ],
  });
}

export async function sendSuspiciousLoginEmail(params: {
  userId: string;
  signinId: string;
}): Promise<void> {
  const data = await withSystemContext(async (tx) => {
    const [row] = await tx
      .select({
        email: users.email,
        locale: users.locale,
        ip: authSignins.ip,
        userAgent: authSignins.user_agent,
        signinAt: authSignins.signed_in_at,
      })
      .from(authSignins)
      .innerJoin(users, eq(users.id, authSignins.user_id))
      .where(
        and(eq(authSignins.id, params.signinId), eq(authSignins.user_id, params.userId)),
      );
    return row;
  });

  if (!data) return;

  const locale = (data.locale === 'en' ? 'en' : 'it') as 'it' | 'en';

  const uaSummary = data.userAgent
    ? data.userAgent.length > 120
      ? data.userAgent.slice(0, 117) + '...'
      : data.userAgent
    : locale === 'en'
      ? 'Unknown device'
      : 'Dispositivo sconosciuto';

  const { subject, html, text } = await renderSuspiciousLoginEmail({
    locale,
    userEmail: data.email,
    occurredAt: data.signinAt,
    ip: data.ip,
    userAgentSummary: uaSummary,
    revokeUrl: buildAbsoluteUrl('/settings/security'),
    appUrl: buildAbsoluteUrl('/'),
  });

  await sendEmail({
    to: data.email,
    subject,
    html,
    text,
    tags: [
      { name: 'template', value: 'suspicious-login' },
      { name: 'ref_id', value: params.signinId },
    ],
  });
}

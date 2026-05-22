import { and, desc, eq, isNotNull } from 'drizzle-orm';

import { withOrgContext } from '@/lib/db/context';
import { appointments, calls, campaignStats, campaigns, contacts, scripts } from '@/lib/db/schema';
import { formatBilledDuration, maskPhoneLast4 } from '@/lib/utils/format';

export { formatBilledDuration, maskPhoneLast4 };

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface PrintReportOutcomeBreakdown {
  appointmentBooked: number;
  interested: number;
  notInterested: number;
  callback: number;
  voicemail: number;
  wrongNumber: number;
  doNotCall: number;
}

export interface PrintReportTopAppointment {
  id: string;
  contactName: string;
  phoneE164: string | null;
  scheduledAt: Date;
  notes: string | null;
}

export interface PrintReportData {
  campaign: {
    id: string;
    name: string;
    status: string;
    scriptName: string | null;
    createdAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
  };
  totals: {
    totalCalls: number;
    completedCalls: number;
    failedCalls: number;
    qualifiedLeads: number;
    appointmentsBooked: number;
    totalBilledSeconds: number;
    totalCostCents: number;
  };
  outcomes: PrintReportOutcomeBreakdown;
  topAppointments: PrintReportTopAppointment[];
}

const TOP_APPOINTMENTS_LIMIT = 20;

/**
 * Loads everything required to render the print-friendly campaign report.
 *
 * Returns null if the campaign is not visible to the caller's org. All reads
 * happen inside a single org-scoped transaction so RLS is enforced and the
 * round-trip count is minimised.
 */
export async function getCampaignPrintReport(
  orgId: string,
  campaignId: string,
): Promise<PrintReportData | null> {
  return withOrgContext(orgId, async (tx) => {
    const [campaignRow] = await tx
      .select({
        id: campaigns.id,
        name: campaigns.name,
        status: campaigns.status,
        scriptName: scripts.name,
        createdAt: campaigns.created_at,
        startedAt: campaigns.started_at,
        completedAt: campaigns.completed_at,
      })
      .from(campaigns)
      .leftJoin(scripts, eq(scripts.id, campaigns.script_id))
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.org_id, orgId)));

    if (!campaignRow) return null;

    const [statsRow] = await tx
      .select()
      .from(campaignStats)
      .where(and(eq(campaignStats.campaign_id, campaignId), eq(campaignStats.org_id, orgId)));

    const apptRows = await tx
      .select({
        id: appointments.id,
        scheduledAt: appointments.scheduled_at,
        notes: appointments.notes,
        firstName: contacts.first_name,
        lastName: contacts.last_name,
        phoneE164: contacts.phone_e164,
      })
      .from(appointments)
      .innerJoin(calls, eq(calls.id, appointments.call_id))
      .innerJoin(contacts, eq(contacts.id, appointments.contact_id))
      .where(
        and(
          eq(appointments.org_id, orgId),
          isNotNull(calls.campaign_id),
          eq(calls.campaign_id, campaignId),
        ),
      )
      .orderBy(desc(appointments.scheduled_at))
      .limit(TOP_APPOINTMENTS_LIMIT);

    const completedCalls = statsRow?.completed_calls ?? 0;
    const appointmentsBooked = statsRow?.outcome_appointment_booked ?? 0;
    const interested = statsRow?.outcome_interested ?? 0;

    return {
      campaign: {
        id: campaignRow.id,
        name: campaignRow.name,
        status: campaignRow.status,
        scriptName: campaignRow.scriptName,
        createdAt: campaignRow.createdAt,
        startedAt: campaignRow.startedAt,
        completedAt: campaignRow.completedAt,
      },
      totals: {
        totalCalls: statsRow?.total_calls ?? 0,
        completedCalls,
        failedCalls: statsRow?.failed_calls ?? 0,
        qualifiedLeads: interested + appointmentsBooked,
        appointmentsBooked,
        totalBilledSeconds: statsRow?.total_billed_seconds ?? 0,
        totalCostCents: statsRow?.total_cost_cents ?? 0,
      },
      outcomes: {
        appointmentBooked: appointmentsBooked,
        interested,
        notInterested: statsRow?.outcome_not_interested ?? 0,
        callback: statsRow?.outcome_callback ?? 0,
        voicemail: statsRow?.outcome_voicemail ?? 0,
        wrongNumber: statsRow?.outcome_wrong_number ?? 0,
        doNotCall: statsRow?.outcome_do_not_call ?? 0,
      },
      topAppointments: apptRows.map((r) => {
        const fullName = [r.firstName, r.lastName].filter(Boolean).join(' ').trim();
        return {
          id: r.id,
          contactName: fullName || (r.phoneE164 ?? ''),
          phoneE164: r.phoneE164,
          scheduledAt: r.scheduledAt,
          notes: r.notes,
        };
      }),
    };
  });
}

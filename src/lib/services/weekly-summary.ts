import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import { recordAudit } from '@/lib/db/audit';
import { type DbTx, withOrgContext, withSystemContext } from '@/lib/db/context';
import {
  appointments,
  calls,
  campaigns,
  memberships,
  organizations,
  users,
} from '@/lib/db/schema';
import { sendEmail } from '@/lib/email';
import { hasRecentEmailSentForRef } from '@/lib/email/idempotency';
import {
  type WeeklySummaryAlert,
  type WeeklySummaryLocale,
  type WeeklySummaryTopCampaign,
  renderWeeklySummaryEmail,
} from '@/lib/email/templates/weekly-summary';
import { env } from '@/lib/env';
import { logger } from '@/lib/observability/logger';
import { filterRecipientsByPreference } from '@/lib/services/notification-preferences';

const REPORT_TIMEZONE = 'Europe/Rome';
const TOP_CAMPAIGNS_LIMIT = 5;
const RATE_LIMIT_PER_SECOND = 10;
const HIGH_FAILURE_RATE_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface WeeklySummaryRange {
  start: Date;
  end: Date;
  weekStart: Date;
  weekEnd: Date;
}

export interface WeeklySummaryRecipient {
  userId: string;
  email: string;
  fullName: string | null;
  locale: WeeklySummaryLocale;
}

export interface WeeklySummaryData {
  orgId: string;
  orgName: string;
  weekStart: Date;
  weekEnd: Date;
  totalCalls: number;
  completedCalls: number;
  failedCalls: number;
  qualifiedLeads: number;
  appointments: number;
  topCampaigns: WeeklySummaryTopCampaign[];
  alerts: WeeklySummaryAlert[];
}

export interface WeeklySummaryOrgOutcome {
  orgId: string;
  orgName: string;
  status: 'sent' | 'skipped_no_recipients' | 'failed';
  recipientCount: number;
  emailsSent: number;
  error?: string;
}

export interface WeeklySummaryRunResult {
  range: WeeklySummaryRange;
  orgsConsidered: number;
  orgsProcessed: number;
  orgsSkipped: number;
  orgsFailed: number;
  emailsSent: number;
  outcomes: WeeklySummaryOrgOutcome[];
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface RunWeeklySummaryOptions {
  now?: Date;
  ratePerSecond?: number;
  mailer?: typeof sendEmail;
  sleep?: (ms: number) => Promise<void>;
  deps?: Partial<WeeklySummaryDeps>;
}

interface WeeklySummaryDeps {
  listActiveOrgs: (range: WeeklySummaryRange) => Promise<ActiveOrgRow[]>;
  buildData: (
    orgId: string,
    orgName: string,
    range: WeeklySummaryRange,
  ) => Promise<WeeklySummaryData>;
  listRecipients: (orgId: string) => Promise<WeeklySummaryRecipient[]>;
  writeAudit: (
    orgId: string,
    outcome: AuditOutcome,
    metadata: Record<string, unknown>,
  ) => Promise<void>;
}

export async function runWeeklySummary(
  options: RunWeeklySummaryOptions = {},
): Promise<WeeklySummaryRunResult> {
  const now = options.now ?? new Date();
  const ratePerSecond = options.ratePerSecond ?? RATE_LIMIT_PER_SECOND;
  const mailer = options.mailer ?? sendEmail;
  const sleep = options.sleep ?? defaultSleep;
  const deps: WeeklySummaryDeps = {
    listActiveOrgs: fetchActiveOrgs,
    buildData: buildWeeklySummaryData,
    listRecipients: getWeeklySummaryRecipients,
    writeAudit,
    ...(options.deps ?? {}),
  };

  const range = computeLastWeekRange(now);
  const orgRows = await deps.listActiveOrgs(range);

  const limiter = createRateLimiter(ratePerSecond, sleep);

  const outcomes: WeeklySummaryOrgOutcome[] = [];
  let emailsSent = 0;
  let orgsProcessed = 0;
  let orgsSkipped = 0;
  let orgsFailed = 0;

  for (const org of orgRows) {
    try {
      const data = await deps.buildData(org.id, org.name, range);
      const recipients = await deps.listRecipients(org.id);

      if (recipients.length === 0) {
        outcomes.push({
          orgId: org.id,
          orgName: org.name,
          status: 'skipped_no_recipients',
          recipientCount: 0,
          emailsSent: 0,
        });
        await deps.writeAudit(org.id, 'skipped_no_recipients', {
          totalCalls: data.totalCalls,
        });
        orgsSkipped++;
        continue;
      }

      let sent = 0;
      for (const recipient of recipients) {
        await limiter.acquire();
        try {
          await dispatchOne(mailer, data, recipient);
          sent++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          void logger.error('[weekly-summary] recipient failed', {
            org_id: org.id,
            user_id: recipient.userId,
            error: msg,
          });
        }
      }

      outcomes.push({
        orgId: org.id,
        orgName: org.name,
        status: 'sent',
        recipientCount: recipients.length,
        emailsSent: sent,
      });
      emailsSent += sent;
      orgsProcessed++;
      await deps.writeAudit(org.id, 'sent', {
        recipients: sent,
        totalCalls: data.totalCalls,
        appointments: data.appointments,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void logger.error('[weekly-summary] org failed', { org_id: org.id, error: message });
      outcomes.push({
        orgId: org.id,
        orgName: org.name,
        status: 'failed',
        recipientCount: 0,
        emailsSent: 0,
        error: message,
      });
      orgsFailed++;
      await deps.writeAudit(org.id, 'failed', { error: message }).catch(() => undefined);
    }
  }

  return {
    range,
    orgsConsidered: orgRows.length,
    orgsProcessed,
    orgsSkipped,
    orgsFailed,
    emailsSent,
    outcomes,
  };
}

// ---------------------------------------------------------------------------
// Data shaping
// ---------------------------------------------------------------------------

export async function buildWeeklySummaryData(
  orgId: string,
  orgName: string,
  range: WeeklySummaryRange,
): Promise<WeeklySummaryData> {
  return withOrgContext(orgId, async (tx) => {
    const [callRow, apptRow, topCampaigns, campaignStats] = await Promise.all([
      kpiCallAggregates(tx, orgId, range),
      kpiAppointmentsBooked(tx, orgId, range),
      topCampaignsForRange(tx, orgId, range),
      allCampaignStats(tx, orgId, range),
    ]);

    const totalCalls = callRow?.total ?? 0;
    const completedCalls = callRow?.completed ?? 0;
    const failedCalls = callRow?.failed ?? 0;
    const qualifiedLeads = callRow?.qualified ?? 0;
    const appointmentsBooked = apptRow?.booked ?? 0;

    const alerts = buildAlerts(campaignStats);

    return {
      orgId,
      orgName,
      weekStart: range.weekStart,
      weekEnd: range.weekEnd,
      totalCalls,
      completedCalls,
      failedCalls,
      qualifiedLeads,
      appointments: appointmentsBooked,
      topCampaigns,
      alerts,
    };
  });
}

async function kpiCallAggregates(
  tx: DbTx,
  orgId: string,
  range: WeeklySummaryRange,
): Promise<{ total: number; completed: number; failed: number; qualified: number } | undefined> {
  const [row] = await tx
    .select({
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${calls.status} = 'completed')::int`,
      failed: sql<number>`count(*) filter (where ${calls.status} = 'failed')::int`,
      qualified: sql<number>`count(*) filter (where ${calls.outcome} in ('interested','appointment_booked'))::int`,
    })
    .from(calls)
    .where(
      and(
        eq(calls.org_id, orgId),
        gte(calls.created_at, range.start),
        lte(calls.created_at, range.end),
      ),
    );
  return row;
}

async function kpiAppointmentsBooked(
  tx: DbTx,
  orgId: string,
  range: WeeklySummaryRange,
): Promise<{ booked: number } | undefined> {
  const [row] = await tx
    .select({ booked: sql<number>`count(*)::int` })
    .from(appointments)
    .where(
      and(
        eq(appointments.org_id, orgId),
        gte(appointments.created_at, range.start),
        lte(appointments.created_at, range.end),
      ),
    );
  return row;
}

async function topCampaignsForRange(
  tx: DbTx,
  orgId: string,
  range: WeeklySummaryRange,
): Promise<WeeklySummaryTopCampaign[]> {
  const rows = await tx
    .select({
      id: campaigns.id,
      name: campaigns.name,
      calls: sql<number>`count(${calls.id})::int`,
      appointments: sql<number>`count(${calls.id}) filter (where ${calls.outcome} = 'appointment_booked')::int`,
      qualifiedLeads: sql<number>`count(${calls.id}) filter (where ${calls.outcome} in ('interested','appointment_booked'))::int`,
    })
    .from(calls)
    .innerJoin(campaigns, eq(campaigns.id, calls.campaign_id))
    .where(
      and(
        eq(calls.org_id, orgId),
        gte(calls.created_at, range.start),
        lte(calls.created_at, range.end),
      ),
    )
    .groupBy(campaigns.id, campaigns.name)
    .orderBy(
      desc(sql`count(${calls.id}) filter (where ${calls.outcome} = 'appointment_booked')`),
      desc(sql`count(${calls.id})`),
    )
    .limit(TOP_CAMPAIGNS_LIMIT);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    calls: r.calls ?? 0,
    appointments: r.appointments ?? 0,
    qualifiedLeads: r.qualifiedLeads ?? 0,
  }));
}

interface CampaignStatRow {
  id: string;
  name: string;
  total: number;
  failed: number;
}

async function allCampaignStats(
  tx: DbTx,
  orgId: string,
  range: WeeklySummaryRange,
): Promise<CampaignStatRow[]> {
  const rows = await tx
    .select({
      id: campaigns.id,
      name: campaigns.name,
      total: sql<number>`count(${calls.id})::int`,
      failed: sql<number>`count(${calls.id}) filter (where ${calls.status} = 'failed')::int`,
    })
    .from(calls)
    .innerJoin(campaigns, eq(campaigns.id, calls.campaign_id))
    .where(
      and(
        eq(calls.org_id, orgId),
        gte(calls.created_at, range.start),
        lte(calls.created_at, range.end),
      ),
    )
    .groupBy(campaigns.id, campaigns.name);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    total: r.total ?? 0,
    failed: r.failed ?? 0,
  }));
}

function buildAlerts(campaignStats: CampaignStatRow[]): WeeklySummaryAlert[] {
  const alerts: WeeklySummaryAlert[] = [];
  for (const c of campaignStats) {
    if (c.total > 0 && c.failed / c.total >= HIGH_FAILURE_RATE_THRESHOLD) {
      alerts.push({
        type: 'warning',
        campaignName: c.name,
        failed: c.failed,
        total: c.total,
      });
    }
  }
  return alerts;
}

// ---------------------------------------------------------------------------
// Org / recipient resolution
// ---------------------------------------------------------------------------

interface ActiveOrgRow {
  id: string;
  name: string;
}

async function fetchActiveOrgs(range: WeeklySummaryRange): Promise<ActiveOrgRow[]> {
  return withSystemContext(async (tx) => {
    const activeIds = await tx
      .selectDistinct({ org_id: calls.org_id })
      .from(calls)
      .where(and(gte(calls.created_at, range.start), lte(calls.created_at, range.end)));

    const ids = activeIds.map((r) => r.org_id);
    if (ids.length === 0) return [];

    const rows = await tx
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(
        and(
          inArray(organizations.id, ids),
          sql`${organizations.deleted_at} IS NULL`,
        ),
      )
      .orderBy(organizations.id);
    return rows;
  });
}

export async function getWeeklySummaryRecipients(
  orgId: string,
): Promise<WeeklySummaryRecipient[]> {
  return withSystemContext(async (tx) => {
    const rows = await tx
      .select({
        userId: users.id,
        email: users.email,
        fullName: users.full_name,
        locale: users.locale,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.user_id))
      .where(
        and(
          eq(memberships.org_id, orgId),
          eq(memberships.role, 'owner'),
          sql`${memberships.accepted_at} IS NOT NULL`,
        ),
      );

    if (rows.length === 0) return [];

    const eligibleIds = new Set(
      await filterRecipientsByPreference(
        tx,
        orgId,
        rows.map((r) => r.userId),
        'weekly_summary',
      ),
    );

    return rows
      .filter((r) => eligibleIds.has(r.userId))
      .map((r) => ({
        userId: r.userId,
        email: r.email,
        fullName: r.fullName,
        locale: (r.locale === 'en' ? 'en' : 'it') as WeeklySummaryLocale,
      }));
  });
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function dispatchOne(
  mailer: typeof sendEmail,
  data: WeeklySummaryData,
  recipient: WeeklySummaryRecipient,
): Promise<void> {
  const { subject, html, text } = await renderWeeklySummaryEmail({
    locale: recipient.locale,
    orgName: data.orgName,
    weekStart: data.weekStart,
    weekEnd: data.weekEnd,
    totalCalls: data.totalCalls,
    completedCalls: data.completedCalls,
    failedCalls: data.failedCalls,
    qualifiedLeads: data.qualifiedLeads,
    appointments: data.appointments,
    topCampaigns: data.topCampaigns,
    alerts: data.alerts,
    dashboardUrl: buildAbsoluteUrl('/dashboard'),
    preferencesUrl: buildAbsoluteUrl('/settings/notifications'),
    ...(recipient.fullName ? { recipientName: recipient.fullName } : {}),
    appUrl: buildAbsoluteUrl('/'),
  });

  if (await hasRecentEmailSentForRef('weekly-summary', recipient.userId, 168)) return;

  await mailer({
    to: recipient.email,
    subject,
    html,
    text,
    tags: [
      { name: 'template', value: 'weekly-summary' },
      { name: 'org_id', value: data.orgId },
      { name: 'ref_id', value: recipient.userId },
    ],
  });
}

function buildAbsoluteUrl(path: string): string {
  const base = env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') ?? '';
  if (!base) return path;
  return `${base}${path}`;
}

// ---------------------------------------------------------------------------
// Audit logging
// ---------------------------------------------------------------------------

type AuditOutcome = 'sent' | 'skipped_no_recipients' | 'failed';

const AUDIT_ACTION: Record<AuditOutcome, string> = {
  sent: 'notification.weekly_summary_sent',
  skipped_no_recipients: 'notification.weekly_summary_skipped',
  failed: 'notification.weekly_summary_failed',
};

async function writeAudit(
  orgId: string,
  outcome: AuditOutcome,
  metadata: Record<string, unknown>,
): Promise<void> {
  await withOrgContext(orgId, async (tx) => {
    await recordAudit(tx, {
      orgId,
      actorType: 'system',
      action: AUDIT_ACTION[outcome],
      subjectType: 'org',
      subjectId: orgId,
      metadata,
    });
  });
}

// ---------------------------------------------------------------------------
// Time-window helpers
// ---------------------------------------------------------------------------

/**
 * Returns the UTC instants framing the previous Monday–Sunday week in
 * Europe/Rome. When called on a Monday (the cron day), this resolves to
 * the week that just ended at midnight.
 */
export function computeLastWeekRange(now: Date): WeeklySummaryRange {
  // Get current weekday in Rome timezone (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
  const romeParts = parseRomeDateParts(now);
  const nowUtcMidnight = Date.UTC(romeParts.year, romeParts.month - 1, romeParts.day);

  // ISO weekday: 1 = Mon, 7 = Sun
  const probe = new Date(nowUtcMidnight);
  const dayOfWeek = probe.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  // Compute days since last Monday (ISO Mon=1)
  const isoDay = dayOfWeek === 0 ? 7 : dayOfWeek;
  // Days to go back to reach last Monday's start
  const daysToLastMonday = isoDay - 1 + 7; // go back 7 more to get previous week's Monday
  const daysToLastSunday = isoDay; // go back isoDay days to reach last Sunday

  const lastSundayUtcMidnight = nowUtcMidnight - daysToLastSunday * 86_400_000;
  const lastMondayUtcMidnight = nowUtcMidnight - daysToLastMonday * 86_400_000;

  const ls = extractYMD(new Date(lastSundayUtcMidnight));
  const lm = extractYMD(new Date(lastMondayUtcMidnight));

  const start = romeWallTimeToUtc(lm.y, lm.m, lm.d, 0, 0, 0, 0);
  const end = romeWallTimeToUtc(ls.y, ls.m, ls.d, 23, 59, 59, 999);

  return { start, end, weekStart: start, weekEnd: end };
}

function extractYMD(d: Date): { y: number; m: number; d: number } {
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
}

function parseRomeDateParts(now: Date): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: REPORT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

function romeWallTimeToUtc(
  year: number,
  month0: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
): Date {
  const naive = Date.UTC(year, month0, day, hour, minute, second, ms);
  const probe = new Date(Date.UTC(year, month0, day, 12, 0, 0, 0));
  const offsetMs = timeZoneOffsetMs(probe, REPORT_TIMEZONE);
  return new Date(naive - offsetMs);
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const hour = get('hour') === 24 ? 0 : get('hour');
  const asUTC = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    hour,
    get('minute'),
    get('second'),
  );
  return asUTC - date.getTime();
}

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------

interface RateLimiter {
  acquire(): Promise<void>;
}

function createRateLimiter(
  perSecond: number,
  sleep: (ms: number) => Promise<void>,
): RateLimiter {
  if (perSecond <= 0) {
    return { acquire: async () => undefined };
  }
  let inWindow = 0;
  let windowStart = Date.now();
  return {
    async acquire() {
      if (inWindow >= perSecond) {
        const elapsed = Date.now() - windowStart;
        const wait = Math.max(0, 1000 - elapsed);
        if (wait > 0) await sleep(wait);
        inWindow = 0;
        windowStart = Date.now();
      }
      inWindow++;
    },
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

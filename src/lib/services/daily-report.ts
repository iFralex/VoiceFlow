/**
 * Daily report dispatch service (plan 12 task 9).
 *
 * Composes per-org report data for the previous Europe/Rome calendar day,
 * resolves recipients (org owners by default), renders the React Email
 * template per locale, and dispatches via the Resend adapter with a soft
 * rate limit (≤10 emails/sec). Each org outcome is mirrored to the
 * append-only `audit_log` so the cron's reach can be reconstructed.
 *
 * Cross-org by design — every read flips between `withSystemContext` (to
 * enumerate orgs and recipients) and `withOrgContext` (per-org aggregation
 * so RLS stays in force for the data fed into the email).
 */

import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import { recordAudit } from '@/lib/db/audit';
import { type DbTx, withOrgContext, withSystemContext } from '@/lib/db/context';
import {
  appointments,
  calls,
  campaigns,
  contacts,
  memberships,
  organizations,
  users,
} from '@/lib/db/schema';
import { sendEmail } from '@/lib/email';
import {
  type DailyReportAppointment,
  type DailyReportLocale,
  type DailyReportTopCampaign,
  renderDailyReportEmail,
} from '@/lib/email/templates/daily-report';
import { env } from '@/lib/env';
import { logger } from '@/lib/observability/logger';
import { filterRecipientsByPreference } from '@/lib/services/notification-preferences';

const REPORT_TIMEZONE = 'Europe/Rome';
const TOP_CAMPAIGNS_LIMIT = 5;
const RECENT_APPOINTMENTS_LIMIT = 10;
const RATE_LIMIT_PER_SECOND = 10;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DailyReportRange {
  start: Date;
  end: Date;
  reportDate: Date;
}

export interface DailyReportRecipient {
  userId: string;
  email: string;
  fullName: string | null;
  locale: DailyReportLocale;
}

export interface DailyReportData {
  orgId: string;
  orgName: string;
  reportDate: Date;
  totalCalls: number;
  kpis: {
    callsCompleted: number;
    qualifiedLeads: number;
    appointmentsBooked: number;
  };
  topCampaigns: DailyReportTopCampaign[];
  recentAppointments: DailyReportAppointment[];
}

export interface DailyReportOrgOutcome {
  orgId: string;
  orgName: string;
  status: 'sent' | 'skipped_no_recipients' | 'failed';
  recipientCount: number;
  emailsSent: number;
  error?: string;
}

export interface DailyReportRunResult {
  range: DailyReportRange;
  orgsConsidered: number;
  orgsProcessed: number;
  orgsSkipped: number;
  orgsFailed: number;
  emailsSent: number;
  outcomes: DailyReportOrgOutcome[];
}

// ---------------------------------------------------------------------------
// Public entry point (used by the cron route and tests)
// ---------------------------------------------------------------------------

export interface RunDailyReportOptions {
  /** Override `Date.now()` for deterministic tests. */
  now?: Date;
  /**
   * Per-second send budget. Defaults to {@link RATE_LIMIT_PER_SECOND} so we
   * stay under Resend's free-tier ceiling. Tests can pass a higher value
   * (or 0 to disable) to avoid wall-clock waits.
   */
  ratePerSecond?: number;
  /** Replaceable mailer for tests. */
  mailer?: typeof sendEmail;
  /** Replaceable sleep implementation for tests. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Optional dependency injection seam for tests. When omitted the runner
   * uses the real database-backed implementations declared in this module.
   */
  deps?: Partial<DailyReportDeps>;
}

interface DailyReportDeps {
  listActiveOrgs: (range: DailyReportRange) => Promise<ActiveOrgRow[]>;
  buildData: (
    orgId: string,
    orgName: string,
    range: DailyReportRange,
  ) => Promise<DailyReportData>;
  listRecipients: (orgId: string) => Promise<DailyReportRecipient[]>;
  writeAudit: (
    orgId: string,
    outcome: AuditOutcome,
    metadata: Record<string, unknown>,
  ) => Promise<void>;
}

export async function runDailyReport(
  options: RunDailyReportOptions = {},
): Promise<DailyReportRunResult> {
  const now = options.now ?? new Date();
  const ratePerSecond = options.ratePerSecond ?? RATE_LIMIT_PER_SECOND;
  const mailer = options.mailer ?? sendEmail;
  const sleep = options.sleep ?? defaultSleep;
  const deps: DailyReportDeps = {
    listActiveOrgs: fetchActiveOrgs,
    buildData: buildDailyReportData,
    listRecipients: getDailyReportRecipients,
    writeAudit,
    ...(options.deps ?? {}),
  };

  const range = computeYesterdayRange(now);
  const orgRows = await deps.listActiveOrgs(range);

  const limiter = createRateLimiter(ratePerSecond, sleep);

  const outcomes: DailyReportOrgOutcome[] = [];
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
          void logger.error('[daily-report] recipient failed', { org_id: org.id, user_id: recipient.userId, error: msg });
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
        callsCompleted: data.kpis.callsCompleted,
        appointmentsBooked: data.kpis.appointmentsBooked,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void logger.error('[daily-report] org failed', { org_id: org.id, error: message });
      outcomes.push({
        orgId: org.id,
        orgName: org.name,
        status: 'failed',
        recipientCount: 0,
        emailsSent: 0,
        error: message,
      });
      orgsFailed++;
      await deps
        .writeAudit(org.id, 'failed', { error: message })
        .catch(() => undefined);
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

export async function buildDailyReportData(
  orgId: string,
  orgName: string,
  range: DailyReportRange,
): Promise<DailyReportData> {
  return withOrgContext(orgId, async (tx) => {
    const [callRow, apptRow, topCampaigns, recentAppointmentsRows] = await Promise.all([
      kpiCallAggregates(tx, orgId, range),
      kpiAppointmentsBooked(tx, orgId, range),
      topCampaignsForRange(tx, orgId, range),
      recentAppointmentsForRange(tx, orgId, range),
    ]);

    const totalCalls = callRow?.total ?? 0;
    const callsCompleted = callRow?.completed ?? 0;
    const qualifiedLeads = callRow?.qualified ?? 0;
    const appointmentsBooked = apptRow?.booked ?? 0;

    return {
      orgId,
      orgName,
      reportDate: range.reportDate,
      totalCalls,
      kpis: { callsCompleted, qualifiedLeads, appointmentsBooked },
      topCampaigns,
      recentAppointments: recentAppointmentsRows,
    };
  });
}

async function kpiCallAggregates(
  tx: DbTx,
  orgId: string,
  range: DailyReportRange,
): Promise<{ total: number; completed: number; qualified: number } | undefined> {
  const [row] = await tx
    .select({
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${calls.status} = 'completed')::int`,
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
  range: DailyReportRange,
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
  range: DailyReportRange,
): Promise<DailyReportTopCampaign[]> {
  const rows = await tx
    .select({
      id: campaigns.id,
      name: campaigns.name,
      total: sql<number>`count(${calls.id})::int`,
      completed: sql<number>`count(${calls.id}) filter (where ${calls.status} = 'completed')::int`,
      appointmentsBooked: sql<number>`count(${calls.id}) filter (where ${calls.outcome} = 'appointment_booked')::int`,
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
      desc(sql`count(${calls.id}) filter (where ${calls.status} = 'completed')`),
      desc(sql`count(${calls.id})`),
    )
    .limit(TOP_CAMPAIGNS_LIMIT);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    completed: r.completed ?? 0,
    total: r.total ?? 0,
    appointmentsBooked: r.appointmentsBooked ?? 0,
  }));
}

async function recentAppointmentsForRange(
  tx: DbTx,
  orgId: string,
  range: DailyReportRange,
): Promise<DailyReportAppointment[]> {
  const rows = await tx
    .select({
      id: appointments.id,
      scheduledAt: appointments.scheduled_at,
      contactFirst: contacts.first_name,
      contactLast: contacts.last_name,
      contactPhone: contacts.phone_e164,
      campaignName: campaigns.name,
    })
    .from(appointments)
    .innerJoin(contacts, eq(contacts.id, appointments.contact_id))
    .innerJoin(calls, eq(calls.id, appointments.call_id))
    .leftJoin(campaigns, eq(campaigns.id, calls.campaign_id))
    .where(
      and(
        eq(appointments.org_id, orgId),
        gte(appointments.created_at, range.start),
        lte(appointments.created_at, range.end),
      ),
    )
    .orderBy(desc(appointments.created_at))
    .limit(RECENT_APPOINTMENTS_LIMIT);

  return rows.map((r) => ({
    id: r.id,
    contactName:
      [r.contactFirst, r.contactLast].filter(Boolean).join(' ') || r.contactPhone,
    scheduledAt: r.scheduledAt,
    campaignName: r.campaignName ?? '',
  }));
}

// ---------------------------------------------------------------------------
// Org / recipient resolution
// ---------------------------------------------------------------------------

interface ActiveOrgRow {
  id: string;
  name: string;
}

async function fetchActiveOrgs(range: DailyReportRange): Promise<ActiveOrgRow[]> {
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

export async function getDailyReportRecipients(
  orgId: string,
): Promise<DailyReportRecipient[]> {
  return withSystemContext(async (tx) => {
    // Owners are the default recipient pool; other roles never receive the
    // daily report regardless of their per-user preferences.
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
      await filterRecipientsByPreference(tx, orgId, rows.map((r) => r.userId), 'daily_report'),
    );

    return rows
      .filter((r) => eligibleIds.has(r.userId))
      .map((r) => ({
        userId: r.userId,
        email: r.email,
        fullName: r.fullName,
        locale: (r.locale === 'en' ? 'en' : 'it') as DailyReportLocale,
      }));
  });
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function dispatchOne(
  mailer: typeof sendEmail,
  data: DailyReportData,
  recipient: DailyReportRecipient,
): Promise<void> {
  const { subject, html, text } = await renderDailyReportEmail({
    locale: recipient.locale,
    orgName: data.orgName,
    reportDate: data.reportDate,
    dashboardUrl: buildAbsoluteUrl('/dashboard'),
    preferencesUrl: buildAbsoluteUrl('/settings/notifications'),
    kpis: data.kpis,
    topCampaigns: data.topCampaigns,
    recentAppointments: data.recentAppointments,
    ...(recipient.fullName ? { recipientName: recipient.fullName } : {}),
  });

  await mailer({ to: recipient.email, subject, html, text });
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
  sent: 'notification.daily_report_sent',
  skipped_no_recipients: 'notification.daily_report_skipped',
  failed: 'notification.daily_report_failed',
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
 * Returns the inclusive UTC instants framing the previous calendar day in
 * Europe/Rome. The start is yesterday 00:00 Rome, the end is yesterday
 * 23:59:59.999 Rome — both adjusted for the DST offset that applies on the
 * report day. `reportDate` is exposed as the start instant for downstream
 * formatters (it is rendered with a Rome locale and shown as a calendar
 * date, so the precise instant within the day does not matter).
 */
export function computeYesterdayRange(now: Date): DailyReportRange {
  const todayParts = formatRomeDate(now);
  const todayUtcMidnightMs = Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day);
  const yesterdayUtcMidnight = new Date(todayUtcMidnightMs - 86_400_000);
  const y = yesterdayUtcMidnight.getUTCFullYear();
  const m = yesterdayUtcMidnight.getUTCMonth();
  const d = yesterdayUtcMidnight.getUTCDate();

  const start = romeWallTimeToUtc(y, m, d, 0, 0, 0, 0);
  const end = romeWallTimeToUtc(y, m, d, 23, 59, 59, 999);
  return { start, end, reportDate: start };
}

function formatRomeDate(now: Date): { year: number; month: number; day: number } {
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
  // Use noon UTC of the same wall-day to look up the offset; this stays clear
  // of the DST transition windows (02:00–03:00 local) where the wall time is
  // ambiguous, which is good enough for a report whose precision is
  // calendar-day-bounded.
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
  // Some Intl impls report the wall-clock hour as `24` for midnight when
  // `hour12: false` is combined with `hour: '2-digit'`. Normalise to `0` so
  // `Date.UTC` does not roll into the next day.
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
// Rate limiter (token bucket capped at N/sec)
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

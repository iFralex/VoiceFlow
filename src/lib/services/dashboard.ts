import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { unstable_cache } from 'next/cache';

import type { ActiveCampaignRow } from '@/components/dashboard/active-campaigns';
import type { DashboardAlert } from '@/components/dashboard/alerts-list';
import type { PeriodRange } from '@/components/dashboard/period';
import { resolvePeriodRange } from '@/components/dashboard/period';
import type { DashboardPeriod } from '@/components/dashboard/period-selector';
import type { RecentAppointmentRow } from '@/components/dashboard/recent-appointments';
import type { TrendPoint } from '@/components/dashboard/trend-chart';
import type { DbTx } from '@/lib/db/context';
import { withOrgContext, withSystemContext } from '@/lib/db/context';
import {
  appointments,
  calls,
  campaigns,
  campaignStats,
  contacts,
  phoneNumbers,
} from '@/lib/db/schema';
import { env } from '@/lib/env';
import { getBalance } from '@/lib/services/credit';

export type DashboardKpis = {
  callsCompleted: number;
  qualifiedLeads: number;
  appointmentsBooked: number;
  creditBalance: { cents: number; minutes: number };
};

export type DashboardSparklines = {
  callsCompleted: number[];
  qualifiedLeads: number[];
  appointmentsBooked: number[];
};

export type DashboardData = {
  period: { start: Date; end: Date; label: DashboardPeriod };
  kpis: DashboardKpis;
  sparklines: DashboardSparklines;
  trends: TrendPoint[];
  activeCampaigns: ActiveCampaignRow[];
  recentAppointments: RecentAppointmentRow[];
  alerts: DashboardAlert[];
  hasAnyCampaign: boolean;
};

const CACHE_TTL_SECONDS = 60;

/**
 * Public service entry-point: returns all data required to render the
 * dashboard for `orgId` over `period`. Result is cached for 60s keyed by
 * `(orgId, period)` via `unstable_cache`. The period range is recomputed
 * on every call so that the boundaries stay current after the cache
 * revalidates.
 */
export async function getDashboardData(
  orgId: string,
  period: DashboardPeriod,
): Promise<DashboardData> {
  const range = resolvePeriodRange(period);
  const cached = await loadDashboardCached(orgId, period, range.start.toISOString(), range.end.toISOString());
  return {
    period: { start: range.start, end: range.end, label: period },
    kpis: cached.kpis,
    sparklines: cached.sparklines,
    trends: cached.trends,
    activeCampaigns: cached.activeCampaigns,
    recentAppointments: cached.recentAppointments,
    alerts: cached.alerts,
    hasAnyCampaign: cached.hasAnyCampaign,
  };
}

type CachedDashboardPayload = Omit<DashboardData, 'period'>;

const loadDashboardCached = unstable_cache(
  async (
    orgId: string,
    _period: DashboardPeriod,
    startIso: string,
    endIso: string,
  ): Promise<CachedDashboardPayload> => {
    const range: PeriodRange = {
      period: _period,
      start: new Date(startIso),
      end: new Date(endIso),
    };
    return loadDashboardUncached(orgId, range);
  },
  ['dashboard'],
  { revalidate: CACHE_TTL_SECONDS, tags: ['dashboard'] },
);

/**
 * Performs the actual aggregation queries inside a single transaction and
 * returns the cacheable payload. Multiple parallel queries share one
 * connection; the org-scoped GUC is set once via `withOrgContext` so RLS
 * policies are honoured for every read.
 */
export async function loadDashboardUncached(
  orgId: string,
  range: PeriodRange,
): Promise<CachedDashboardPayload> {
  const sparklineDays = 14;
  const sparklineStart = startOfDay(daysAgo(sparklineDays - 1));

  const [
    [
      kpiAggregates,
      perDayInRange,
      perDay14d,
      activeCampaignRows,
      recentAppointmentRows,
      disclosureFailureCount,
      hasAnyCampaign,
    ],
    coolingPhonesCount,
  ] = await Promise.all([
    withOrgContext(orgId, async (tx) =>
      Promise.all([
        kpiAggregateInRange(tx, orgId, range),
        perDayOutcomeCounts(tx, orgId, range.start, range.end),
        perDaySparklines(tx, orgId, sparklineStart, endOfDay(new Date())),
        activeCampaignsRows(tx, orgId),
        recentAppointmentsRows(tx, orgId, 10),
        disclosureFailureFlags(tx, orgId),
        anyCampaignExists(tx, orgId),
      ]),
    ),
    coolingPhonesForOrg(orgId),
  ]);

  const balance = await getBalance(orgId);

  const sparklineDates = lastNDates(sparklineDays);
  const dayMap = new Map(perDay14d.map((r) => [r.date, r] as const));
  const sparklines: DashboardSparklines = {
    callsCompleted: sparklineDates.map((d) => dayMap.get(d)?.completed ?? 0),
    qualifiedLeads: sparklineDates.map((d) => dayMap.get(d)?.qualifiedLeads ?? 0),
    appointmentsBooked: sparklineDates.map((d) => dayMap.get(d)?.appointmentBooked ?? 0),
  };

  const trendDates = datesBetween(range.start, range.end);
  const trendMap = new Map(perDayInRange.map((r) => [r.date, r] as const));
  const trends: TrendPoint[] = trendDates.map((d) => {
    const row = trendMap.get(d);
    return {
      date: d,
      completed: row?.completed ?? 0,
      appointmentBooked: row?.appointmentBooked ?? 0,
      notInterested: row?.notInterested ?? 0,
      voicemail: row?.voicemail ?? 0,
      failed: row?.failed ?? 0,
    };
  });

  const alerts: DashboardAlert[] = [];
  if (
    balance.remainingMinutes > 0 &&
    balance.remainingMinutes < env.CREDIT_SOFT_THRESHOLD_MINUTES
  ) {
    alerts.push({
      id: 'low_credit',
      kind: 'low_credit',
      balanceMinutes: balance.remainingMinutes,
    });
  }
  if (coolingPhonesCount > 0) {
    alerts.push({ id: 'cli_cooldown', kind: 'cli_cooldown', count: coolingPhonesCount });
  }
  if (disclosureFailureCount > 0) {
    alerts.push({
      id: 'disclosure_failure',
      kind: 'disclosure_failure',
      count: disclosureFailureCount,
    });
  }

  return {
    kpis: {
      callsCompleted: kpiAggregates.callsCompleted,
      qualifiedLeads: kpiAggregates.qualifiedLeads,
      appointmentsBooked: kpiAggregates.appointmentsBooked,
      creditBalance: { cents: balance.balanceCents, minutes: balance.remainingMinutes },
    },
    sparklines,
    trends,
    activeCampaigns: activeCampaignRows,
    recentAppointments: recentAppointmentRows,
    alerts,
    hasAnyCampaign,
  };
}

// ─── Internal queries ──────────────────────────────────────────────────────────

async function kpiAggregateInRange(
  tx: DbTx,
  orgId: string,
  range: PeriodRange,
): Promise<{ callsCompleted: number; qualifiedLeads: number; appointmentsBooked: number }> {
  const [callRow] = await tx
    .select({
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

  const [apptRow] = await tx
    .select({ booked: sql<number>`count(*)::int` })
    .from(appointments)
    .where(
      and(
        eq(appointments.org_id, orgId),
        gte(appointments.created_at, range.start),
        lte(appointments.created_at, range.end),
      ),
    );

  return {
    callsCompleted: callRow?.completed ?? 0,
    qualifiedLeads: callRow?.qualified ?? 0,
    appointmentsBooked: apptRow?.booked ?? 0,
  };
}

type PerDayRow = {
  date: string;
  completed: number;
  appointmentBooked: number;
  notInterested: number;
  voicemail: number;
  failed: number;
};

async function perDayOutcomeCounts(
  tx: DbTx,
  orgId: string,
  start: Date,
  end: Date,
): Promise<PerDayRow[]> {
  return tx
    .select({
      date: sql<string>`to_char(date_trunc('day', ${calls.created_at}), 'YYYY-MM-DD')`,
      completed: sql<number>`count(*) filter (where ${calls.status} = 'completed')::int`,
      appointmentBooked: sql<number>`count(*) filter (where ${calls.outcome} = 'appointment_booked')::int`,
      notInterested: sql<number>`count(*) filter (where ${calls.outcome} = 'not_interested')::int`,
      voicemail: sql<number>`count(*) filter (where ${calls.outcome} in ('voicemail_left','voicemail_no_message'))::int`,
      failed: sql<number>`count(*) filter (where ${calls.status} in ('failed','no_answer','busy','voicemail'))::int`,
    })
    .from(calls)
    .where(
      and(
        eq(calls.org_id, orgId),
        gte(calls.created_at, start),
        lte(calls.created_at, end),
      ),
    )
    .groupBy(sql`date_trunc('day', ${calls.created_at})`)
    .orderBy(sql`date_trunc('day', ${calls.created_at})`);
}

type PerDaySparkRow = {
  date: string;
  completed: number;
  qualifiedLeads: number;
  appointmentBooked: number;
};

async function perDaySparklines(
  tx: DbTx,
  orgId: string,
  start: Date,
  end: Date,
): Promise<PerDaySparkRow[]> {
  return tx
    .select({
      date: sql<string>`to_char(date_trunc('day', ${calls.created_at}), 'YYYY-MM-DD')`,
      completed: sql<number>`count(*) filter (where ${calls.status} = 'completed')::int`,
      qualifiedLeads: sql<number>`count(*) filter (where ${calls.outcome} in ('interested','appointment_booked'))::int`,
      appointmentBooked: sql<number>`count(*) filter (where ${calls.outcome} = 'appointment_booked')::int`,
    })
    .from(calls)
    .where(
      and(
        eq(calls.org_id, orgId),
        gte(calls.created_at, start),
        lte(calls.created_at, end),
      ),
    )
    .groupBy(sql`date_trunc('day', ${calls.created_at})`)
    .orderBy(sql`date_trunc('day', ${calls.created_at})`);
}

async function activeCampaignsRows(tx: DbTx, orgId: string): Promise<ActiveCampaignRow[]> {
  const rows = await tx
    .select({
      id: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
      total: campaignStats.total_calls,
      completed: campaignStats.completed_calls,
      appointmentsBooked: campaignStats.outcome_appointment_booked,
    })
    .from(campaigns)
    .leftJoin(campaignStats, eq(campaignStats.campaign_id, campaigns.id))
    .where(
      and(
        eq(campaigns.org_id, orgId),
        sql`${campaigns.status} IN ('running','paused')`,
      ),
    )
    .orderBy(desc(campaigns.started_at), desc(campaigns.created_at))
    .limit(5);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    total: r.total ?? 0,
    completed: r.completed ?? 0,
    appointmentsBooked: r.appointmentsBooked ?? 0,
  }));
}

async function recentAppointmentsRows(
  tx: DbTx,
  orgId: string,
  limit: number,
): Promise<RecentAppointmentRow[]> {
  const rows = await tx
    .select({
      id: appointments.id,
      scheduledAt: appointments.scheduled_at,
      contactFirst: contacts.first_name,
      contactLast: contacts.last_name,
      contactPhone: contacts.phone_e164,
      campaignId: campaigns.id,
      campaignName: campaigns.name,
    })
    .from(appointments)
    .innerJoin(contacts, eq(contacts.id, appointments.contact_id))
    .innerJoin(calls, eq(calls.id, appointments.call_id))
    .leftJoin(campaigns, eq(campaigns.id, calls.campaign_id))
    .where(eq(appointments.org_id, orgId))
    .orderBy(desc(appointments.created_at))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    contactName:
      [r.contactFirst, r.contactLast].filter(Boolean).join(' ') || r.contactPhone,
    scheduledAt: r.scheduledAt.toISOString(),
    campaignName: r.campaignName ?? '',
    campaignId: r.campaignId ?? '',
  }));
}

async function coolingPhonesForOrg(orgId: string): Promise<number> {
  return withSystemContext(async (tx) => {
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(phoneNumbers)
      .where(and(eq(phoneNumbers.org_id, orgId), eq(phoneNumbers.status, 'cooling_down')));
    return row?.count ?? 0;
  });
}

async function disclosureFailureFlags(tx: DbTx, orgId: string): Promise<number> {
  const since = daysAgo(7);
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(calls)
    .where(
      and(
        eq(calls.org_id, orgId),
        gte(calls.created_at, since),
        sql`${calls.metadata}->>'disclosure_verified' = 'false'`,
      ),
    );
  return row?.count ?? 0;
}

async function anyCampaignExists(tx: DbTx, orgId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.org_id, orgId))
    .limit(1);
  return Boolean(row);
}

// ─── Date helpers ──────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function daysAgo(n: number): Date {
  const d = startOfDay(new Date());
  d.setDate(d.getDate() - n);
  return d;
}

function lastNDates(n: number): string[] {
  const out: string[] = [];
  const today = startOfDay(new Date());
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    out.push(formatYmd(d));
  }
  return out;
}

function datesBetween(start: Date, end: Date): string[] {
  const out: string[] = [];
  const cur = startOfDay(start);
  const stop = startOfDay(end);
  while (cur.getTime() <= stop.getTime()) {
    out.push(formatYmd(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

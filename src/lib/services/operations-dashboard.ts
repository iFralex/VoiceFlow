import { and, count, eq, gte, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

import { withSystemContext } from '@/lib/db/context';
import {
  auditLog,
  calls,
  campaigns,
  creditLedger,
  organizations,
  payments,
  phoneNumbers,
  webhookDeliveries,
} from '@/lib/db/schema';

function daysAgo(d: number): Date {
  return new Date(Date.now() - d * 24 * 60 * 60 * 1000);
}

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 60 * 60 * 1000);
}

export interface CliPoolHealth {
  active: number;
  cooling_down: number;
  retired: number;
}

export interface CallVolume24h {
  total: number;
  byOutcome: Record<string, number>;
  byStatus: Record<string, number>;
}

export interface OperationsDashboardData {
  activeOrgsCount: number;
  activeCampaignsCount: number;
  mrrEquivalentCents: number;
  credit24hCents: number;
  callVolume24h: CallVolume24h;
  cliPoolHealth: CliPoolHealth;
  stripeVolumeLast30dCents: number;
  failedWebhookDeliveries24h: number;
  gdprRequestsLast30d: number;
  generatedAt: Date;
}

export async function getOperationsDashboardData(): Promise<OperationsDashboardData> {
  return withSystemContext(async (tx) => {
    const ago24h = hoursAgo(24);
    const ago30d = daysAgo(30);

    const [activeOrgsRow] = await tx
      .select({ n: count() })
      .from(organizations)
      .where(isNull(organizations.deleted_at));

    const [activeCampaignsRow] = await tx
      .select({ n: count() })
      .from(campaigns)
      .where(inArray(campaigns.status, ['running', 'scheduled']));

    const [mrrRow] = await tx
      .select({ cents: sql<string>`COALESCE(SUM(ABS(delta_cents)), 0)` })
      .from(creditLedger)
      .where(and(eq(creditLedger.entry_type, 'charge'), gte(creditLedger.created_at, ago30d)));

    const [credit24hRow] = await tx
      .select({ cents: sql<string>`COALESCE(SUM(ABS(delta_cents)), 0)` })
      .from(creditLedger)
      .where(and(eq(creditLedger.entry_type, 'charge'), gte(creditLedger.created_at, ago24h)));

    const callRows = await tx
      .select({ status: calls.status, outcome: calls.outcome, cnt: count() })
      .from(calls)
      .where(gte(calls.created_at, ago24h))
      .groupBy(calls.status, calls.outcome);

    const byOutcome: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let totalCalls = 0;
    for (const row of callRows) {
      const n = Number(row.cnt);
      totalCalls += n;
      byStatus[row.status] = (byStatus[row.status] ?? 0) + n;
      if (row.outcome) {
        byOutcome[row.outcome] = (byOutcome[row.outcome] ?? 0) + n;
      }
    }

    const cliRows = await tx
      .select({ status: phoneNumbers.status, cnt: count() })
      .from(phoneNumbers)
      .groupBy(phoneNumbers.status);

    const cliHealth: CliPoolHealth = { active: 0, cooling_down: 0, retired: 0 };
    for (const row of cliRows) {
      if (row.status in cliHealth) {
        cliHealth[row.status as keyof CliPoolHealth] = Number(row.cnt);
      }
    }

    const [stripeRow] = await tx
      .select({ cents: sql<string>`COALESCE(SUM(amount_cents), 0)` })
      .from(payments)
      .where(and(eq(payments.status, 'succeeded'), gte(payments.created_at, ago30d)));

    const [failedWebhooksRow] = await tx
      .select({ n: count() })
      .from(webhookDeliveries)
      .where(
        and(
          gte(webhookDeliveries.delivered_at, ago24h),
          or(
            isNotNull(webhookDeliveries.error),
            and(isNotNull(webhookDeliveries.status_code), gte(webhookDeliveries.status_code, 300)),
          ),
        ),
      );

    const [gdprRow] = await tx
      .select({ n: count() })
      .from(auditLog)
      .where(and(eq(auditLog.action, 'compliance.gdpr_erasure'), gte(auditLog.created_at, ago30d)));

    return {
      activeOrgsCount: Number(activeOrgsRow?.n ?? 0),
      activeCampaignsCount: Number(activeCampaignsRow?.n ?? 0),
      mrrEquivalentCents: Number(mrrRow?.cents ?? 0),
      credit24hCents: Number(credit24hRow?.cents ?? 0),
      callVolume24h: { total: totalCalls, byOutcome, byStatus },
      cliPoolHealth: cliHealth,
      stripeVolumeLast30dCents: Number(stripeRow?.cents ?? 0),
      failedWebhookDeliveries24h: Number(failedWebhooksRow?.n ?? 0),
      gdprRequestsLast30d: Number(gdprRow?.n ?? 0),
      generatedAt: new Date(),
    };
  });
}

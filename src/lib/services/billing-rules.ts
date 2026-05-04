import { and, asc, eq, sql } from 'drizzle-orm';

import type { DbTx } from '@/lib/db/context';
import { withOrgContext } from '@/lib/db/context';
import { creditLedger, creditPackages, payments } from '@/lib/db/schema';

// ─── Constants ─────────────────────────────────────────────────────────────────

const BILLING_GRANULARITY_SECONDS = 6;
const MIN_BILLABLE_SECONDS = 6;

// ─── computeCallCost ───────────────────────────────────────────────────────────

/**
 * Computes the billable seconds and cost in cents for a completed call.
 *
 * Rules (spec §11.3):
 * - Calls shorter than MIN_BILLABLE_SECONDS (6s) are free (e.g. unanswered / immediate hang-up).
 * - Billable duration is rounded UP to the next BILLING_GRANULARITY_SECONDS (6s) boundary.
 * - Cost is rounded UP to the nearest whole cent.
 */
export function computeCallCost(args: {
  durationSeconds: number;
  perMinuteCents: number;
}): {
  billableSeconds: number;
  costCents: number;
} {
  if (args.durationSeconds < MIN_BILLABLE_SECONDS) {
    return { billableSeconds: 0, costCents: 0 };
  }
  const billable =
    Math.ceil(args.durationSeconds / BILLING_GRANULARITY_SECONDS) * BILLING_GRANULARITY_SECONDS;
  const cost = Math.ceil((billable / 60) * args.perMinuteCents);
  return { billableSeconds: billable, costCents: cost };
}

// ─── computePerMinuteCents ─────────────────────────────────────────────────────

interface TopupPool {
  totalCents: number;
  includedMinutes: number;
}

/**
 * Internal helper: resolves topup pools and computes the weighted-average
 * cents-per-minute rate from the org's un-consumed minute pools.
 *
 * Pools are depleted FIFO (oldest first). For each un-consumed (or partially
 * consumed) pool the remaining minutes contribute proportionally to the
 * weighted average. Returns null when there are no un-consumed pools.
 */
async function loadPerMinuteCents(tx: DbTx, orgId: string): Promise<number | null> {
  // 1. Load topup ledger entries in chronological order (oldest pool first)
  const topupEntries = await tx
    .select({
      delta_cents: creditLedger.delta_cents,
      reference_id: creditLedger.reference_id,
    })
    .from(creditLedger)
    .where(and(eq(creditLedger.org_id, orgId), eq(creditLedger.entry_type, 'topup')))
    .orderBy(asc(creditLedger.created_at));

  if (topupEntries.length === 0) return null;

  // 2. Resolve each topup to its credit package to get per-pool minute count
  const pools: TopupPool[] = [];
  for (const entry of topupEntries) {
    if (!entry.reference_id) continue;

    const [payment] = await tx
      .select({ package_id: payments.package_id })
      .from(payments)
      .where(eq(payments.stripe_payment_intent_id, entry.reference_id));

    if (!payment) continue;

    const [pkg] = await tx
      .select({ included_minutes: creditPackages.included_minutes })
      .from(creditPackages)
      .where(eq(creditPackages.id, payment.package_id));

    if (!pkg || pkg.included_minutes === 0) continue;

    pools.push({ totalCents: entry.delta_cents, includedMinutes: pkg.included_minutes });
  }

  if (pools.length === 0) return null;

  // 3. Total consumed cents = sum of all charge entries (delta_cents are negative for charges)
  const [chargeRow] = await tx
    .select({
      total: sql<string>`coalesce(abs(sum(${creditLedger.delta_cents})), 0)`,
    })
    .from(creditLedger)
    .where(and(eq(creditLedger.org_id, orgId), eq(creditLedger.entry_type, 'charge')));

  let remainingConsumed = Math.abs(Number(chargeRow?.total ?? 0));

  // 4. Walk pools FIFO, computing remaining (un-consumed) portions
  let totalUnconsumedCents = 0;
  let totalUnconsumedMinutes = 0;

  for (const pool of pools) {
    const ratePerMinute = pool.totalCents / pool.includedMinutes;

    if (remainingConsumed >= pool.totalCents) {
      // Pool fully depleted — skip
      remainingConsumed -= pool.totalCents;
    } else {
      // Pool partially or not yet consumed
      const unconsumedCents = pool.totalCents - remainingConsumed;
      remainingConsumed = 0;
      // unconsumed minutes proportional to remaining cents in this pool
      const unconsumedMinutes = unconsumedCents / ratePerMinute;
      totalUnconsumedCents += unconsumedCents;
      totalUnconsumedMinutes += unconsumedMinutes;
    }
  }

  if (totalUnconsumedMinutes === 0) return null;
  return totalUnconsumedCents / totalUnconsumedMinutes;
}

/**
 * Returns the current weighted-average cents-per-minute rate for the org,
 * computed over all un-consumed minute pools (FIFO depletion order).
 *
 * Returns null when the org has purchased no packages or all pools are depleted.
 */
export async function computePerMinuteCents(orgId: string): Promise<number | null> {
  return withOrgContext(orgId, async (tx) => {
    return loadPerMinuteCents(tx, orgId);
  });
}

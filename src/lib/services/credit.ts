import { and, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import { recordAudit } from '@/lib/db/audit';
import type { DbTx } from '@/lib/db/context';
import { withOrgContext, withSystemContext } from '@/lib/db/context';
import { auditLog, calls, creditEntryTypeEnum, creditLedger, creditPackages, payments } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { sendInngestEvent } from '@/lib/inngest/client';
import { CREDIT_LOW_BALANCE_EVENT } from '@/lib/inngest/handlers/credit';

// ─── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Reads the current balance for an org, locking the most recent ledger row
 * FOR UPDATE to serialise concurrent writes and prevent stale balance reads.
 * Returns 0 if no ledger entries exist yet.
 */
async function lockBalance(tx: DbTx, orgId: string): Promise<number> {
  const [latest] = await tx
    .select({ balance_after_cents: creditLedger.balance_after_cents })
    .from(creditLedger)
    .where(eq(creditLedger.org_id, orgId))
    .orderBy(desc(creditLedger.created_at))
    .limit(1)
    .for('update');
  return latest?.balance_after_cents ?? 0;
}

/**
 * Computes a lifetime weighted-average cents-per-minute rate for the org by
 * aggregating all topup ledger entries and their associated credit packages.
 * Returns null when no packages have been purchased yet.
 */
async function weightedAvgCentsPerMinute(tx: DbTx, orgId: string): Promise<number | null> {
  const topups = await tx
    .select({
      delta_cents: creditLedger.delta_cents,
      reference_id: creditLedger.reference_id,
    })
    .from(creditLedger)
    .where(
      and(eq(creditLedger.org_id, orgId), eq(creditLedger.entry_type, 'topup')),
    );

  if (topups.length === 0) return null;

  let totalCents = 0;
  let totalMinutes = 0;

  for (const topup of topups) {
    if (!topup.reference_id) continue;

    const [payment] = await tx
      .select({ package_id: payments.package_id })
      .from(payments)
      .where(eq(payments.stripe_payment_intent_id, topup.reference_id));

    if (!payment) continue;

    const [pkg] = await tx
      .select({ included_minutes: creditPackages.included_minutes })
      .from(creditPackages)
      .where(eq(creditPackages.id, payment.package_id));

    if (!pkg) continue;

    totalCents += topup.delta_cents;
    totalMinutes += pkg.included_minutes;
  }

  if (totalMinutes === 0) return null;
  return totalCents / totalMinutes; // cents per minute
}

/**
 * Reads the per-org soft threshold (minutes) from the environment.
 * Falls back to 30 when the variable is absent or not a valid integer.
 */
function softThresholdMinutes(): number {
  return env.CREDIT_SOFT_THRESHOLD_MINUTES;
}

/**
 * Emits a `credit/low-balance` Inngest event when remaining minutes cross below
 * the soft threshold for the first time today (checked via audit_log).
 * Failures are caught and logged — this must never interrupt the billing write.
 */
async function maybeEmitLowBalanceAlert(orgId: string, newBalanceCents: number): Promise<void> {
  // Compute remaining minutes using the org's weighted-average rate
  const remainingMinutes = await withOrgContext(orgId, async (tx) => {
    const cpm = await weightedAvgCentsPerMinute(tx, orgId);
    if (cpm === null || cpm <= 0) return null;
    return Math.floor(newBalanceCents / cpm);
  });

  if (remainingMinutes === null) return; // no packages purchased yet

  const threshold = softThresholdMinutes();
  if (remainingMinutes >= threshold) return; // still above threshold

  // Check whether we already fired an alert for this org today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const alreadyAlerted = await withSystemContext(async (tx) => {
    const rows = await tx
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.org_id, orgId),
          eq(auditLog.action, 'credit.low-balance'),
          gte(auditLog.created_at, todayStart),
        ),
      )
      .limit(1);
    return rows.length > 0;
  });

  if (alreadyAlerted) return;

  // Emit the Inngest event so the background handler can send the email
  await sendInngestEvent({
    name: CREDIT_LOW_BALANCE_EVENT,
    data: { orgId, balanceCents: newBalanceCents, remainingMinutes },
  });

  // Record in audit_log so we don't re-alert the same day
  await withSystemContext(async (tx) => {
    await recordAudit(tx, {
      orgId,
      actorType: 'system',
      action: 'credit.low-balance',
      subjectType: 'credit_ledger',
      subjectId: orgId,
      metadata: { balanceCents: newBalanceCents, remainingMinutes, thresholdMinutes: threshold },
    });
  });
}

// ─── Service functions ─────────────────────────────────────────────────────────

/**
 * Returns the current credit balance in cents and an estimated remaining minutes
 * computed using a lifetime weighted-average per-minute rate across all packages
 * purchased by the org.
 */
export async function getBalance(
  orgId: string,
): Promise<{ balanceCents: number; remainingMinutes: number }> {
  return withOrgContext(orgId, async (tx) => {
    const [latest] = await tx
      .select({ balance_after_cents: creditLedger.balance_after_cents })
      .from(creditLedger)
      .where(eq(creditLedger.org_id, orgId))
      .orderBy(desc(creditLedger.created_at))
      .limit(1);

    const balanceCents = latest?.balance_after_cents ?? 0;
    const centsPerMinute = await weightedAvgCentsPerMinute(tx, orgId);

    const remainingMinutes =
      centsPerMinute !== null && centsPerMinute > 0
        ? Math.floor(balanceCents / centsPerMinute)
        : 0;

    return { balanceCents, remainingMinutes };
  });
}

/**
 * Credits the ledger after a successful Stripe payment.
 * Idempotent: duplicate calls with the same stripePaymentIntentId are no-ops.
 */
export async function topUp(
  orgId: string,
  params: {
    amountCents: number;
    packageId: string;
    stripePaymentIntentId: string;
    description: string;
  },
): Promise<void> {
  await withOrgContext(orgId, async (tx) => {
    const currentBalance = await lockBalance(tx, orgId);
    const newBalance = currentBalance + params.amountCents;

    const [inserted] = await tx
      .insert(creditLedger)
      .values({
        org_id: orgId,
        entry_type: 'topup',
        delta_cents: params.amountCents,
        balance_after_cents: newBalance,
        reference_type: 'payment',
        reference_id: params.stripePaymentIntentId,
        description: params.description,
      })
      .onConflictDoNothing()
      .returning({ id: creditLedger.id });

    if (!inserted) return; // duplicate delivery — no-op

    await recordAudit(tx, {
      orgId,
      actorType: 'system',
      action: 'credit.topup',
      subjectType: 'credit_ledger',
      subjectId: params.stripePaymentIntentId,
      metadata: {
        amountCents: params.amountCents,
        packageId: params.packageId,
        balanceBefore: currentBalance,
        balanceAfter: newBalance,
      },
    });
  });
}

/**
 * Reserves credit for a campaign by pre-debiting the maximum possible cost.
 * Throws `insufficient_credit` if the current balance is less than maxCents.
 * Idempotent: duplicate calls for the same campaignId are no-ops.
 */
export async function reserveForCampaign(
  orgId: string,
  campaignId: string,
  maxCents: number,
): Promise<void> {
  await withOrgContext(orgId, async (tx) => {
    const currentBalance = await lockBalance(tx, orgId);

    if (currentBalance < maxCents) {
      throw new Error('insufficient_credit');
    }

    const newBalance = currentBalance - maxCents;

    const [inserted] = await tx
      .insert(creditLedger)
      .values({
        org_id: orgId,
        entry_type: 'reservation',
        delta_cents: -maxCents,
        balance_after_cents: newBalance,
        reference_type: 'campaign',
        reference_id: campaignId,
        description: `Credit reservation for campaign ${campaignId}`,
      })
      .onConflictDoNothing()
      .returning({ id: creditLedger.id });

    if (!inserted) return;

    await recordAudit(tx, {
      orgId,
      actorType: 'system',
      action: 'credit.reserved',
      subjectType: 'campaign',
      subjectId: campaignId,
      metadata: { maxCents, balanceBefore: currentBalance, balanceAfter: newBalance },
    });
  });
}

/**
 * Releases the unused portion of a campaign's credit reservation back to the
 * available balance. Computes unused = reserved - sum(call charges).
 * Idempotent: duplicate calls for the same campaignId are no-ops.
 * No-op if no reservation entry exists for the campaign.
 */
export async function releaseReservation(orgId: string, campaignId: string): Promise<void> {
  await withOrgContext(orgId, async (tx) => {
    const [reservation] = await tx
      .select({ delta_cents: creditLedger.delta_cents })
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.org_id, orgId),
          eq(creditLedger.entry_type, 'reservation'),
          eq(creditLedger.reference_type, 'campaign'),
          eq(creditLedger.reference_id, campaignId),
        ),
      );

    if (!reservation) return; // no reservation to release

    const reservedCents = Math.abs(reservation.delta_cents);

    // Sum all charges for calls belonging to this campaign
    const campaignCalls = await tx
      .select({ id: calls.id })
      .from(calls)
      .where(and(eq(calls.org_id, orgId), eq(calls.campaign_id, campaignId)));

    let totalCharged = 0;
    if (campaignCalls.length > 0) {
      const callIds = campaignCalls.map((c) => c.id);
      const [row] = await tx
        .select({
          total: sql<string>`coalesce(sum(${creditLedger.delta_cents}), 0)`,
        })
        .from(creditLedger)
        .where(
          and(
            eq(creditLedger.org_id, orgId),
            eq(creditLedger.entry_type, 'charge'),
            eq(creditLedger.reference_type, 'call'),
            inArray(creditLedger.reference_id, callIds),
          ),
        );
      // charge delta_cents are negative; abs() gives the positive amount charged
      totalCharged = Math.abs(Number(row?.total ?? 0));
    }

    const unused = Math.max(0, reservedCents - totalCharged);
    if (unused === 0) return; // fully consumed — no ledger entry needed

    const currentBalance = await lockBalance(tx, orgId);
    const newBalance = currentBalance + unused;

    const [inserted] = await tx
      .insert(creditLedger)
      .values({
        org_id: orgId,
        entry_type: 'release',
        delta_cents: unused,
        balance_after_cents: newBalance,
        reference_type: 'campaign',
        reference_id: campaignId,
        description: `Release unused reservation for campaign ${campaignId}`,
      })
      .onConflictDoNothing()
      .returning({ id: creditLedger.id });

    if (!inserted) return;

    await recordAudit(tx, {
      orgId,
      actorType: 'system',
      action: 'credit.released',
      subjectType: 'campaign',
      subjectId: campaignId,
      metadata: {
        reservedCents,
        totalCharged,
        unused,
        balanceBefore: currentBalance,
        balanceAfter: newBalance,
      },
    });
  });
}

/**
 * Records the actual cost of a completed call against the org's credit balance.
 * Idempotent: duplicate calls with the same callId are no-ops.
 * No-op for zero-cost calls (e.g. unanswered, under minimum billable duration).
 *
 * After a successful charge, checks the low-balance soft threshold and emits a
 * `credit/low-balance` Inngest event the first time the balance drops below it
 * within the same calendar day. Alert failures are suppressed — they must never
 * interrupt the billing write.
 */
export async function chargeForCall(
  orgId: string,
  callId: string,
  costCents: number,
): Promise<void> {
  if (costCents === 0) return;

  let newBalance: number | undefined;

  await withOrgContext(orgId, async (tx) => {
    const currentBalance = await lockBalance(tx, orgId);
    const candidateBalance = currentBalance - costCents;

    if (candidateBalance < 0) {
      throw new Error('insufficient_credit');
    }

    const [inserted] = await tx
      .insert(creditLedger)
      .values({
        org_id: orgId,
        entry_type: 'charge',
        delta_cents: -costCents,
        balance_after_cents: candidateBalance,
        reference_type: 'call',
        reference_id: callId,
        description: `Call charge for ${callId}`,
      })
      .onConflictDoNothing()
      .returning({ id: creditLedger.id });

    if (!inserted) return; // duplicate delivery — no-op; skip alert

    await recordAudit(tx, {
      orgId,
      actorType: 'system',
      action: 'credit.charged',
      subjectType: 'call',
      subjectId: callId,
      metadata: { costCents, balanceBefore: currentBalance, balanceAfter: candidateBalance },
    });

    newBalance = candidateBalance;
  });

  // Check threshold outside the transaction so a failed alert never rolls back
  // the ledger write. Fire-and-forget with error suppression.
  if (newBalance !== undefined) {
    await maybeEmitLowBalanceAlert(orgId, newBalance).catch((e: unknown) => {
      console.error('[credit] Low-balance alert failed for org', orgId, e);
    });
  }
}

/**
 * Refunds the cost of a call back to the org's credit balance.
 * Idempotent: duplicate refunds for the same callId are no-ops.
 */
export async function refundCall(
  orgId: string,
  callId: string,
  costCents: number,
  reason: string,
): Promise<void> {
  await withOrgContext(orgId, async (tx) => {
    const currentBalance = await lockBalance(tx, orgId);
    const newBalance = currentBalance + costCents;

    const [inserted] = await tx
      .insert(creditLedger)
      .values({
        org_id: orgId,
        entry_type: 'refund',
        delta_cents: costCents,
        balance_after_cents: newBalance,
        reference_type: 'call',
        reference_id: callId,
        description: reason,
      })
      .onConflictDoNothing()
      .returning({ id: creditLedger.id });

    if (!inserted) return;

    await recordAudit(tx, {
      orgId,
      actorType: 'system',
      action: 'credit.refunded',
      subjectType: 'call',
      subjectId: callId,
      metadata: { costCents, reason, balanceBefore: currentBalance, balanceAfter: newBalance },
    });
  });
}

/**
 * Applies a manual credit adjustment (positive or negative) to the org's balance.
 * Each call creates a unique ledger entry — adjustments are not idempotent by design
 * as they represent intentional admin actions rather than event-driven writes.
 */
export async function adjust(
  orgId: string,
  byUserId: string,
  deltaCents: number,
  reason: string,
  opts?: { actorType?: 'user' | 'system' },
): Promise<void> {
  const actorType = opts?.actorType ?? 'user';
  await withOrgContext(orgId, async (tx) => {
    const currentBalance = await lockBalance(tx, orgId);
    const newBalance = currentBalance + deltaCents;

    if (newBalance < 0) {
      throw new Error('adjustment_would_overdraft');
    }

    const referenceId = crypto.randomUUID();

    await tx.insert(creditLedger).values({
      org_id: orgId,
      entry_type: 'adjustment',
      delta_cents: deltaCents,
      balance_after_cents: newBalance,
      reference_type: 'adjustment',
      reference_id: referenceId,
      description: reason,
    });

    await recordAudit(tx, {
      orgId,
      ...(actorType === 'user' && { actorUserId: byUserId }),
      actorType,
      action: 'credit.adjusted',
      subjectType: 'credit_ledger',
      subjectId: referenceId,
      metadata: { deltaCents, reason, balanceBefore: currentBalance, balanceAfter: newBalance },
    });
  });
}

// ─── Read helpers ──────────────────────────────────────────────────────────────

export type LedgerEntryType = (typeof creditEntryTypeEnum.enumValues)[number];

export type LedgerFilter = {
  page: number;
  pageSize: number;
  entryType: LedgerEntryType | null;
  dateFrom: Date | null;
  dateTo: Date | null;
};

export type PackagePool = {
  packageName: string;
  includedMinutes: number;
  priceCents: number;
  purchasedAt: Date;
  invoiceUrl: string | null;
};

/**
 * Returns the current balance with a breakdown of purchased package pools.
 * Pools are ordered newest-first.
 */
export async function getBalanceWithBreakdown(orgId: string): Promise<{
  balanceCents: number;
  remainingMinutes: number;
  pools: PackagePool[];
}> {
  return withOrgContext(orgId, async (tx) => {
    const [latest] = await tx
      .select({ balance_after_cents: creditLedger.balance_after_cents })
      .from(creditLedger)
      .where(eq(creditLedger.org_id, orgId))
      .orderBy(desc(creditLedger.created_at))
      .limit(1);

    const balanceCents = latest?.balance_after_cents ?? 0;
    const centsPerMinute = await weightedAvgCentsPerMinute(tx, orgId);
    const remainingMinutes =
      centsPerMinute !== null && centsPerMinute > 0
        ? Math.floor(balanceCents / centsPerMinute)
        : 0;

    const topupEntries = await tx
      .select({
        created_at: creditLedger.created_at,
        reference_id: creditLedger.reference_id,
        package_name: creditPackages.display_name,
        included_minutes: creditPackages.included_minutes,
        price_cents: creditPackages.price_cents,
        invoice_url: payments.invoice_url,
      })
      .from(creditLedger)
      .leftJoin(payments, eq(payments.stripe_payment_intent_id, creditLedger.reference_id))
      .leftJoin(creditPackages, eq(creditPackages.id, payments.package_id))
      .where(
        and(
          eq(creditLedger.org_id, orgId),
          eq(creditLedger.entry_type, 'topup'),
        ),
      )
      .orderBy(desc(creditLedger.created_at));

    const pools: PackagePool[] = topupEntries
      .filter((e) => e.package_name !== null)
      .map((e) => ({
        packageName: e.package_name!,
        includedMinutes: e.included_minutes!,
        priceCents: e.price_cents!,
        purchasedAt: e.created_at,
        invoiceUrl: e.invoice_url ?? null,
      }));

    return { balanceCents, remainingMinutes, pools };
  });
}

/**
 * Checks whether the org has sufficient credit to afford a campaign.
 * Returns `{ ok: true }` when the current balance covers the estimate,
 * or `{ ok: false, currentCents, requiredCents }` otherwise.
 *
 * Used by the campaign launch flow (plan 09) and the creation wizard to
 * show a warning when estimated cost exceeds 80% of available credit.
 */
export async function canAffordCampaign(
  orgId: string,
  estimateCents: number,
): Promise<{ ok: true } | { ok: false; currentCents: number; requiredCents: number }> {
  const { balanceCents } = await getBalance(orgId);
  if (balanceCents >= estimateCents) {
    return { ok: true };
  }
  return { ok: false, currentCents: balanceCents, requiredCents: estimateCents };
}

/**
 * Returns a paginated slice of the credit ledger with optional filters.
 * Total count is returned for pagination controls.
 */
export async function getLedgerHistory(
  orgId: string,
  filter: LedgerFilter,
): Promise<{
  entries: Array<{
    id: string;
    entry_type: LedgerEntryType;
    delta_cents: number;
    balance_after_cents: number;
    description: string | null;
    reference_type: string | null;
    reference_id: string | null;
    invoice_url: string | null;
    created_at: Date;
  }>;
  total: number;
}> {
  return withOrgContext(orgId, async (tx) => {
    const conditions: ReturnType<typeof eq>[] = [eq(creditLedger.org_id, orgId)];

    if (filter.entryType) {
      conditions.push(eq(creditLedger.entry_type, filter.entryType));
    }
    if (filter.dateFrom) {
      conditions.push(gte(creditLedger.created_at, filter.dateFrom));
    }
    if (filter.dateTo) {
      conditions.push(lte(creditLedger.created_at, filter.dateTo));
    }

    const where = and(...conditions);

    const [countRow] = await tx
      .select({ total: count() })
      .from(creditLedger)
      .where(where);

    const entries = await tx
      .select({
        id: creditLedger.id,
        entry_type: creditLedger.entry_type,
        delta_cents: creditLedger.delta_cents,
        balance_after_cents: creditLedger.balance_after_cents,
        description: creditLedger.description,
        reference_type: creditLedger.reference_type,
        reference_id: creditLedger.reference_id,
        invoice_url: payments.invoice_url,
        created_at: creditLedger.created_at,
      })
      .from(creditLedger)
      .leftJoin(
        payments,
        and(
          eq(creditLedger.reference_type, 'payment'),
          eq(creditLedger.reference_id, payments.stripe_payment_intent_id),
        ),
      )
      .where(where)
      .orderBy(desc(creditLedger.created_at))
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);

    return { entries, total: countRow?.total ?? 0 };
  });
}

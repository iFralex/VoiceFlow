import { timingSafeEqual } from 'crypto';

import { and, desc, eq, gte, lt, sum } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { recordAudit } from '@/lib/db/audit';
import { withSystemContext } from '@/lib/db/context';
import { creditLedger, payments } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { topUp } from '@/lib/services/credit';
import { stripe } from '@/lib/stripe/client';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function authorize(request: Request): boolean {
  const secret = env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  const expected = `Bearer ${secret}`;
  if (!auth || auth.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(auth), Buffer.from(expected));
}

// ---------------------------------------------------------------------------
// Part 1: Reconcile pending payments stuck for >2 hours
// ---------------------------------------------------------------------------

interface ReconcileResult {
  reconciled: number;
  errors: number;
}

export async function reconcilePendingPayments(): Promise<ReconcileResult> {
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);

  const stuckPayments = await withSystemContext(async (tx) =>
    tx
      .select({
        id: payments.id,
        org_id: payments.org_id,
        stripe_session_id: payments.stripe_session_id,
        amount_cents: payments.amount_cents,
        package_id: payments.package_id,
      })
      .from(payments)
      .where(and(eq(payments.status, 'pending'), lt(payments.created_at, cutoff))),
  );

  let reconciled = 0;
  let errors = 0;

  for (const payment of stuckPayments) {
    try {
      const session = await stripe.checkout.sessions.retrieve(payment.stripe_session_id);

      if (session.status === 'complete') {
        const paymentIntentId =
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : (session.payment_intent?.id ?? null);

        if (!paymentIntentId) continue;

        let invoiceUrl: string | null = null;
        if (session.invoice) {
          const invoiceId =
            typeof session.invoice === 'string' ? session.invoice : session.invoice.id;
          try {
            const invoice = await stripe.invoices.retrieve(invoiceId);
            invoiceUrl = invoice.hosted_invoice_url ?? null;
          } catch {
            // Non-fatal — continue without invoice URL
          }
        }

        await withSystemContext(async (tx) => {
          await tx
            .update(payments)
            .set({
              status: 'succeeded',
              stripe_payment_intent_id: paymentIntentId,
              invoice_url: invoiceUrl,
              completed_at: new Date(),
            })
            .where(and(eq(payments.id, payment.id), eq(payments.status, 'pending')));

          await recordAudit(tx, {
            orgId: payment.org_id,
            actorType: 'system',
            action: 'payment.reconciled',
            subjectType: 'payment',
            subjectId: payment.id,
            metadata: { paymentIntentId, source: 'cron-reconciliation' },
          });
        });

        await topUp(payment.org_id, {
          amountCents: payment.amount_cents,
          packageId: payment.package_id,
          stripePaymentIntentId: paymentIntentId,
          description: `Top-up reconciled by cron for session ${payment.stripe_session_id}`,
        });

        reconciled++;
      } else if (session.status === 'expired') {
        await withSystemContext(async (tx) => {
          await tx
            .update(payments)
            .set({ status: 'failed' })
            .where(eq(payments.id, payment.id));
        });
        reconciled++;
      }
      // If 'open', leave it — may still complete via webhook
    } catch (err) {
      console.error('[credit-reconciliation] Error reconciling payment', {
        paymentId: payment.id,
        error: err instanceof Error ? err.message : String(err),
      });
      errors++;
    }
  }

  return { reconciled, errors };
}

// ---------------------------------------------------------------------------
// Part 2: Ledger sanity check (last 24 hours)
// ---------------------------------------------------------------------------

// Alert threshold: €0.10 = 10 cents
const DISCREPANCY_ALERT_CENTS = 10;

interface SanityResult {
  orgsChecked: number;
  discrepancies: number;
}

export async function runLedgerSanityCheck(): Promise<SanityResult> {
  const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Find orgs with ledger activity in the last 24h
  const activeOrgs = await withSystemContext(async (tx) =>
    tx
      .selectDistinct({ org_id: creditLedger.org_id })
      .from(creditLedger)
      .where(gte(creditLedger.created_at, windowStart)),
  );

  let orgsChecked = 0;
  let discrepancies = 0;

  for (const { org_id } of activeOrgs) {
    try {
      // Sum of delta_cents in the last 24h
      const [deltaRow] = await withSystemContext(async (tx) =>
        tx
          .select({ total_delta: sum(creditLedger.delta_cents) })
          .from(creditLedger)
          .where(
            and(
              eq(creditLedger.org_id, org_id),
              gte(creditLedger.created_at, windowStart),
            ),
          ),
      );

      const totalDelta = Math.round(Number(deltaRow?.total_delta ?? 0));

      // Balance just before the window (most recent entry before windowStart)
      const [beforeRow] = await withSystemContext(async (tx) =>
        tx
          .select({ balance_after_cents: creditLedger.balance_after_cents })
          .from(creditLedger)
          .where(and(eq(creditLedger.org_id, org_id), lt(creditLedger.created_at, windowStart)))
          .orderBy(desc(creditLedger.created_at))
          .limit(1),
      );

      const balanceBefore = beforeRow?.balance_after_cents ?? 0;

      // Current balance (most recent ledger entry overall)
      const [currentRow] = await withSystemContext(async (tx) =>
        tx
          .select({ balance_after_cents: creditLedger.balance_after_cents })
          .from(creditLedger)
          .where(eq(creditLedger.org_id, org_id))
          .orderBy(desc(creditLedger.created_at))
          .limit(1),
      );

      const balanceCurrent = currentRow?.balance_after_cents ?? 0;
      const expectedDelta = balanceCurrent - balanceBefore;
      const discrepancyCents = Math.abs(totalDelta - expectedDelta);

      if (discrepancyCents > 0) {
        const severity = discrepancyCents > DISCREPANCY_ALERT_CENTS ? 'ALERT' : 'INFO';
        console.error(`[credit-reconciliation] ${severity} ledger discrepancy`, {
          org_id,
          totalDelta,
          expectedDelta,
          discrepancyCents,
          balanceBefore,
          balanceCurrent,
        });

        if (discrepancyCents > DISCREPANCY_ALERT_CENTS) {
          discrepancies++;
        }
      }

      orgsChecked++;
    } catch (err) {
      console.error('[credit-reconciliation] Error during sanity check for org', {
        org_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { orgsChecked, discrepancies };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<Response> {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [pendingPayments, ledgerSanity] = await Promise.all([
    reconcilePendingPayments(),
    runLedgerSanityCheck(),
  ]);

  return NextResponse.json({ ok: true, pendingPayments, ledgerSanity });
}

// Disable static caching — this must always run fresh
export const dynamic = 'force-dynamic';

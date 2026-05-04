'use server';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { getAuthContext, requireCapability } from '@/lib/auth/context';
import { withOrgContext, withSystemContext } from '@/lib/db/context';
import { creditPackages, payments } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { getBalance, getBalanceWithBreakdown, getLedgerHistory } from '@/lib/services/credit';
import type { LedgerEntryType, PackagePool } from '@/lib/services/credit';
import { getOrCreateCustomerForOrg, stripe } from '@/lib/stripe';
import type { ActionResult } from '@/lib/utils/action-toast';

const createTopupSessionSchema = z.object({
  packageId: z.string().uuid('invalid_package_id'),
});

export async function createTopupSession(
  input: z.infer<typeof createTopupSessionSchema>,
): Promise<ActionResult & { url?: string }> {
  const parsed = createTopupSessionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: 'invalid_package_id' };
  }

  const { packageId } = parsed.data;

  const { orgId } = await getAuthContext();
  await requireCapability('billing.topup');

  // Look up credit package (global table — no org context needed)
  const [pkg] = await withSystemContext(async (tx) => {
    return tx
      .select()
      .from(creditPackages)
      .where(eq(creditPackages.id, packageId))
      .limit(1);
  });

  if (!pkg) {
    return { ok: false, message: 'package_not_found' };
  }

  if (!pkg.stripe_price_id) {
    return { ok: false, message: 'package_not_available' };
  }

  const stripeCustomerId = await getOrCreateCustomerForOrg(orgId);

  // Pre-generate the payments row ID so we can include it in Stripe metadata
  const paymentsId = crypto.randomUUID();

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: stripeCustomerId,
    line_items: [{ price: pkg.stripe_price_id, quantity: 1 }],
    success_url: `${env.NEXT_PUBLIC_APP_URL}/credit/topup/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.NEXT_PUBLIC_APP_URL}/credit/topup?cancelled=1`,
    automatic_tax: { enabled: true },
    payment_method_types: ['card', 'sepa_debit'],
    invoice_creation: { enabled: true },
    customer_update: { address: 'auto', name: 'auto' },
    metadata: {
      org_id: orgId,
      package_id: packageId,
      internal_session_id: paymentsId,
    },
  });

  if (!session.url) {
    return { ok: false, message: 'session_creation_failed' };
  }

  await withOrgContext(orgId, async (tx) => {
    await tx.insert(payments).values({
      id: paymentsId,
      org_id: orgId,
      package_id: packageId,
      stripe_session_id: session.id,
      amount_cents: pkg.price_cents,
      currency: 'eur',
      status: 'pending',
    });
  });

  return { ok: true, url: session.url };
}

export type PaymentStatusResult =
  | { ok: false; message: string }
  | { ok: true; status: 'pending' | 'succeeded' | 'failed' | 'refunded'; balanceCents?: number; remainingMinutes?: number };

/**
 * Returns the current status of a payment by stripe_session_id.
 * When succeeded, also returns the org's current credit balance.
 * Called by the success page client component for polling.
 */
export async function checkPaymentStatus(stripeSessionId: string): Promise<PaymentStatusResult> {
  const { orgId } = await getAuthContext();

  const [payment] = await withOrgContext(orgId, async (tx) => {
    return tx
      .select({ id: payments.id, status: payments.status })
      .from(payments)
      .where(and(eq(payments.stripe_session_id, stripeSessionId), eq(payments.org_id, orgId)))
      .limit(1);
  });

  if (!payment) {
    return { ok: false, message: 'payment_not_found' };
  }

  if (payment.status === 'succeeded') {
    const balance = await getBalance(orgId);
    return { ok: true, status: 'succeeded', ...balance };
  }

  return { ok: true, status: payment.status };
}

// ─── Credit page data ─────────────────────────────────────────────────────────

export type CreditPageDataResult =
  | { ok: false; message: string }
  | {
      ok: true;
      balanceCents: number;
      remainingMinutes: number;
      pools: PackagePool[];
    };

/**
 * Fetches balance + package pool breakdown for the credit overview page.
 */
export async function getCreditPageData(): Promise<CreditPageDataResult> {
  const { orgId } = await getAuthContext();
  const data = await getBalanceWithBreakdown(orgId);
  return { ok: true, ...data };
}

export type LedgerPageResult =
  | { ok: false; message: string }
  | {
      ok: true;
      entries: Array<{
        id: string;
        entry_type: LedgerEntryType;
        delta_cents: number;
        balance_after_cents: number;
        description: string | null;
        reference_type: string | null;
        reference_id: string | null;
        invoice_url: string | null;
        created_at: string; // ISO string for serialisation
      }>;
      total: number;
    };

const ledgerPageSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  entryType: z
    .enum(['topup', 'reservation', 'release', 'charge', 'refund', 'adjustment'])
    .nullable()
    .default(null),
  dateFrom: z.string().datetime({ offset: true }).nullable().default(null),
  dateTo: z.string().datetime({ offset: true }).nullable().default(null),
});

/**
 * Returns one page of ledger entries with optional type/date filters.
 */
export async function getLedgerPage(
  params: z.infer<typeof ledgerPageSchema>,
): Promise<LedgerPageResult> {
  const parsed = ledgerPageSchema.safeParse(params);
  if (!parsed.success) return { ok: false, message: 'invalid_params' };

  const { orgId } = await getAuthContext();
  const { page, pageSize, entryType, dateFrom, dateTo } = parsed.data;

  const result = await getLedgerHistory(orgId, {
    page,
    pageSize,
    entryType: entryType as LedgerEntryType | null,
    dateFrom: dateFrom ? new Date(dateFrom) : null,
    dateTo: dateTo ? new Date(dateTo) : null,
  });

  return {
    ok: true,
    entries: result.entries.map((e) => ({
      ...e,
      invoice_url: e.invoice_url ?? null,
      created_at: e.created_at.toISOString(),
    })),
    total: result.total,
  };
}

/**
 * Creates a Stripe Billing Portal session for the org's customer.
 * Returns the portal URL so the client can redirect to "Storico fatture".
 */
export async function createBillingPortalSession(): Promise<ActionResult & { url?: string }> {
  const { orgId } = await getAuthContext();
  await requireCapability('billing.topup');

  const stripeCustomerId = await getOrCreateCustomerForOrg(orgId);

  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${env.NEXT_PUBLIC_APP_URL}/settings/organization`,
  });

  return { ok: true, url: session.url };
}

const exportCsvSchema = z.object({
  entryType: z
    .enum(['topup', 'reservation', 'release', 'charge', 'refund', 'adjustment'])
    .nullable()
    .default(null),
  dateFrom: z.string().datetime({ offset: true }).nullable().default(null),
  dateTo: z.string().datetime({ offset: true }).nullable().default(null),
});

/**
 * Exports all matching ledger entries as a CSV string (max 5,000 rows).
 */
export async function exportLedgerCsv(
  params: z.infer<typeof exportCsvSchema>,
): Promise<ActionResult & { csv?: string }> {
  const parsed = exportCsvSchema.safeParse(params);
  if (!parsed.success) return { ok: false, message: 'invalid_params' };

  const { orgId } = await getAuthContext();
  const { entryType, dateFrom, dateTo } = parsed.data;

  const result = await getLedgerHistory(orgId, {
    page: 1,
    pageSize: 5000,
    entryType: entryType as LedgerEntryType | null,
    dateFrom: dateFrom ? new Date(dateFrom) : null,
    dateTo: dateTo ? new Date(dateTo) : null,
  });

  const header = 'id,type,description,delta_cents,balance_after_cents,reference_type,reference_id,created_at';
  const rows = result.entries.map((e) =>
    [
      e.id,
      e.entry_type,
      `"${(e.description ?? '').replace(/"/g, '""')}"`,
      e.delta_cents,
      e.balance_after_cents,
      e.reference_type ?? '',
      e.reference_id ?? '',
      e.created_at.toISOString(),
    ].join(','),
  );

  return { ok: true, csv: [header, ...rows].join('\n') };
}

'use server';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { getAuthContext, requireCapability } from '@/lib/auth/context';
import { withOrgContext, withSystemContext } from '@/lib/db/context';
import { creditPackages, payments } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { getBalance } from '@/lib/services/credit';
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

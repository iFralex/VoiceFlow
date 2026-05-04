import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import type Stripe from 'stripe';

import { recordAudit } from '@/lib/db/audit';
import { withSystemContext } from '@/lib/db/context';
import { organizations, payments, webhookEvents } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { adjust, refundCall, topUp } from '@/lib/services/credit';
import { stripe } from '@/lib/stripe/client';
import { verifyStripeWebhook } from '@/lib/stripe/verify';

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const orgId = session.metadata?.org_id;
  const packageId = session.metadata?.package_id;

  if (!orgId || !packageId) return;

  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);

  if (!paymentIntentId) return;

  // Fetch invoice URL outside the transaction (Stripe API call)
  let invoiceUrl: string | null = null;
  if (session.invoice) {
    const invoiceId =
      typeof session.invoice === 'string' ? session.invoice : session.invoice.id;
    try {
      const invoice = await stripe.invoices.retrieve(invoiceId);
      invoiceUrl = invoice.hosted_invoice_url ?? null;
    } catch {
      // Non-fatal — continue without invoice URL; the URL can be back-filled later
    }
  }

  // Update payment row and record audit in one transaction
  const [payment] = await withSystemContext(async (tx) => {
    const updated = await tx
      .update(payments)
      .set({
        status: 'succeeded',
        stripe_payment_intent_id: paymentIntentId,
        invoice_url: invoiceUrl,
        completed_at: new Date(),
      })
      .where(eq(payments.stripe_session_id, session.id))
      .returning({
        id: payments.id,
        org_id: payments.org_id,
        amount_cents: payments.amount_cents,
        package_id: payments.package_id,
      });

    if (updated[0]) {
      await recordAudit(tx, {
        orgId,
        actorType: 'system',
        action: 'payment.succeeded',
        subjectType: 'payment',
        subjectId: updated[0].id,
        metadata: {
          amountCents: updated[0].amount_cents,
          packageId,
          paymentIntentId,
          invoiceUrl,
        },
      });
    }

    return updated;
  });

  if (!payment) return;

  // Credit the ledger (idempotent on stripePaymentIntentId)
  await topUp(orgId, {
    amountCents: payment.amount_cents,
    packageId: payment.package_id,
    stripePaymentIntentId: paymentIntentId,
    description: `Top-up via Stripe Checkout session ${session.id}`,
  });
}

async function handleCheckoutSessionExpired(session: Stripe.Checkout.Session): Promise<void> {
  await withSystemContext(async (tx) => {
    await tx
      .update(payments)
      .set({ status: 'failed' })
      .where(eq(payments.stripe_session_id, session.id));
  });
}

async function handlePaymentIntentFailed(pi: Stripe.PaymentIntent): Promise<void> {
  // The payment row uses stripe_session_id as its key. Look up the session via Stripe API.
  const sessionsList = await stripe.checkout.sessions.list({ payment_intent: pi.id, limit: 1 });
  const stripeSession = sessionsList.data[0];
  if (!stripeSession) return; // Not a top-up payment intent

  await withSystemContext(async (tx) => {
    await tx
      .update(payments)
      .set({ status: 'failed' })
      .where(eq(payments.stripe_session_id, stripeSession.id));
  });
}

async function handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
  const refundedCents = charge.amount_refunded;
  if (refundedCents === 0) return;

  // Check for a direct call-level refund (metadata set by Wave 3 call processing)
  const callId = charge.metadata?.call_id;
  const directOrgId = charge.metadata?.org_id;

  if (callId && directOrgId) {
    await refundCall(directOrgId, callId, refundedCents, `Stripe refund for charge ${charge.id}`);
    return;
  }

  // Top-up refund: find the payment by payment_intent_id
  const paymentIntentId =
    typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : (charge.payment_intent?.id ?? null);

  if (!paymentIntentId) return;

  const [payment] = await withSystemContext(async (tx) =>
    tx
      .select({ id: payments.id, org_id: payments.org_id })
      .from(payments)
      .where(eq(payments.stripe_payment_intent_id, paymentIntentId))
      .limit(1),
  );

  if (!payment) return;

  // Debit the refunded amount from the credit balance and mark the payment refunded
  await adjust(
    payment.org_id,
    'stripe-webhook',
    -refundedCents,
    `Stripe refund for charge ${charge.id}`,
    { actorType: 'system' },
  );

  await withSystemContext(async (tx) => {
    await tx
      .update(payments)
      .set({ status: 'refunded' })
      .where(eq(payments.id, payment.id));
  });
}

async function handleCustomerUpdated(customer: Stripe.Customer): Promise<void> {
  const orgId = customer.metadata?.org_id;
  if (!orgId) return;

  const updates: { legal_name?: string | null; vat_number?: string | null } = {};

  if (customer.name !== undefined) {
    updates.legal_name = customer.name;
  }
  if (customer.metadata?.vat_number !== undefined) {
    updates.vat_number = customer.metadata.vat_number || null;
  }

  if (Object.keys(updates).length === 0) return;

  await withSystemContext(async (tx) => {
    await tx.update(organizations).set(updates).where(eq(organizations.id, orgId));
  });
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = verifyStripeWebhook(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${message}` },
      { status: 400 },
    );
  }

  // Deduplicate: persist event payload regardless of processing outcome.
  // onConflictDoNothing returns [] when the event was already received.
  const [inserted] = await withSystemContext(async (tx) =>
    tx
      .insert(webhookEvents)
      .values({
        provider: 'stripe',
        provider_event_id: event.id,
        event_type: event.type,
        payload: event as unknown as Record<string, unknown>,
      })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id }),
  );

  if (!inserted) {
    // Already received — return 200 to acknowledge without re-processing
    return NextResponse.json({ ok: true });
  }

  // Dispatch to the appropriate handler
  let processingError: string | null = null;

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'checkout.session.expired':
        await handleCheckoutSessionExpired(event.data.object as Stripe.Checkout.Session);
        break;
      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
        break;
      case 'charge.refunded':
        await handleChargeRefunded(event.data.object as Stripe.Charge);
        break;
      case 'customer.updated':
        await handleCustomerUpdated(event.data.object as Stripe.Customer);
        break;
      default:
        // Unknown event type — payload is persisted for visibility; no processing needed
        break;
    }

    // Mark the event as successfully processed
    await withSystemContext(async (tx) => {
      await tx
        .update(webhookEvents)
        .set({ processed_at: new Date() })
        .where(
          and(
            eq(webhookEvents.provider, 'stripe'),
            eq(webhookEvents.provider_event_id, event.id),
          ),
        );
    });
  } catch (err) {
    processingError = err instanceof Error ? err.message : 'Unknown processing error';

    // Record the error but still return 200 — signature was valid; avoid Stripe retries
    // on business-logic failures. Task 16's reconciliation cron handles stuck payments.
    await withSystemContext(async (tx) => {
      await tx
        .update(webhookEvents)
        .set({ error: processingError })
        .where(
          and(
            eq(webhookEvents.provider, 'stripe'),
            eq(webhookEvents.provider_event_id, event.id),
          ),
        );
    });
  }

  return NextResponse.json({ ok: true });
}

import type Stripe from 'stripe';

import { stripe } from './client';

/**
 * Verifies a Stripe webhook signature and returns the parsed event.
 *
 * Extracted from the webhook route handler so it can be unit-tested with
 * fixture payloads and a known signing secret without an HTTP context.
 *
 * @param rawBody - Raw request body string (must not be parsed first)
 * @param signature - Value of the `stripe-signature` header
 * @param secret - Webhook signing secret (starts with `whsec_`)
 * @param tolerance - Maximum age of the event in seconds (default 300)
 * @throws {Error} when signature is invalid or the event is too old
 */
export function verifyStripeWebhook(
  rawBody: string,
  signature: string,
  secret: string,
  tolerance?: number,
): Stripe.Event {
  return stripe.webhooks.constructEvent(rawBody, signature, secret, tolerance);
}

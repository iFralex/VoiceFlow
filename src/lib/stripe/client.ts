import { eq } from 'drizzle-orm';
import Stripe from 'stripe';

import { withOrgContext, withSystemContext } from '@/lib/db/context';
import { organizations } from '@/lib/db/schema/organizations';
import { env } from '@/lib/env';

/**
 * Singleton Stripe client with pinned API version.
 * Only use in server-side code (Server Actions, Route Handlers, Services).
 */
export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: '2026-04-22.dahlia',
});

/**
 * Returns the Stripe Customer ID for an org, creating one if it doesn't exist yet.
 * Persists the customer ID back to `organizations.stripe_customer_id` on first creation.
 */
export async function getOrCreateCustomerForOrg(orgId: string): Promise<string> {
  // Read the org to check for existing customer id
  const [org] = await withSystemContext(async (tx) =>
    tx
      .select({
        id: organizations.id,
        name: organizations.name,
        legal_name: organizations.legal_name,
        vat_number: organizations.vat_number,
        stripe_customer_id: organizations.stripe_customer_id,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1),
  );

  if (!org) {
    throw new Error(`Organization not found: ${orgId}`);
  }

  if (org.stripe_customer_id) {
    return org.stripe_customer_id;
  }

  // Create a new Stripe Customer
  const customer = await stripe.customers.create({
    name: org.legal_name ?? org.name,
    metadata: {
      org_id: orgId,
      vat_number: org.vat_number ?? '',
      legal_name: org.legal_name ?? '',
    },
  });

  // Persist the customer id back to the database inside the org's RLS context
  await withOrgContext(orgId, async (tx) => {
    await tx
      .update(organizations)
      .set({ stripe_customer_id: customer.id })
      .where(eq(organizations.id, orgId));
  });

  return customer.id;
}

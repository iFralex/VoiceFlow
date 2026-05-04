-- Migration: add stripe_customer_id to organizations
-- Stores the Stripe Customer ID so we don't need to create a new customer
-- on every checkout session creation.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

-- Migration: extend `opt_out_source` enum with the `rpo_block` value.
--
-- Plan 11 task 5 consolidates all five opt-out sources behind the unified
-- `markOptOut` service in `src/lib/services/optout.ts`. The five sources are
-- `call_outcome`, `dealer_input`, `gdpr_request`, `inbound_ivr`, and the new
-- `rpo_block` (RPO snapshot transitions a number from clear → blocked).
--
-- Prior to this migration, RPO-driven opt-outs were written to `contacts`
-- (opt_out=true, opt_out_reason='rpo_block') without a corresponding entry in
-- `opt_out_registry`. The unified service now writes both, which requires the
-- enum to accept the new value.
--
-- Postgres 12+ allows ADD VALUE outside a transaction block. drizzle-kit's
-- migration runner wraps statements in a transaction by default, so we must
-- emit the ADD VALUE through a DO block that uses `IF NOT EXISTS` semantics
-- (Postgres 14+) to make the migration idempotent.

ALTER TYPE "public"."opt_out_source" ADD VALUE IF NOT EXISTS 'rpo_block';

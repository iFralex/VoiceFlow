# Plan: Foundation — Supabase, Schema, RLS, Seed

**Branch:** `feat/02-foundation-supabase-schema`
**Wave:** 1
**Depends on:** none (parallel with 01 and 03; merge order with 01 doesn't matter, but Drizzle config from 01 is consumed)
**Estimated effort:** 3–4 days

## Overview

Provisions Supabase projects (dev, staging, production), authors the full Drizzle schema for all 16 tables described in spec §7.2, applies Row Level Security policies on every org-scoped table per spec §7.3, ships the seed data (script templates and credit packages), and provides a transactional test harness used by every later plan.

## Context

The data model has four invariants (tenancy, money-as-cents, time-as-UTC-timestamptz, audit) that every table must respect (spec §7.1). RLS uses a session GUC `app.current_org_id` set by middleware (§14.3). Seed data covers the five script templates (`lead-reactivation`, `appointment-confirm`, `car-renewal`, `post-sale-followup`, `csi-survey`) per §8.3 and the five credit packages from §11. The `audit_log` and `webhook_events` tables enforce idempotency invariants used everywhere downstream.

## Validation Commands

- `pnpm typecheck`
- `pnpm db:generate`
- `pnpm db:migrate`
- `pnpm db:seed`
- `pnpm test src/lib/db`
- `pnpm test:integration`
- `psql $DATABASE_URL -c "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"` (must show all 16 tables)
- `psql $DATABASE_URL -c "SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity = false AND tablename NOT IN ('script_templates','credit_packages','rpo_snapshots','webhook_events','audit_log')"` (must return zero rows)

### Task 1: Provision Supabase projects

- [x] Create three Supabase projects: `VoiceFlow-dev`, `VoiceFlow-staging`, `VoiceFlow-prod`, all in EU region (Frankfurt)
- [x] For each project enable Postgres 16, Authentication, Storage, Realtime
- [x] Capture project URLs, anon keys, service-role keys, pooler and direct connection strings into 1Password vault entries
- [x] Configure Storage buckets (private): `recordings`, `transcripts`, `csv-uploads`, `exports`. Set max file sizes (500MB recordings, 50MB CSV)
- [x] Configure Auth providers: email + magic link only (no password, no OAuth in Phase 1)
- [x] Set Auth email templates to Italian (signup confirmation, magic link, password reset placeholders, change email confirm)
- [x] Set magic link expiry to 30 minutes; OTP length 6 digits
- [x] Set Auth redirect allowlist for production, staging, and `http://localhost:3000`
- [x] Mark completed

### Task 2: Drizzle schema — organizations, users, memberships

- [x] Create `src/lib/db/schema/organizations.ts` with the `organizations` table per spec §7.2 (`id`, `name`, `legal_name`, `vat_number`, `country` default `IT`, `timezone` default `Europe/Rome`, `created_at`, `deleted_at`)
- [x] Create `src/lib/db/schema/users.ts` mirroring Supabase Auth `auth.users.id` (uuid PK, `email`, `full_name`, `locale` enum `it|en` default `it`, `created_at`)
- [x] Create `src/lib/db/schema/memberships.ts` with `id`, `org_id`, `user_id`, `role` enum (`owner|admin|operator|viewer`), `invited_at`, `accepted_at`, unique constraint on `(org_id, user_id)`, FKs with `onDelete: cascade`
- [x] Define enum types using Drizzle `pgEnum` for `member_role` and `user_locale`
- [x] Add indexes: `memberships(user_id)`, `memberships(org_id)`
- [x] Mark completed

### Task 3: Drizzle schema — scripts and templates

- [x] Create `src/lib/db/schema/script_templates.ts` (system-owned, no `org_id`, no RLS) with `id`, `slug` UNIQUE, `name`, `version` int, `system_prompt` text, `variable_schema` jsonb, `default_voice_id`, `default_language` default `it-IT`, `published_at`, `created_at`
- [x] Create `src/lib/db/schema/scripts.ts` (org-scoped) with `id`, `org_id`, `template_id`, `name`, `variables` jsonb, `voice_id` nullable (override), `created_at`, `updated_at`
- [x] Add unique on `script_templates(slug, version)` to permit versioning
- [x] Add index `scripts(org_id)`
- [x] Mark completed

### Task 4: Drizzle schema — contacts and lists

- [x] Create `src/lib/db/schema/contact_lists.ts` with `id`, `org_id`, `name`, `source` enum (`csv-upload|zapier|api`), `source_file_path`, `total_count`, `valid_count`, `created_at`
- [x] Create `src/lib/db/schema/contacts.ts` with all columns from spec §7.2: `id`, `org_id`, `contact_list_id`, `phone_e164`, `first_name`, `last_name`, `email`, `consent_basis` enum (`consent|legitimate_interest|existing_customer`), `consent_evidence`, `contact_type` enum (`b2c|b2b`) default `b2c`, `rpo_status` enum (`clear|blocked|unchecked`), `rpo_checked_at`, `opt_out` boolean default false, `opt_out_reason`, `metadata` jsonb, `created_at`, `deleted_at` (soft delete)
- [x] Add composite unique `(org_id, phone_e164)` partial index `WHERE deleted_at IS NULL`
- [x] Add indexes: `contacts(contact_list_id)`, `contacts(org_id, opt_out, rpo_status)`
- [x] Mark completed

### Task 5: Drizzle schema — campaigns and calls

- [x] Create `src/lib/db/schema/campaigns.ts` with all columns from spec §7.2 including `concurrency_limit` default 5, `time_window_start` default `09:00`, `time_window_end` default `19:00`, `estimated_max_cents` int, `actual_cents` int default 0, `status` enum (`draft|scheduled|running|paused|completed|cancelled`)
- [x] Create `src/lib/db/schema/calls.ts` with all columns from spec §7.2 including `provider` enum (`vapi|retell|proprietary`), `status` enum (`pending|dialing|in_progress|completed|failed|no_answer|voicemail|busy`), `outcome` enum (`interested|not_interested|appointment_booked|wrong_number|callback_requested|voicemail_left|do_not_call`), `outcome_confidence` numeric(3,2), `billable_seconds` int, `cost_cents` int, `recording_path`, `transcript_path`, `transferred_to_agent` boolean, `error_code`
- [x] Create `src/lib/db/schema/appointments.ts` with `id`, `org_id`, `call_id`, `contact_id`, `scheduled_at`, `notes`, `status` enum (`booked|confirmed|cancelled|no_show|completed`), `created_at`
- [x] Add indexes: `calls(org_id, campaign_id, status)`, `calls(org_id, contact_id)`, partial index on `calls(provider_call_id)` WHERE not null, `appointments(org_id, scheduled_at)`
- [x] Mark completed

### Task 6: Drizzle schema — billing

- [x] Create `src/lib/db/schema/credit_packages.ts` (system-owned) with `id`, `slug` UNIQUE, `display_name`, `price_cents`, `included_minutes`, `stripe_price_id`, `active` boolean
- [x] Create `src/lib/db/schema/credit_ledger.ts` with `id`, `org_id`, `entry_type` enum (`topup|reservation|release|charge|refund|adjustment`), `delta_cents` int, `balance_after_cents` int, `reference_type`, `reference_id`, `description`, `created_at`
- [x] Add unique index on `credit_ledger(org_id, reference_type, reference_id, entry_type)` enforcing idempotency per spec §11.1
- [x] Add index `credit_ledger(org_id, created_at DESC)` for fast balance queries
- [x] Create `src/lib/db/schema/payments.ts` with `id`, `org_id`, `package_id`, `stripe_session_id` UNIQUE, `stripe_payment_intent_id`, `amount_cents`, `currency` default `eur`, `status` enum (`pending|succeeded|failed|refunded`), `invoice_url`, `created_at`, `completed_at`
- [x] Mark completed

### Task 7: Drizzle schema — compliance

- [x] Create `src/lib/db/schema/opt_out_registry.ts` with `id`, `org_id`, `phone_e164`, `source` enum (`call_outcome|dealer_input|gdpr_request|inbound_ivr`), `recorded_at` and unique constraint on `(org_id, phone_e164)`
- [x] Create `src/lib/db/schema/rpo_snapshots.ts` (system-owned, no RLS) with `phone_e164` PK, `is_blocked`, `last_checked_at`
- [x] Create `src/lib/db/schema/audit_log.ts` with `id` bigserial, `org_id` nullable, `actor_user_id` nullable, `actor_type` enum (`user|system|webhook`), `action`, `subject_type`, `subject_id`, `metadata` jsonb, `created_at`
- [x] Add index `audit_log(org_id, created_at DESC)`, partial index `audit_log(action)` for hot actions
- [x] Create `src/lib/db/schema/webhook_events.ts` with `id`, `provider` enum (`stripe|vapi|retell|twilio`), `provider_event_id`, `event_type`, `payload` jsonb, `received_at`, `processed_at`, `error`
- [x] Add unique on `(provider, provider_event_id)` enforcing webhook idempotency
- [x] Mark completed

### Task 8: Drizzle schema — telephony pool

- [x] Create `src/lib/db/schema/phone_numbers.ts` per spec §9.2 with `id`, `e164` UNIQUE, `org_id` nullable (null = shared pool), `provider` enum (`voiped|twilio|telnyx`), `status` enum (`active|cooling_down|retired`), `last_used_at`, `daily_call_count` int default 0, `spam_score` numeric default 0, `created_at`
- [x] Add partial index `phone_numbers(org_id, status) WHERE status = 'active'` for fast pool selection
- [x] Mark completed

### Task 9: Drizzle schema — outbound webhooks subscriptions

- [x] Create `src/lib/db/schema/webhooks_outgoing.ts` (referenced by spec §13.2) with `id`, `org_id`, `url`, `secret`, `event_types` text array, `active` boolean, `created_at`, `last_delivery_at`, `last_failure_at`, `failure_count` int default 0
- [x] Create `src/lib/db/schema/webhook_deliveries.ts` log of outbound delivery attempts: `id`, `webhook_id`, `event_type`, `payload` jsonb, `status_code`, `attempt` int, `delivered_at`, `error`
- [x] Mark completed

### Task 10: Schema barrel export and types

- [x] Update `src/lib/db/schema/index.ts` to re-export every table and every enum
- [x] Define typed inference helpers per table:

```typescript
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
// ...repeat for every table
```

- [x] Confirm `pnpm typecheck` is clean
- [x] Mark completed

### Task 11: Generate first migration

- [x] Run `pnpm db:generate` to produce `drizzle/migrations/0000_init.sql`
- [x] Inspect generated SQL: confirm all 16 tables, all enums, all indexes are present
- [x] Apply to dev Supabase via `pnpm db:migrate`; verify in Supabase Studio
- [x] Commit the generated migration file (treat migrations as code per spec §7.4)
- [x] Mark completed

### Task 12: Row Level Security policies

- [x] Create `drizzle/migrations/0001_rls_policies.sql` containing the RLS setup. For every org-scoped table apply the pattern from spec §7.3:

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
CREATE POLICY <table>_org_isolation ON <table>
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);
```

- [x] List of tables that MUST have RLS: `organizations` (special: filter by membership), `memberships`, `scripts`, `contact_lists`, `contacts`, `campaigns`, `calls`, `appointments`, `credit_ledger`, `payments`, `opt_out_registry`, `phone_numbers` (only org-scoped rows), `webhooks_outgoing`, `webhook_deliveries`
- [x] System tables WITHOUT RLS: `script_templates`, `credit_packages`, `rpo_snapshots`, `webhook_events`, `audit_log` (RLS bypassed via service role; queried via service layer with explicit org filter)
- [x] For `organizations` define a policy joining via `memberships` so a user only sees orgs they belong to:

```sql
CREATE POLICY organizations_member_visibility ON organizations
  USING (id IN (
    SELECT org_id FROM memberships
    WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
  ));
```

- [x] Apply migration to dev; verify with a manual psql session
- [x] Mark completed

### Task 13: RLS context setter helper

- [x] Create `src/lib/db/context.ts` exposing `withOrgContext(orgId, fn)` that opens a transaction, calls `SET LOCAL app.current_org_id = ...` and runs `fn` with a transactional db client. Example:

```typescript
import { db } from './client';
export async function withOrgContext<T>(
  orgId: string,
  fn: (tx: typeof db) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
    return fn(tx);
  });
}
```

- [x] Add a `withSystemContext(fn)` for service-role operations that intentionally cross orgs (cron jobs, retention, RPO bulk checks)
- [x] Add unit tests verifying the GUC is set inside the transaction and reset outside
- [x] Mark completed

### Task 14: Audit-log immutability

- [x] In a new migration `0002_audit_immutable.sql` revoke `UPDATE` and `DELETE` on `audit_log` from the application role; only `INSERT` and `SELECT` allowed
- [x] Define helper `src/lib/db/audit.ts` with `recordAudit({ orgId, actorUserId, actorType, action, subjectType, subjectId, metadata })` invoked from inside transactions
- [x] Add unit tests confirming an attempted UPDATE on `audit_log` fails
- [x] Mark completed

### Task 15: Materialised credit balance trigger

- [x] Create migration `0003_credit_balance_trigger.sql` with a BEFORE INSERT trigger on `credit_ledger` that computes `balance_after_cents` as `(SELECT COALESCE(MAX(balance_after_cents), 0) FROM credit_ledger WHERE org_id = NEW.org_id) + NEW.delta_cents`
- [x] Add a unique partial constraint preventing concurrent inserts that would create stale balances: serialise per-org via SELECT FOR UPDATE in service layer (documented in plan 05)
- [x] Test the trigger by inserting a sequence of entries and verifying running balance is maintained
- [x] Mark completed

### Task 16: Seed — script templates

- [x] Create `src/lib/db/seed/script_templates.ts` with the five Italian-language templates per spec §8.3:
  - `lead-reactivation` — riattivazione di lead non chiusi
  - `appointment-confirm` — conferma appuntamento test drive o officina
  - `car-renewal` — cambio auto programmato (post 36–48 mesi)
  - `post-sale-followup` — verifica soddisfazione post-vendita
  - `csi-survey` — questionario CSI per le case madri
- [x] For each template author the `system_prompt` in Italian, including the AI Act disclosure preamble (note: the adapter prepends an additional canonical disclosure, but templates also state it explicitly per spec §12.3)
- [x] For each template define `variable_schema` JSON Schema with required variables (e.g. for `lead-reactivation`: `dealership_name`, `brand`, `salesperson_first_name`, `available_slots`, `lead_origin_context`, `incentive_to_offer`)
- [x] Set `default_voice_id` per template (revisited in plan 08)
- [x] Mark each as `version: 1` and `published_at: now()`
- [x] Mark completed

### Task 17: Seed — credit packages

- [x] Create `src/lib/db/seed/credit_packages.ts` with the five packages per spec §11 and business plan §6.1:
  - `test`: €99, 200 minutes, slug `test`
  - `starter`: €299, 700 minutes
  - `growth`: €799, 2000 minutes
  - `scale`: €1999, 5500 minutes
  - `enterprise`: marked `active = false` (custom only)
- [x] Leave `stripe_price_id` empty initially (populated by plan 05 after Stripe products are created)
- [x] Mark completed

### Task 18: Seed runner

- [ ] Create `src/lib/db/seed/index.ts` orchestrating idempotent seed (UPSERT on slug)
- [ ] Add `pnpm db:seed` script
- [ ] Run against dev; verify rows in Supabase Studio
- [ ] Mark completed

### Task 19: Test harness — transactional Postgres

- [ ] Create `src/test/db.ts` exposing `withTestDb(fn)` that runs `fn` inside a transaction and rolls back at the end. Used for integration tests that touch the database without polluting state.
- [ ] Configure Vitest integration project to spin up a dedicated test database (`vox_auto_test`) using a docker-compose stub; document docker-compose.yml in `infra/test/docker-compose.yml`
- [ ] Add a sample integration test in `src/lib/db/contacts.integration.test.ts` that inserts a contact, queries it back, and asserts the org_id RLS works
- [ ] Mark completed

### Task 20: Storage bucket policies

- [ ] In Supabase Dashboard, configure Storage RLS policies for the four private buckets so that path prefix `<org_id>/...` is enforced via `(storage.foldername(name))[1] = current_setting('app.current_org_id', true)`
- [ ] Document the policy SQL in `drizzle/migrations/0004_storage_policies.sql` (commit even if applied via dashboard, for reproducibility)
- [ ] Verify with a manual upload that cross-org access is blocked
- [ ] Mark completed

### Task 21: Supabase Realtime channels

- [ ] Enable Realtime publication for tables `calls` and `campaigns` (the dashboard live view in plan 12 will subscribe to row changes)
- [ ] Document subscription pattern in `src/lib/supabase/realtime.ts` stub
- [ ] Mark completed

### Task 22: Definition of Done

- [ ] All 16 tables present and inspected in Supabase Studio
- [ ] All RLS policies active; verified via psql session swapping `app.current_org_id`
- [ ] Seed produces 5 script templates and 5 credit packages
- [ ] Drizzle migrations committed in `drizzle/migrations/`
- [ ] Type inference works for every table
- [ ] Audit log immutability verified by failing UPDATE test
- [ ] Storage RLS verified for cross-org isolation
- [ ] Mark completed

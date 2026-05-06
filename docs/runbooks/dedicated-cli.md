## Runbook: Per-org dedicated CLI provisioning

**Owner:** Founding engineer
**Audience:** Founder / sales lead
**Trigger:** A dealer requests a dedicated caller ID instead of using the shared pool

## Purpose

By default every org draws caller IDs from the shared `phone_numbers` pool (spec
§9, plan 10 task 4). A dealer may request a **dedicated CLI** — a DID nailed to
their org that no other org can pick. Reasons usually surface from sales:

- Recipients of that dealer's calls have started recognising "the number that
  sells X" and want consistency for callbacks.
- The dealer wants to print a single number on physical collateral that always
  routes back to their inbound IVR transfer target.
- A high-volume dealer wants insulation from the shared pool's spam score so
  their pickup rate is decoupled from the rest of the tenancy.

In Phase 1 this is **a manual sales motion**, not a self-serve product.
Provisioning, billing, and decommissioning are all founder-driven via this
runbook. The self-serve Stripe flow (one-time setup + monthly recurring) is an
explicit future enhancement and is out of MVP scope (plan 10 task 12).

## How the schema and picker support dedicated CLIs

`phone_numbers.org_id` (nullable, set up in plan 02; schema in
`src/lib/db/schema/phone_numbers.ts`) carries the assignment:

- `org_id IS NULL` → row participates in the shared pool, visible to every org.
- `org_id = <uuid>` → row is **org-dedicated**: only that org's picker can see
  it; every other org's picker excludes it.

The picker (`src/lib/voice/cli/picker.ts`) enforces this with two clauses
working together:

1. The `WHERE` clause filters candidates to `org_id = $orgId OR org_id IS NULL`
   — another org's dedicated row never appears in the candidate set.
2. The `ownershipRank` `ORDER BY` term sorts org-dedicated rows ahead of shared
   rows, so when both exist the dedicated CLI is picked first regardless of
   daily count, region, or spam score. The integration test
   `pickCliForOrg integration > prefers an org-dedicated CLI over the shared
   pool` (`src/lib/voice/cli/picker.integration.test.ts`) pins that ordering.

The hourly/daily caps still apply per-CLI. A dealer with one dedicated CLI is
capped at `CLI_DAILY_CAP_DEFAULT` calls/day from that number — when it's hit,
the picker falls through to the shared pool. Sell two dedicated CLIs to dealers
who reliably exceed one cap, or accept the shared-pool fallback for spillover.

## Provisioning flow

Sales is out-of-band (email / call / whatever channel produced the request).
Once the dealer has agreed to terms, the founder executes these steps:

### 1. Confirm scope with the dealer

- One number or several? Each dedicated DID counts against the cap
  independently.
- Mobile (`+393…`) or geographic landline? If landline, which metro? The
  picker prefers regional matches, so a landline aligned to where the dealer's
  contacts cluster is worth more than a random landline.
- Inbound behaviour: the inbound IVR (plan 10 task 9) is shared across all pool
  DIDs, including dedicated ones. The IVR's "press 2 → operator" branch
  resolves the most recent calling org and routes to that org's
  `transfer_target_phone`. Dedicated CLIs benefit here automatically — every
  inbound call is unambiguously theirs.

### 2. Procure the DID via SBC

Follow the same procurement path as shared pool top-up
(`docs/runbooks/cli-pool-management.md` → "Procurement → registration → DB
insert"):

1. Order from Voiped (or the active primary; ADR 0002 governs the carrier
   choice).
2. Configure SIP-trunk credentials in Vapi as **BYO Telephony** if the trunk
   isn't already wired.
3. Import the DID into Vapi as a phone-number resource and capture the
   `phoneNumberId`.
4. Set the inbound assistant on the new DID to `Inbound IVR (pool)` —
   identical to every other pool DID. Org resolution at tool-invocation time
   handles the rest.

### 3. Insert the row with `--org-id`

Use the existing admin script (plan 10 task 8). The `--org-id` flag pins the
row to the dealer's org:

```bash
pnpm exec tsx scripts/add-cli.ts \
  --e164 +393401112222 \
  --provider voiped \
  --vapi-id pn_jkl012 \
  --capabilities mobile \
  --org-id 11111111-2222-3333-4444-555555555555
```

Get the org's UUID from the founder admin tooling (or directly from
`organizations.id` via psql against `DATABASE_DIRECT_URL`). Double-check the
UUID before running — the script is insert-only and the unique constraint on
`e164` will prevent re-inserting if you typo the org and need to retry, so a
`UPDATE phone_numbers SET org_id = …` (per `cli-pool-management.md` →
"Updating an existing CLI") is the recovery path.

### 4. Verify the picker sees the new row

Open `/admin/cli-pool?token=$INTERNAL_ADMIN_TOKEN` (or query
`SELECT id, e164, org_id, status FROM phone_numbers WHERE e164 = $E164`).
The new row should appear with `org_id` populated and `status='active'`.
Trigger a low-volume test campaign for that org (one contact, voicemail
message); confirm `calls.from_number` matches the dedicated DID.

### 5. Record the commercial side

Outside this runbook:

- Issue the agreed invoice in the dealer's billing channel (manual; Stripe
  one-time + recurring lines are not yet wired for this product).
- Note the assignment in the customer record so the next renewal conversation
  references it.
- Update any internal sales spreadsheet with the DID, dealer org, and start
  date.

There is no automated audit log for this provisioning step — the database
mutation goes through `withSystemContext`. Keep written confirmation of the
dealer's request to back up the assignment.

## Reassigning a dedicated CLI

The dealer cancels, downgrades, or wants to swap their dedicated DID:

```sql
-- Return a dedicated CLI to the shared pool
UPDATE phone_numbers SET org_id = NULL WHERE e164 = $1;

-- Move a dedicated CLI from one org to another
UPDATE phone_numbers SET org_id = $1 WHERE e164 = $2;
```

Run from a psql session opened via `DATABASE_DIRECT_URL`, wrapped in a
transaction. Notify the dealer before unassigning — once `org_id` is cleared
the next picker call may hand the number to anyone.

If the carrier number itself is being decommissioned (port-out, contract end),
follow the "Decommissioning a DID" section in
`docs/runbooks/cli-pool-management.md` instead — the row is marked `retired`
and stays in place so historical `calls.from_number` references still resolve.

## What this runbook intentionally does **not** cover

- **Self-serve Stripe checkout for the dedicated-CLI upgrade.** Plan 10 task 12
  defers this to a later phase. Do not stand up the flow without first agreeing
  on price, carrier-cost passthrough, and renewal cadence.
- **Per-org pricing rules in the credit/billing system.** Dedicated-CLI billing
  is invoiced manually in Phase 1; the credits ledger tracks call costs only.
- **Bulk provisioning.** If a dealer wants more than 2–3 dedicated DIDs,
  re-evaluate whether they are better served by a separate org with its own
  pool, and whether the carrier subscription has the headroom.

## References

- Plan 10 Task 12: `docs/plans/10-telephony-cli-pool.md`
- Schema: `src/lib/db/schema/phone_numbers.ts`
- Picker: `src/lib/voice/cli/picker.ts` (ownership filter + ranking)
- Picker integration tests: `src/lib/voice/cli/picker.integration.test.ts`
  (`prefers an org-dedicated CLI`, `does not return another org's dedicated CLI`)
- Admin script: `scripts/add-cli.ts` and `src/lib/voice/cli/add-cli.ts`
- Shared-pool flow: `docs/runbooks/cli-pool-management.md`
- Carrier choice: `docs/architecture-decisions/0002-italian-sbc.md`

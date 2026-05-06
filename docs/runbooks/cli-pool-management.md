# Runbook: CLI Pool Management

**Owner:** Founding engineer
**Audience:** Founder / on-call engineer
**Trigger:** Routine pool top-up, post-cooldown reactivation, or dedicated-CLI provisioning

## Purpose

The platform places outbound calls with Italian caller IDs (CLIs) drawn from
the `phone_numbers` table. Italian recipients pick up familiar Italian numbers
at much higher rates than `+1` / `+44` numbers (spec §9.1), so the credibility
of the pool directly drives revenue. This runbook describes how to keep that
pool healthy: when to procure new DIDs, which providers to use first, how to
register them in Vapi, and how to insert them into the database with
`scripts/add-cli.ts`.

The picker (`src/lib/voice/cli/picker.ts`) and the watchdog
(`src/lib/services/cli_watchdog.ts`) are fully automated. This runbook covers
only the human-in-the-loop steps that remain.

## Pool sizing — when to procure new DIDs

Top up the pool when any of the following is true:

1. **Cooldown rate ≥30%.** The watchdog moves spammy CLIs to `cooling_down`
   for 7 days. When that fraction crosses 30%, the remaining active CLIs are
   pushed harder, accelerating their own scoring into the spam zone. Procure
   before that feedback loop tightens.
2. **A retired CLI was not replaced.** Three cooldowns inside 30 days
   permanently retire a CLI. Replace it 1-for-1 within the same week.
3. **A new metro is being targeted.** When a campaign onboards contacts
   concentrated in a region without local-format coverage in the pool
   (e.g. Catania, Palermo), procure 1–2 landlines for that area code so the
   picker's regional match has something to choose. The picker's
   `inferRegionFromPhone` helper (`src/lib/utils/phone-region.ts`) lists every
   slug currently understood; rows whose `region` matches one of those slugs
   participate in regional matching automatically.

### Quick health check

```bash
pnpm exec tsx scripts/check-cli-status.ts
```

(Or open `/admin/cli-pool?token=$INTERNAL_ADMIN_TOKEN` for the same data with
7-day metrics — see plan 10 task 7.) The dashboard sorts by spam score worst
first; cooldown counts are visible as the row's status.

## Provider preference order

1. **Voiped Telecom** (primary). Native Italian SBC; the cleanest CLI option.
   Procure mobile (`+393…`) and geographic landlines for the seeded metros
   (Milano `02`, Roma `06`, Torino `011`, Napoli `081`, Bologna `051`, plus
   any new metro that justifies a local-format DID — see the regional list in
   `src/lib/utils/phone-region.ts`).
2. **Messagenet** (secondary). Comparable Italian SBC; use as redundancy when
   Voiped is slow to issue or for diversification across carriers.
3. **Twilio Italian DIDs** (failover). Already engaged automatically by the
   dispatcher when the SBC trunk degrades (plan 10 task 13). Keep the failover
   pool topped up alongside the primary pool — the same procurement rules
   apply.
4. **Telnyx** (tertiary). Use only if Voiped/Messagenet cannot fulfil within
   the SLA window for an urgent top-up. Document the choice in
   `docs/architecture-decisions/0002-italian-sbc.md` if it becomes durable.

## Procurement → registration → DB insert (full flow)

### 1. Procure the DIDs

- Order from the chosen provider's commercial portal. Keep credentials in
  1Password (vault: Production Secrets) under the matching trunk entry; rotate
  quarterly per ADR 0002.
- Mix DID types per the existing seed shape: roughly 30% mobile (`+393xx…`)
  and 70% geographic landlines spread across the metros currently targeted by
  campaigns. Adjust toward whichever line type shows the strongest pickup
  rate on the dashboard.

### 2. Register each DID in Vapi

For each DID, follow the procedure in
[`docs/plans/10-telephony-cli-pool.md` Task 2](../plans/10-telephony-cli-pool.md):

1. Open Vapi dashboard → Phone Numbers → **Import Number**.
2. For Voiped/Messagenet DIDs: use the **BYO Telephony** provider type with
   the SIP trunk credentials registered for that carrier.
3. For Twilio DIDs: use the **Twilio** provider type with the Twilio account
   SID + auth token.
4. Configure inbound routing for the new DID to the inbound IVR assistant
   (plan 10 task 9 — same prompt as the rest of the pool). See the
   "Inbound IVR assistant configuration" section below for the one-time setup
   that all pool DIDs share.
5. Capture the Vapi `phoneNumberId` returned by the import — this is the
   `--vapi-id` argument for the next step.

If a switchover to Retell becomes necessary, the equivalent registration
procedure lives in `docs/runbooks/retell-sbc-switchover.md`.

### 3. Insert the row in the database

Run `scripts/add-cli.ts` once per DID. The script connects to the database
using `DATABASE_URL` (the pooler) and inserts the row inside
`withSystemContext` so RLS does not interfere with system-owned tables.

```bash
# Shared-pool landline (Milano)
pnpm exec tsx scripts/add-cli.ts \
  --e164 +390212345678 \
  --provider voiped \
  --vapi-id pn_abc123 \
  --region milano \
  --capabilities landline
```

```bash
# Shared-pool mobile (no region — picker falls through)
pnpm exec tsx scripts/add-cli.ts \
  --e164 +393409876543 \
  --provider voiped \
  --vapi-id pn_def456 \
  --capabilities mobile
```

```bash
# Twilio failover landline (Roma)
pnpm exec tsx scripts/add-cli.ts \
  --e164 +390687654321 \
  --provider twilio \
  --vapi-id pn_ghi789 \
  --region roma \
  --capabilities landline
```

```bash
# Org-dedicated CLI (plan 10 task 12)
pnpm exec tsx scripts/add-cli.ts \
  --e164 +393401112222 \
  --provider voiped \
  --vapi-id pn_jkl012 \
  --capabilities mobile \
  --org-id 11111111-2222-3333-4444-555555555555
```

The script prints the inserted `phone_numbers.id` on success and exits
non-zero with a usage hint on any validation error. It does **not** overwrite
an existing row: the DB-level unique constraint on `e164` rejects duplicates,
so re-running with the same number returns an error and leaves state intact
(this is intentional — silently overwriting would reset usage counters and
spam score that the watchdog cares about).

### Flags

| Flag             | Required | Description                                                           |
|------------------|----------|-----------------------------------------------------------------------|
| `--e164`         | yes      | E.164-formatted DID (`+` then 8–15 digits).                           |
| `--provider`     | yes      | One of `voiped`, `twilio`, `telnyx` (matches `phone_provider` enum).  |
| `--vapi-id`      | yes      | Vapi `phoneNumberId` captured during BYO-trunk import.                |
| `--region`       | no       | Region slug (e.g. `milano`). Mobile DIDs typically pass no region.    |
| `--capabilities` | no       | Comma-separated list (e.g. `landline` or `mobile,sms`).               |
| `--org-id`       | no       | UUID of an org for dedicated assignment (Task 12). Default: shared.   |

## Updating an existing CLI

`scripts/add-cli.ts` is insert-only by design. To update a row's metadata
(e.g. correct a typo in `provider_external_id`, switch a number from shared to
org-dedicated, retire a CLI manually):

```sql
-- Example: re-target a misregistered Vapi phoneNumberId
UPDATE phone_numbers SET provider_external_id = $1 WHERE e164 = $2;

-- Example: assign a shared CLI to an org (Task 12)
UPDATE phone_numbers SET org_id = $1 WHERE e164 = $2;

-- Example: manually retire a CLI (e.g. carrier reclaimed the number)
UPDATE phone_numbers SET status = 'retired' WHERE e164 = $1;

-- Example: manually reactivate a retired CLI after carrier mediation
UPDATE phone_numbers
SET status = 'active', spam_score = '0', daily_call_count = 0
WHERE e164 = $1;
```

Run these from a psql session opened via `DATABASE_DIRECT_URL`. Always wrap in
a transaction (`BEGIN; … COMMIT;`) so a typo can be rolled back. Audit the
operation in writing — this runbook does not auto-record a system audit log
entry for direct SQL.

## Inbound IVR assistant configuration

Recipients sometimes call back the number that contacted them — by mistake, to
opt out, or to reach a real person. Every DID in the pool routes those inbound
calls to a single shared Vapi assistant configured below. The behaviour is
identical regardless of which DID was dialled; org resolution happens at tool
invocation time by looking up the most recent outbound call to the caller's
number (plan 10 task 10/11).

### One-time Vapi setup

1. **Create the inbound assistant.** Vapi dashboard → **Assistants → New
   Assistant**. Name it `Inbound IVR (pool)`. The assistant uses the same
   model/voice configuration as the outbound campaign assistants — only the
   prompt and tools differ.
2. **Paste the system prompt** from
   `src/lib/voice/templates/prompts/inbound-ivr.txt` verbatim. The prompt is
   the canonical source: do not edit the assistant in the dashboard without
   updating the file. The prompt has no Mustache variables, so no per-call
   interpolation is needed.
3. **Wire the DTMF capture tool.** Enable the built-in `capture_dtmf` tool in
   the assistant's tooling configuration with an 8-second `timeout` (matches
   the prompt's wait-window guidance).
4. **Wire the two custom tools** (defined in
   `src/lib/voice/templates/tools/`):
   - `register_inbound_optout` — server URL points to the
     `/api/webhooks/vapi` route handler (plan 10 task 11). Required argument:
     `callerNumber` (E.164).
   - `transfer_to_business_owner` — same server URL. Required argument:
     `callerNumber` (E.164).
5. **No campaign tooling.** Do not enable `book_appointment`,
   `confirm_appointment`, `submit_survey_response`, or any other outbound
   tool on this assistant — the IVR is intentionally limited to opt-out and
   operator transfer (see `TEMPLATE_TOOLS['inbound-ivr']` in
   `src/lib/voice/templates/tools/index.ts`).

### Per-DID inbound routing

After the assistant exists, every DID imported into Vapi must have its
**inbound number setting** point to that assistant:

1. Vapi dashboard → **Phone Numbers → select the DID**.
2. Under **Inbound Settings**, set **Assistant** to `Inbound IVR (pool)`.
3. Save. Place a test call to the DID — the IVR welcome message should play
   within ~2 seconds.

This step applies to all three categories of pool DID: shared SBC, shared
Twilio failover, and org-dedicated CLIs (plan 10 task 12). The assistant is
the same; org context is derived dynamically at tool-invocation time.

### Persistence side

Inbound IVR calls are persisted in the `calls` table with
`direction='inbound'`, `campaign_id` and `contact_id` left null until the
inbound webhook handler resolves the caller. The schema change lives in
migration `0028_calls_direction.sql`.

### Verifying the IVR works

A simple manual smoke test (run after the first DID is wired):

1. Place a test outbound call from the platform to your own mobile (any
   campaign with a single contact pointing at your number is fine).
2. Within 30 days of that call, dial the originating CLI from your mobile.
3. Confirm the welcome message plays.
4. Press `1`. Confirm the IVR plays the opt-out confirmation, then check
   `opt_out_registry` for a row with `source='inbound_ivr'` for the org that
   placed the original call.
5. Place a second test outbound call. Press `2` on the inbound IVR; confirm
   the call transfers to the org's `transfer_target_phone` (or plays the
   "Nessun operatore disponibile" fallback if not configured).

If the welcome message does not play, the inbound routing is misconfigured —
re-check step 2 of "Per-DID inbound routing" above. If a DTMF press does
nothing, the `capture_dtmf` tool is not enabled on the assistant.

## Decommissioning a DID

When a DID is no longer in service (carrier port-out, contract end, etc.):

1. **Remove inbound routing in Vapi** so any straggler inbound call returns
   the carrier's default tone instead of the inbound IVR.
2. **Mark the row retired** with the SQL above. Do **not** delete it — call
   history references `phone_numbers.e164` via `calls.from_number`, and
   reporting depends on those joins resolving.
3. **Cancel the carrier subscription** to stop monthly billing.

Retired rows are excluded from the picker permanently. The watchdog never
revives them automatically.

## References

- ADR 0002: Italian SBC carrier choice — `docs/architecture-decisions/0002-italian-sbc.md`
- Plan 10: Telephony, CLI pool, anti-spam — `docs/plans/10-telephony-cli-pool.md`
- Picker: `src/lib/voice/cli/picker.ts`
- Watchdog: `src/lib/services/cli_watchdog.ts`
- Region inference: `src/lib/utils/phone-region.ts`
- Founder dashboard: `/admin/cli-pool?token=…` (plan 10 task 7)
- Retell switchover (carrier reconfiguration): `docs/runbooks/retell-sbc-switchover.md`

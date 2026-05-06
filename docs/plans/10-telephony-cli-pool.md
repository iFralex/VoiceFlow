# Plan: Telephony — Italian SBC, CLI Pool, Anti-Spam

**Branch:** `feat/10-telephony-cli-pool`
**Wave:** 3
**Depends on:** 01, 02, 03, 04, 08
**Estimated effort:** 4–6 days

## Overview

Implements the entire telephony substrate described in spec §9. Onboards an Italian SBC carrier (Voiped or Messagenet) for native Italian CLIs, populates and manages the `phone_numbers` pool, enforces CLI rotation and anti-spam practices, ships the spam-score watchdog cron, and configures inbound IVR for opt-out and accidental-callback handling. Without this plan the Vapi adapter from plan 08 cannot place calls with credible Italian caller IDs and the platform's call-pickup rates collapse.

## Context

Italian recipients pick up calls with familiar Italian CLIs ("0... mobile" or local landline prefix) at a much higher rate than +1 / +44 numbers (spec §9.1). Twilio is kept as a fallback only — it works but supplies fewer credible Italian CLIs. The CLI pool is shared across orgs by default in Phase 1; per-org dedicated CLIs are an explicit upgrade. Per-number daily caps and rotation prevent any single CLI from being flagged as spam; the watchdog removes flagged CLIs from rotation automatically.

## Validation Commands

- `pnpm typecheck`
- `pnpm test src/lib/voice/cli src/lib/services/phone_numbers`
- `pnpm test:integration src/lib/voice/cli`
- `pnpm exec tsx scripts/test-sbc-trunk.ts` (manual: places a real test call via the SBC trunk)
- `pnpm exec tsx scripts/check-cli-status.ts` (operational: dumps current CLI pool health)

### Task 1: Italian SBC carrier procurement

- [x] Open commercial accounts with two Italian SBC providers for redundancy: (skipped - not automatable; documented in ADR 0002)
  - **Primary**: Voiped Telecom (or Messagenet, comparable) — purchase initial pool of 10 Italian DIDs (mix: 3 mobile-format `+393xx`, 7 geographic local landline numbers spread across Milano, Roma, Torino, Napoli, Bologna)
  - **Secondary**: Twilio Italian numbers (5 DIDs) as failover
- [x] Configure SIP trunk credentials and capture: SIP server URI, username, password, allowed IPs whitelist (Vapi/Retell origin IPs) (skipped - manual founder action; documented in ADR 0002)
- [x] Tertiary fallback: Telnyx if available with Italian local presence (skipped - not automatable; documented in ADR 0002)
- [x] Save all credentials to 1Password with documented quarterly rotation policy (skipped - manual founder action; rotation policy documented in ADR 0002)
- [x] Document the supplier choice in `docs/architecture-decisions/0002-italian-sbc.md`
- [x] Mark completed

### Task 2: SBC integration in Vapi/Retell

- [x] In Vapi dashboard, register the SBC SIP trunk as a "BYO Telephony" provider with credentials from Task 1 (skipped - manual Vapi-dashboard action; procedure documented in `docs/runbooks/retell-sbc-switchover.md` and inferable from ADR 0002)
- [x] Import each DID as a Vapi `phoneNumber` resource; capture each Vapi `phoneNumberId` (the value Vapi expects in `CreateCallParams.fromNumber`) (skipped - manual Vapi-dashboard action; `phone_numbers.provider_external_id` is populated by `pnpm db:seed` once the IDs are captured)
- [x] Repeat for the secondary Twilio numbers (also routed via Vapi as `twilio` provider type) (skipped - manual Vapi-dashboard action)
- [x] Configure inbound routing for every DID to a single inbound assistant (configured in Task 9 below) (skipped - manual Vapi-dashboard action; inbound IVR assistant prompt lives in Task 9)
- [x] In Retell adapter (plan 08 stub), document equivalent setup for the day a switchover is needed — see `docs/runbooks/retell-sbc-switchover.md`
- [x] Mark completed

### Task 3: phone_numbers pool population

- [ ] Update `src/lib/db/seed/phone_numbers.ts` (table created in plan 02) with the 15 procured DIDs:

```typescript
const POOL = [
  { e164: '+393xxxxxxxxx', provider: 'voiped', region: 'milano', capabilities: ['mobile'] },
  { e164: '+39022xxxxxxx', provider: 'voiped', region: 'milano', capabilities: ['landline'] },
  // ...all 15
];
```

- [ ] Each row inserted with `org_id=NULL` (shared pool), `status='active'`, `daily_call_count=0`, `spam_score=0`
- [ ] Add `region` and `capabilities` columns via migration `0012_phone_numbers_metadata.sql` so the rotation algorithm can match CLI region to contact region (e.g. milanese contact gets Milano CLI when possible)
- [ ] Add `provider_external_id` column to store the Vapi `phoneNumberId`
- [ ] Mark completed

### Task 4: CLI rotation algorithm

- [ ] Create `src/lib/voice/cli/picker.ts` exposing `pickCliForOrg(orgId, contactPhone?)`:

```typescript
export async function pickCliForOrg(
  orgId: string,
  contactPhone?: string,
): Promise<{ phoneE164: string; providerExternalId: string }> {
  return db.transaction(async (tx) => {
    // 1. Try org-dedicated CLI first if any (paid feature)
    // 2. Fall back to shared pool, ordered by:
    //    a. region match (if contactPhone supplied and we can infer region)
    //    b. lowest daily_call_count
    //    c. lowest spam_score
    //    d. SELECT FOR UPDATE SKIP LOCKED to avoid races
    // 3. Increment daily_call_count, set last_used_at
    // 4. Return E.164 + Vapi phoneNumberId
  });
}
```

- [ ] Per-CLI daily cap (default 100 calls/day per number; configurable env `CLI_DAILY_CAP_DEFAULT`)
- [ ] Per-CLI hourly cap (default 30 calls/hour) enforced via a sliding-window count from `calls.started_at`
- [ ] If no CLI is available (all at cap), throw `NoAvailableCliError` caught by the dispatcher (plan 09) which schedules a retry in 30 minutes
- [ ] Add unit tests for: row locking, cap enforcement, region matching, fallback ordering
- [ ] Mark completed

### Task 5: Region inference helper

- [ ] Create `src/lib/utils/phone-region.ts` mapping common Italian area codes to regions: 02→Milano, 06→Roma, 011→Torino, 081→Napoli, 051→Bologna, 049→Padova, 041→Venezia, 080→Bari, 091→Palermo, etc.
- [ ] For mobile numbers (3xx prefix) no region is inferable — picker falls through to next priority
- [ ] Used by `pickCliForOrg` to prefer regional CLI match where possible
- [ ] Mark completed

### Task 6: Anti-spam practices

- [ ] In `dispatchCallViaProvider` (plan 09 hook), add jitter: insert a random `0–500ms` delay before calling Vapi to avoid burst patterns the carrier could flag
- [ ] In `pickCliForOrg`, prefer numbers idle ≥30 minutes; if all are recent, accept oldest
- [ ] Daily reset cron at 00:05 Europe/Rome resets `daily_call_count` for all numbers (path `/api/cron/cli-daily-reset`, add to `vercel.json`)
- [ ] Mark completed

### Task 7: Spam-score watchdog cron

- [ ] Create `src/app/api/cron/cli-watchdog/route.ts` running daily at 02:00 Europe/Rome (path already in `vercel.json` from plan 01):
  - For each active CLI compute a heuristic spam score from the last 24h:
    - `pickup_rate = (calls with status='completed' AND duration > 10s) / (calls dialed)`
    - `voicemail_rate = voicemail / dialed`
    - `complaint_rate = opt_out_via_inbound / dialed`
    - score = weighted combination
  - If `spam_score > threshold` (configurable; start at 70/100), set `status='cooling_down'` and exclude from picker for 7 days
  - If a CLI cools down >2 times in 30 days, set `status='retired'` (manual reactivation only)
  - Emit `cli/cooling-down` and `cli/retired` Inngest events for plan 13's notification handler
- [ ] Surface the metrics on a hidden `/admin/cli-pool` dashboard (founder only) showing per-CLI 7-day stats
- [ ] Mark completed

### Task 8: CLI top-up workflow (operational)

- [ ] Document in `docs/runbooks/cli-pool-management.md` the founder process:
  - when to procure new DIDs (when ≥30% of pool is in cooling-down)
  - which providers to use first
  - how to register new DIDs in Vapi
  - how to insert into the pool table (a small admin script `scripts/add-cli.ts`)
- [ ] Add admin script `scripts/add-cli.ts` taking `--e164`, `--provider`, `--vapi-id`, `--region`, `--capabilities` and inserting one row
- [ ] Mark completed

### Task 9: Inbound IVR for opt-out

- [ ] Configure each pool DID's inbound route in Vapi to point to an inbound assistant
- [ ] Inbound assistant Italian system prompt (file `src/lib/voice/templates/prompts/inbound-ivr.txt`):
  - greets caller: "Buongiorno, hai ricevuto una chiamata da questo numero. Premi 1 per non essere più contattato. Premi 2 per parlare con un operatore. Premi 9 per riascoltare."
  - DTMF-driven (Vapi tool `capture_dtmf`)
  - on `1`: tool `register_inbound_optout(callerNumber)` — adds entry to `opt_out_registry` for ALL orgs that have called this number (resolve via recent `calls` rows in last 30 days), records source `inbound_ivr`
  - on `2`: tool `transfer_to_business_owner` — looks up the most recent calling org and transfers to that org's `transfer_target_phone` if configured, else plays "Nessun operatore disponibile, riproveremo a chiamarti"
  - on no input within 8s: repeat once, then end call politely
- [ ] Persist inbound calls in `calls` table with `direction='inbound'` (add column via migration `0013_calls_direction.sql`, default `'outbound'`)
- [ ] Mark completed

### Task 10: Inbound caller normalisation and lookup

- [ ] Create `src/lib/voice/inbound/lookup.ts` with `findRecentOutboundCallsToNumber(phoneE164, withinDays=30)`:
  - returns list of `{ orgId, callId, dialedAt, contactId }` ordered by most recent
- [ ] Used by inbound IVR opt-out tool to enrol the inbound caller in the right orgs' opt-out registries
- [ ] Mark completed

### Task 11: Inbound webhook handler extension

- [ ] Extend `/api/webhooks/vapi` (plan 08) to recognise inbound assistant events: persist as inbound `calls` rows with no `campaign_id`
- [ ] On inbound IVR `register_inbound_optout` tool invocation:
  - call `findRecentOutboundCallsToNumber`
  - for each org: `markOptOut(orgId, phoneE164, 'inbound_ivr')`
  - audit log per-org
- [ ] Mark completed

### Task 12: Per-org dedicated CLI as paid upgrade

- [ ] Add `phone_numbers.org_id` already exists from plan 02 (nullable); when set, the CLI is org-dedicated and excluded from the shared pool
- [ ] Document in `docs/runbooks/dedicated-cli.md` the founder process for selling the upgrade:
  - dealer requests dedicated number (out-of-band; sales conversation in Phase 1)
  - founder provisions a fresh DID via SBC
  - founder runs `scripts/add-cli.ts` with `--org-id <uuid>` to assign
- [ ] Future Phase 1 enhancement: self-serve dedicated-CLI upgrade as Stripe one-time + monthly recurring; placeholder out of MVP scope
- [ ] Mark completed

### Task 13: Twilio fallback orchestration

- [ ] If Vapi reports SBC trunk unhealthy (3 consecutive failed dispatches in <5 min), the dispatcher (plan 09) flips to Twilio-pool CLIs
- [ ] State stored in a small `system_flags` table (key/value) toggled by the watchdog or manually
- [ ] Flag auto-clears after 30 minutes of healthy SBC operation
- [ ] Add migration `0014_system_flags.sql` and `src/lib/services/system_flags.ts`
- [ ] Mark completed

### Task 14: Per-call CLI selection observability

- [ ] Persist the chosen CLI per call in `calls.from_number` (already in schema) and `calls.cli_provider` (new column via migration `0015_calls_cli_provider.sql`)
- [ ] Add a column on the call detail page (built in plan 12) "CLI utilizzato" with provider tag
- [ ] Per-CLI calls visible to founder via `/admin/cli-pool` admin view
- [ ] Mark completed

### Task 15: SBC connection smoke test

- [ ] Create `scripts/test-sbc-trunk.ts` that:
  - picks a non-org-dedicated CLI from the pool
  - dispatches a test call via Vapi to a configurable test number (env `SBC_SMOKE_TEST_NUMBER`)
  - waits for call.ended webhook
  - asserts duration > 2s and `endedReason in ['hangup', 'silence-timeout']`
- [ ] Run weekly via a Vercel cron `/api/cron/sbc-smoke-test` (Sundays 03:00 Europe/Rome) — alerts on failure
- [ ] Mark completed

### Task 16: Integration tests

- [ ] Test: `pickCliForOrg` respects daily caps
- [ ] Test: `pickCliForOrg` returns org-dedicated CLI when org has one
- [ ] Test: `pickCliForOrg` prefers regional match
- [ ] Test: concurrent picks under load do not double-allocate (SKIP LOCKED works)
- [ ] Test: watchdog moves flagged CLI to `cooling_down` and back to `active` after 7 days
- [ ] Test: inbound opt-out enrols all orgs called the number recently
- [ ] Test: Twilio fallback engages on SBC degradation flag
- [ ] Mark completed

### Task 17: Definition of Done

- [ ] 15 Italian DIDs procured and registered in Vapi
- [ ] CLI rotation works under simulated 100-call burst without exceeding caps
- [ ] Watchdog cron green; manually-injected high-spam CLI moved to cooling_down within next run
- [ ] Inbound IVR opt-out works end-to-end (verified with manual test call)
- [ ] Twilio fallback verified with simulated SBC outage
- [ ] Founder runbook documented for pool management
- [ ] Mark completed

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

- [x] Update `src/lib/db/seed/phone_numbers.ts` (table created in plan 02) with the 15 procured DIDs:

```typescript
const POOL = [
  { e164: '+393xxxxxxxxx', provider: 'voiped', region: 'milano', capabilities: ['mobile'] },
  { e164: '+39022xxxxxxx', provider: 'voiped', region: 'milano', capabilities: ['landline'] },
  // ...all 15
];
```

- [x] Each row inserted with `org_id=NULL` (shared pool), `status='active'`, `daily_call_count=0`, `spam_score=0`
- [x] Add `region` and `capabilities` columns via migration `0012_phone_numbers_metadata.sql` so the rotation algorithm can match CLI region to contact region (e.g. milanese contact gets Milano CLI when possible) (renumbered to `0025_phone_numbers_metadata.sql` because `0012` was already taken when this plan landed)
- [x] Add `provider_external_id` column to store the Vapi `phoneNumberId`
- [x] Mark completed

### Task 4: CLI rotation algorithm

- [x] Create `src/lib/voice/cli/picker.ts` exposing `pickCliForOrg(orgId, contactPhone?)`:

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

- [x] Per-CLI daily cap (default 100 calls/day per number; configurable env `CLI_DAILY_CAP_DEFAULT`)
- [x] Per-CLI hourly cap (default 30 calls/hour) enforced via a sliding-window count from `calls.started_at` (added migration `0026_calls_from_number.sql` so the picker's correlated subquery can scope to the picked CLI; configurable via `CLI_HOURLY_CAP_DEFAULT`)
- [x] If no CLI is available (all at cap), throw `NoAvailableCliError` caught by the dispatcher (plan 09) which schedules a retry in 30 minutes
- [x] Add unit tests for: row locking, cap enforcement, region matching, fallback ordering (unit tests cover the locking-clause API and error path; integration tests cover region matching, ownership, daily/hourly cap filtering, status filtering, and side effects under real Postgres)
- [x] Mark completed

### Task 5: Region inference helper

- [x] Create `src/lib/utils/phone-region.ts` mapping common Italian area codes to regions: 02→Milano, 06→Roma, 011→Torino, 081→Napoli, 051→Bologna, 049→Padova, 041→Venezia, 080→Bari, 091→Palermo, etc. (extended in Task 5 from the Task-4 starter set to cover every regional capital plus key metros: Genova, Brescia, Bergamo, Trieste, Verona, Pisa, Firenze, Cagliari, Ancona, Perugia, Sassari, Pescara, Messina, Catania, Taranto)
- [x] For mobile numbers (3xx prefix) no region is inferable — picker falls through to next priority
- [x] Used by `pickCliForOrg` to prefer regional CLI match where possible
- [x] Mark completed

### Task 6: Anti-spam practices

- [x] In `dispatchCallViaProvider` (plan 09 hook), add jitter: insert a random `0–500ms` delay before calling Vapi to avoid burst patterns the carrier could flag (implemented in `src/lib/voice/cli/jitter.ts`; consumed from `dispatchCall` in `src/lib/services/calls.ts` immediately before `provider.createCall`)
- [x] In `pickCliForOrg`, prefer numbers idle ≥30 minutes; if all are recent, accept oldest (added an `idleRank` CASE clause between region match and daily-count tiebreakers; the existing `last_used_at ASC NULLS FIRST` final tiebreaker covers the "all recent → oldest" fallback)
- [x] Daily reset cron at 00:05 Europe/Rome resets `daily_call_count` for all numbers (path `/api/cron/cli-daily-reset`, add to `vercel.json`) (route in `src/app/api/cron/cli-daily-reset/route.ts`; vercel.json entry uses `5 0 * * *` matching the project's wall-clock-as-UTC cron convention)
- [x] Mark completed

### Task 7: Spam-score watchdog cron

- [x] Create `src/app/api/cron/cli-watchdog/route.ts` running daily at 02:00 Europe/Rome (path already in `vercel.json` from plan 01):
  - For each active CLI compute a heuristic spam score from the last 24h:
    - `pickup_rate = (calls with status='completed' AND duration > 10s) / (calls dialed)`
    - `voicemail_rate = voicemail / dialed`
    - `complaint_rate = opt_out_via_inbound / dialed`
    - score = weighted combination (40·(1−pickup) + 25·voicemail + 35·complaint), bounded [0,100]; small samples (<10 dialed) score 0 to avoid false-positive cooldowns
  - If `spam_score > threshold` (configurable; start at 70/100), set `status='cooling_down'` and exclude from picker for 7 days
  - If a CLI cools down >2 times in 30 days, set `status='retired'` (manual reactivation only) (cooldown events tracked in new `cli_cooldown_history` table via migration `0027_cli_cooldown_history.sql`)
  - Emit `cli/cooling-down` and `cli/retired` Inngest events for plan 13's notification handler (event names + payload types live in `src/lib/inngest/handlers/cli.ts`; published from `runWatchdog` after the DB transaction commits so a failed event publish doesn't roll back the bookkeeping)
  - On every run also reactivates any `cooling_down` CLI whose 7-day window has elapsed (skipped for `retired`)
- [x] Surface the metrics on a hidden `/admin/cli-pool` dashboard (founder only) showing per-CLI 7-day stats (`src/app/admin/cli-pool/page.tsx`; `?token=` query-param auth via `INTERNAL_ADMIN_TOKEN` with `timingSafeEqual`, returns 404 on bad token; middleware bypasses `/admin/` so the page handles its own auth)
- [x] Mark completed

### Task 8: CLI top-up workflow (operational)

- [x] Document in `docs/runbooks/cli-pool-management.md` the founder process:
  - when to procure new DIDs (when ≥30% of pool is in cooling-down)
  - which providers to use first
  - how to register new DIDs in Vapi
  - how to insert into the pool table (a small admin script `scripts/add-cli.ts`)
- [x] Add admin script `scripts/add-cli.ts` taking `--e164`, `--provider`, `--vapi-id`, `--region`, `--capabilities` and inserting one row (also accepts `--org-id <uuid>` for the org-dedicated assignment flow in Task 12; argv parsing + validation live in `src/lib/voice/cli/add-cli.ts` with unit tests, and the script is a thin entrypoint wrapped around `withSystemContext`)
- [x] Mark completed

### Task 9: Inbound IVR for opt-out

- [x] Configure each pool DID's inbound route in Vapi to point to an inbound assistant (skipped - manual Vapi-dashboard action; full procedure documented in `docs/runbooks/cli-pool-management.md` under "Inbound IVR assistant configuration")
- [x] Inbound assistant Italian system prompt (file `src/lib/voice/templates/prompts/inbound-ivr.txt`):
  - greets caller: "Buongiorno, hai ricevuto una chiamata da questo numero. Premi 1 per non essere più contattato. Premi 2 per parlare con un operatore. Premi 9 per riascoltare."
  - DTMF-driven (Vapi tool `capture_dtmf`)
  - on `1`: tool `register_inbound_optout(callerNumber)` — adds entry to `opt_out_registry` for ALL orgs that have called this number (resolve via recent `calls` rows in last 30 days), records source `inbound_ivr`
  - on `2`: tool `transfer_to_business_owner` — looks up the most recent calling org and transfers to that org's `transfer_target_phone` if configured, else plays "Nessun operatore disponibile, riproveremo a chiamarti"
  - on no input within 8s: repeat once, then end call politely
- [x] Persist inbound calls in `calls` table with `direction='inbound'` (column added via migration `0028_calls_direction.sql` with default `'outbound'`; renumbered from `0013` because earlier slots were taken. Relaxing the NOT NULL on `campaign_id`/`contact_id` and the actual insert path live in plan 10 task 11, the inbound webhook handler — see migration header for the explicit handoff)
- [x] Mark completed

### Task 10: Inbound caller normalisation and lookup

- [x] Create `src/lib/voice/inbound/lookup.ts` with `findRecentOutboundCallsToNumber(phoneE164, withinDays=30)`:
  - returns list of `{ orgId, callId, dialedAt, contactId }` ordered by most recent
- [x] Used by inbound IVR opt-out tool to enrol the inbound caller in the right orgs' opt-out registries (consumer wired up in plan 10 task 11; this task ships the helper plus unit and integration tests covering cross-org results, lookback window, direction filter, and ordering)
- [x] Mark completed

### Task 11: Inbound webhook handler extension

- [x] Extend `/api/webhooks/vapi` (plan 08) to recognise inbound assistant events: persist as inbound `calls` rows with no `campaign_id` (migration `0029_calls_inbound_nullable.sql` relaxes the NOT NULL on `campaign_id`/`contact_id` per the handoff comment in `0028_calls_direction.sql`; the inbound row's `org_id` is resolved to the most recent calling org via `findRecentOutboundCallsToNumber` and matched on subsequent events by `provider_call_id`)
- [x] On inbound IVR `register_inbound_optout` tool invocation:
  - call `findRecentOutboundCallsToNumber`
  - for each org: insert into `opt_out_registry` with source `inbound_ivr` (idempotent on the unique constraint)
  - audit log per-org (action `opt_out.recorded`)
- [x] Mark completed

### Task 12: Per-org dedicated CLI as paid upgrade

- [x] Add `phone_numbers.org_id` already exists from plan 02 (nullable); when set, the CLI is org-dedicated and excluded from the shared pool (verified: schema in `src/lib/db/schema/phone_numbers.ts` already has nullable `org_id`; picker in `src/lib/voice/cli/picker.ts` filters with `org_id = $orgId OR org_id IS NULL` so other orgs' dedicated rows are excluded — covered by `picker.integration.test.ts > does not return another org's dedicated CLI`)
- [x] Document in `docs/runbooks/dedicated-cli.md` the founder process for selling the upgrade:
  - dealer requests dedicated number (out-of-band; sales conversation in Phase 1)
  - founder provisions a fresh DID via SBC
  - founder runs `scripts/add-cli.ts` with `--org-id <uuid>` to assign
- [x] Future Phase 1 enhancement: self-serve dedicated-CLI upgrade as Stripe one-time + monthly recurring; placeholder out of MVP scope (called out explicitly in `docs/runbooks/dedicated-cli.md` under "What this runbook intentionally does not cover")
- [x] Mark completed

### Task 13: Twilio fallback orchestration

- [x] If Vapi reports SBC trunk unhealthy (3 consecutive failed dispatches in <5 min), the dispatcher (plan 09) flips to Twilio-pool CLIs (failure/success tracking lives in `dispatchCall`/`src/lib/services/calls.ts` around `provider.createCall`; `pickCliForOrg` accepts a `providers` filter and the dispatcher's phone-number SELECT restricts to `provider='twilio'` when the flag is raised)
- [x] State stored in a small `system_flags` table (key/value) toggled by the watchdog or manually (`getFlag`/`setFlag`/`clearFlag` in `src/lib/services/system_flags.ts`; `clearStaleSbcUnhealthyFlag` is the manual/cron-callable knob)
- [x] Flag auto-clears after 30 minutes of healthy SBC operation (`SBC_HEALTHY_AUTO_CLEAR_MS` enforced inside `recordSbcDispatchSuccess`; the cron-callable `clearStaleSbcUnhealthyFlag` GCs flags whose last failure aged out without a follow-up dispatch)
- [x] Add migration `0014_system_flags.sql` and `src/lib/services/system_flags.ts` (renumbered to `0030_system_flags.sql` because slots `0014`+ were already taken when this plan landed)
- [x] Mark completed

### Task 14: Per-call CLI selection observability

- [x] Persist the chosen CLI per call in `calls.from_number` (already in schema) and `calls.cli_provider` (new column via migration `0015_calls_cli_provider.sql`) (renumbered to `0031_calls_cli_provider.sql` because earlier slots were taken; `dispatchCall` in `src/lib/services/calls.ts` now writes both columns on the `pending → dialing` transition so the picker's hourly cap, the watchdog's per-CLI metrics, and the founder dashboard all see the chosen CLI)
- [x] Add a column on the call detail page (built in plan 12) "CLI utilizzato" with provider tag (page itself lands in plan 12 task 7; this task ships the data plumbing — `cli_provider`/`from_number` are now exposed on `GET /api/internal/calls/:id` and selected by `fetchCallTimeline` so plan 12 can render the column without further schema work)
- [x] Per-CLI calls visible to founder via `/admin/cli-pool` admin view (added `provider` to `CliMetricsRow` and a Provider column on `/admin/cli-pool` so the founder can see at a glance whether dispatched volume is balanced across the SBC primary and the Twilio fallback; per-CLI dialed/pickup/voicemail/complaint counts were already on the dashboard)
- [x] Mark completed

### Task 15: SBC connection smoke test

- [x] Create `scripts/test-sbc-trunk.ts` that:
  - picks a non-org-dedicated CLI from the pool
  - dispatches a test call via Vapi to a configurable test number (env `SBC_SMOKE_TEST_NUMBER`)
  - waits for call.ended webhook (implemented as a direct `GET /call/:id` poll against Vapi rather than waiting for the webhook — the smoke test deliberately does not insert a `calls` row, so the webhook handler has no row to update; polling Vapi for the same `endedReason`/duration end-state is equivalent for the assertion)
  - asserts duration > 2s and `endedReason in ['hangup', 'silence-timeout']`
- [x] Run weekly via a Vercel cron `/api/cron/sbc-smoke-test` (Sundays 03:00 Europe/Rome) — alerts on failure (cron entry uses `0 3 * * 0` matching the project's wall-clock-as-UTC convention; alert path emits `sbc/smoke-test-failed` Inngest event for plan 13's notification handler)
- [x] Mark completed

### Task 16: Integration tests

- [x] Test: `pickCliForOrg` respects daily caps (`picker.integration.test.ts > excludes CLIs at the daily cap`; the corresponding hourly-cap test sits next to it)
- [x] Test: `pickCliForOrg` returns org-dedicated CLI when org has one (`picker.integration.test.ts > prefers an org-dedicated CLI over the shared pool`; cross-org isolation covered by `does not return another org's dedicated CLI`)
- [x] Test: `pickCliForOrg` prefers regional match (`picker.integration.test.ts > prefers a CLI whose region matches the contact phone`)
- [x] Test: concurrent picks under load do not double-allocate (SKIP LOCKED works) (new `picker.skiplocked.integration.test.ts` runs two real Postgres connections — Worker A holds the row lock while Worker B picks; verifies B picks a different row, with committed-seed cleanup in `finally` so the test database is left unchanged)
- [x] Test: watchdog moves flagged CLI to `cooling_down` and back to `active` after 7 days (new `cli_watchdog.integration.test.ts > cycles a flagged CLI active → cooling_down and back to active across two runs` runs the watchdog twice with `now` advanced past `COOLDOWN_DURATION_DAYS`; the existing per-direction tests for cooldown and reactivation continue to cover the individual transitions)
- [x] Test: inbound opt-out enrols all orgs called the number recently (`inbound_calls.integration.test.ts > writes one opt_out row + audit per unique calling org`; idempotency and "no caller" path are covered by sibling tests)
- [x] Test: Twilio fallback engages on SBC degradation flag (new `system_flags.integration.test.ts > engages Twilio fallback when the SBC unhealthy flag is raised end-to-end` exercises the full chain `recordSbcDispatchFailure x3 → isSbcUnhealthy → pickCliForOrg with providers=[twilio]`; a sibling test verifies the picker un-restricts after the 30-minute auto-clear)
- [x] Mark completed

### Task 17: Definition of Done

- [ ] 15 Italian DIDs procured and registered in Vapi
- [ ] CLI rotation works under simulated 100-call burst without exceeding caps
- [ ] Watchdog cron green; manually-injected high-spam CLI moved to cooling_down within next run
- [ ] Inbound IVR opt-out works end-to-end (verified with manual test call)
- [ ] Twilio fallback verified with simulated SBC outage
- [ ] Founder runbook documented for pool management
- [ ] Mark completed

# Plan: Campaign Execution Engine — Inngest Dispatch Chain

**Branch:** `feat/09-campaign-engine-inngest`
**Wave:** 3
**Depends on:** 01, 02, 03, 04, 05, 06, 07, 08
**Estimated effort:** 5–7 days

## Overview

Implements the Inngest-driven campaign engine described in spec §10 and §6.5. This is the orchestrator that turns a configured campaign + contact list + script into a stream of actual outbound calls executed at the right time, in the right concurrency, against the right phone numbers, while respecting the legal call window, retry policy, credit limits, pause/cancel state, and per-CLI rate caps. The four Inngest functions defined here (`campaign.launched`, `campaign.dispatch-call`, `call.completed`, `campaign.completed`) are the heart of the platform's operations.

## Context

The dispatch chain is fan-out then per-contact, with concurrency keyed on `org_id` to enforce per-org limits (default 5 concurrent calls, configurable). Time-window enforcement happens at dispatch time, not at call time: the dispatcher sleeps until 09:00 Europe/Rome if needed (spec §10.3). Pause and cancel checks happen at the start of every per-contact step. Credit reservations live on the campaign; charges deducted per-call (plan 05). All Inngest functions are idempotent on `(campaignId, contactId, attemptNumber)` for retries.

## Validation Commands

- `pnpm typecheck`
- `pnpm test src/lib/services/campaigns src/lib/inngest/campaigns`
- `pnpm test:integration src/lib/inngest/campaigns`
- `pnpm test:e2e e2e/campaign-launch.spec.ts`
- `pnpm exec inngest-cli@latest dev` (run Inngest dev server)

### Task 1: Campaign service

- [x] Create `src/lib/services/campaigns.ts`:

```typescript
export async function createCampaign(
  orgId: string,
  byUserId: string,
  input: {
    name: string;
    scriptId: string;
    contactListId: string;
    scheduledStart?: Date;
    concurrencyLimit?: number;
    timeWindowStart?: string;
    timeWindowEnd?: string;
  },
): Promise<Campaign>;

export async function launchCampaign(
  orgId: string,
  byUserId: string,
  campaignId: string,
): Promise<void>;
export async function pauseCampaign(
  orgId: string,
  byUserId: string,
  campaignId: string,
): Promise<void>;
export async function resumeCampaign(
  orgId: string,
  byUserId: string,
  campaignId: string,
): Promise<void>;
export async function cancelCampaign(
  orgId: string,
  byUserId: string,
  campaignId: string,
): Promise<void>;
export async function getCampaign(
  orgId: string,
  campaignId: string,
): Promise<CampaignWithStats | null>;
export async function listCampaigns(
  orgId: string,
  filters: { status?: CampaignStatus[] },
  page: { limit: number; cursor?: string },
): Promise<{ items: CampaignWithStats[]; nextCursor?: string }>;
```

- [x] `launchCampaign` runs in a transaction:
  1. validate campaign in `draft|scheduled` state
  2. resolve contact count (eligible: not opt-out, RPO clear or unchecked, no recent call attempt within 48h, valid phone)
  3. compute `estimatedMaxCents` via `estimateCampaignCost`
  4. call `reserveForCampaign(orgId, campaignId, estimatedMaxCents)` — fails if insufficient credit
  5. transition campaign to `running` (or `scheduled` if `scheduledStart > now`)
  6. emit Inngest event `campaign/launched`
  7. write audit log
- [x] `pauseCampaign` sets status `paused`; resume returns to `running`; cancel sets `cancelled` and releases reservation
- [x] Mark completed

### Task 2: Eligibility filter

- [x] Create `src/lib/services/eligibility.ts` with `findEligibleContactsForCampaign(orgId, campaignId)`:
  - SELECT FROM contact_list's contacts JOIN opt_out_registry LEFT JOIN recent calls(48h)
  - WHERE `deleted_at IS NULL`, `opt_out=false`, `rpo_status != 'blocked'`, no successful call attempt in last 48h, phone present and E.164-valid
  - return list of `{ contactId, phoneE164, attemptNumber }` ordered by an attempt strategy (oldest first by created_at)
- [x] Add unit test verifying each filter
- [x] Mark completed

### Task 3: Inngest function — campaign launched (planner)

- [x] Create `src/lib/inngest/campaigns/launched.ts`:

```typescript
export const campaignLaunched = inngest.createFunction(
  { id: 'campaign-launched', retries: 3 },
  { event: 'campaign/launched' },
  async ({ event, step }) => {
    const { campaignId, orgId } = event.data;
    const eligible = await step.run('find-eligible', () =>
      findEligibleContactsForCampaign(orgId, campaignId),
    );
    if (eligible.length === 0) {
      await step.run('complete', () => markCampaignCompletedEmpty(orgId, campaignId));
      return;
    }
    await step.run('create-pending-calls', () =>
      createPendingCallRows(orgId, campaignId, eligible),
    );
    await step.sendEvent(
      'dispatch-batch',
      eligible.map((c) => ({
        name: 'campaign/dispatch-call',
        data: {
          campaignId,
          orgId,
          contactId: c.contactId,
          attempt: c.attemptNumber,
          callId: c.precreatedCallId,
        },
      })),
    );
  },
);
```

- [x] `createPendingCallRows` inserts a `calls` row per contact in `pending` state, returning the precreated call ids; this lets the dashboard surface campaign progress immediately
- [x] Mark completed

### Task 4: Inngest function — dispatch-call (per-contact)

- [x] Create `src/lib/inngest/campaigns/dispatch.ts`:

```typescript
export const dispatchCall = inngest.createFunction(
  {
    id: 'campaign-dispatch-call',
    retries: 3,
    concurrency: [
      { scope: 'fn', key: 'event.data.orgId', limit: 5 }, // per-org default; overridden per campaign in Task 5
      { scope: 'fn', limit: 100 }, // platform-wide
    ],
  },
  { event: 'campaign/dispatch-call' },
  async ({ event, step }) => {
    const { campaignId, orgId, contactId, callId, attempt } = event.data;
    const campaign = await step.run('load-campaign', () => requireRunning(orgId, campaignId));
    if (campaign.status !== 'running') return; // paused or cancelled
    await step.run('wait-for-window', () =>
      waitForCallWindow(campaign.timeWindowStart, campaign.timeWindowEnd, 'Europe/Rome'),
    );
    await step.run('verify-eligibility', () => verifyContactStillEligible(orgId, contactId));
    await step.run('verify-credit', () => verifyCreditAvailable(orgId, callId));
    const fromNumber = await step.run('acquire-cli', () => pickCliForOrg(orgId)); // plan 10
    await step.run('dispatch-via-provider', () =>
      dispatchCallViaProvider(orgId, callId, fromNumber),
    );
  },
);
```

- [x] `waitForCallWindow` computes seconds until window opens in Europe/Rome and uses `step.sleepUntil`
- [x] `verifyContactStillEligible` aborts gracefully if the contact opted out or was deleted between planning and dispatch
- [x] `verifyCreditAvailable` aborts and marks call `failed/error_code='insufficient_credit'` if balance too low — also emits `credit/low-balance` event
- [x] Per-campaign concurrency override implemented in Task 5
- [x] Mark completed

### Task 5: Per-campaign concurrency override

- [x] Inngest concurrency is statically defined; for per-campaign overrides we use a custom concurrency key combining `orgId` and `concurrencyLimit`:

```typescript
concurrency: [{ scope: "fn", key: "`${event.data.orgId}:${event.data.concurrencyLimit}`", limit: /* dynamic via routing */ }]
```

- [x] Alternative: implement a simple Postgres-advisory-lock-based gate inside `dispatch-via-provider` if Inngest's static config can't express the dynamic limit; document the trade-off
- [x] Mark completed

### Task 6: Inngest function — call completed (post-call processor)

- [x] Create `src/lib/inngest/calls/completed.ts`:

```typescript
export const callCompleted = inngest.createFunction(
  { id: 'call-completed', retries: 3 },
  { event: 'call/completed' },
  async ({ event, step }) => {
    const { callId } = event.data;
    await step.run('persist-artifacts', () => persistCallArtifacts(callId)); // plan 08
    await step.run('charge-credit', () => chargeCallToLedger(callId)); // plan 05
    await step.run('classify-if-needed', () => classifyAndFinaliseCall(callId)); // plan 08
    await step.run('update-campaign-stats', () => incrementCampaignCounters(callId));
    await step.run('emit-downstream', () => emitOutcomeEvents(callId)); // appointments.booked etc., consumed by plan 13
  },
);
```

- [x] Step ordering is important: charge happens after duration is known but before classification (classification can fail without affecting billing)
- [x] Mark completed

### Task 7: Inngest function — campaign completed (terminal state)

- [x] Create `src/lib/inngest/campaigns/completed.ts`:
  - listens for `call/completed` events; on each, checks if `pending+dialing+in_progress` count for the campaign hit zero
  - when zero: transition campaign to `completed`, call `releaseReservation` for unused credit, emit `campaign/completed` event consumed by plan 12 (final report email)
- [x] Use a database advisory lock or upsert pattern to avoid double-finalisation
- [x] Mark completed

### Task 8: Cron — campaign aggregation

- [x] Create `src/app/api/cron/aggregate-campaigns/route.ts` (path already in `vercel.json` from plan 01) running every 5 minutes:
  - select `running` campaigns
  - for each, recompute live counters: total, pending, dialing, in-progress, completed by outcome, qualified-leads count, appointments-booked count, credit consumed
  - write to a `campaign_stats` materialised table or compute and cache via Inngest
- [x] Used by the dashboard for fast reads (avoid per-page-load aggregation)
- [x] Mark completed

### Task 9: Migration — `campaign_stats` table

- [ ] Add `0010_campaign_stats.sql`: per-campaign denormalised counters: `campaign_id PK`, `total_calls`, `pending_calls`, `dialing_calls`, `in_progress_calls`, `completed_calls`, `failed_calls`, `outcome_appointment_booked`, `outcome_interested`, `outcome_not_interested`, `outcome_wrong_number`, `outcome_callback`, `outcome_voicemail`, `outcome_do_not_call`, `total_billed_seconds`, `total_cost_cents`, `last_aggregated_at`
- [ ] Drizzle schema entry; queryable by Server Components for fast dashboard rendering
- [ ] Mark completed

### Task 10: Time-window utility

- [ ] Create `src/lib/utils/time-window.ts`:

```typescript
import { TZDate } from '@date-fns/tz';

export function nextWindowOpen(
  now: Date,
  windowStart: string,
  windowEnd: string,
  tz = 'Europe/Rome',
): Date | null {
  const local = new TZDate(now, tz);
  // ...check if currently inside window; otherwise compute next open considering weekdays only
}
```

- [ ] Default windowing: weekdays only, 09:00–19:00 (configurable per campaign within the legal envelope 08:00–22:00)
- [ ] Saturday and Sunday excluded by default (configurable)
- [ ] Italian public holidays: include a small list (Capodanno, Epifania, Liberazione, Festa del lavoro, Festa Repubblica, Ferragosto, Tutti i Santi, Immacolata, Natale, Santo Stefano) and skip them by default
- [ ] Add unit tests covering: midnight rollover, DST transitions (October last Sunday and March last Sunday), holiday skipping
- [ ] Mark completed

### Task 11: Retry policy

- [ ] Per-contact retry rules (spec §10.2):
  - max 3 attempts per contact per campaign
  - minimum 48h between attempts
  - second attempt at a different time-of-day from the first (random within window, but ≥3h offset)
- [ ] Implementation: when `call.completed` ends in `no_answer` or `busy`, schedule a follow-up `campaign/dispatch-call` event with `step.sendEvent` and `delay`
- [ ] Track attempts on the `calls` row (`attempt_number` column added in migration `0011_call_attempt.sql`)
- [ ] If all attempts exhausted, set `calls.status='failed'` with `error_code='max_attempts_reached'`
- [ ] Mark completed

### Task 12: Per-contact cooldown across campaigns

- [ ] When dispatching, also check if another **campaign** in the same org has called this contact in the last 7 days (default; configurable)
- [ ] If yes, skip with `error_code='cooldown_org_level'` and audit log
- [ ] Prevents the dealer from accidentally double-calling a recently-contacted person
- [ ] Mark completed

### Task 13: Campaign creation wizard (UI)

- [ ] Create `src/app/(app)/campaigns/new/page.tsx` with three-step wizard per spec §5.4:
  1. **Script**: list available scripts (from plan 07); preview the assembled system prompt
  2. **Contact list**: pick existing list or jump to upload (plan 06)
  3. **Schedule and review**: campaign name, optional `scheduled_start`, time-window override (with legal-envelope clamp), concurrency override, estimated cost summary, credit-balance check
- [ ] On final confirm, call `createCampaign` then immediately `launchCampaign` (or just `createCampaign` and leave in `scheduled` state if `scheduled_start` set)
- [ ] Mark completed

### Task 14: Campaigns list page

- [ ] Create `src/app/(app)/campaigns/page.tsx`:
  - tabs: Tutte, Bozze, In corso, Completate, Annullate
  - data table with columns: nome, script, contatti, stato, costo stimato/effettivo, creata
  - row actions: visualizza, metti in pausa/riprendi, annulla, duplica
  - empty state with CTA "Crea prima campagna"
- [ ] Mark completed

### Task 15: Campaign detail page (overview tab)

- [ ] Create `src/app/(app)/campaigns/[id]/page.tsx` with three tabs (live and results in plan 12; here just overview):
  - KPI grid: chiamate totali / completate / fallite, tasso di completamento, lead qualificati, appuntamenti fissati, credito consumato, durata media chiamata
  - status badge with last status change time
  - action buttons: Pausa, Riprendi, Annulla, Duplica, Esporta risultati
  - script and contact-list refs as clickable links
- [ ] Mark completed

### Task 16: Campaign pause/cancel UX

- [ ] Pausa: confirm dialog "Le chiamate in corso continueranno fino al termine; nessuna nuova chiamata sarà avviata"; calls `pauseCampaign`; in-flight Inngest steps complete naturally
- [ ] Annulla: harder confirm dialog requiring typing the campaign name; calls `cancelCampaign`; signals provider to terminate in-progress calls (`provider.cancelCall` for each `dialing|in_progress`); releases reservation immediately
- [ ] Both surface as toasts on success
- [ ] Mark completed

### Task 17: Failure handling and dead-letter

- [ ] If `dispatchCallViaProvider` throws (e.g. Vapi 5xx), Inngest retries 3x with exponential backoff
- [ ] After 3 failures the call is marked `failed/error_code='provider_error'` and its credit reservation released for that single call
- [ ] Aggregate count of failed dispatches per campaign; if >5% of contacts fail with provider errors in a 10-minute window, emit `system/voice-provider-degraded` alert (consumed by plan 14)
- [ ] Mark completed

### Task 18: Quotas and rate-limits at dispatcher

- [ ] Per-org daily call cap (default 5,000; configurable): if reached, defer remaining dispatches to next day
- [ ] Per-CLI hourly cap (30/hour, plan 10 detail): dispatcher checks before calling provider; if cap hit, picks another CLI or sleeps
- [ ] Platform-wide cap (Inngest `concurrency.limit: 100`) protects Twilio rate caps and contains blast radius
- [ ] Mark completed

### Task 19: Integration tests

- [ ] Test: launching a campaign with 50 contacts produces 50 `calls` rows in `pending` and 50 dispatched events
- [ ] Test: pause halts new dispatches; resume continues
- [ ] Test: cancel terminates all pending and releases credit
- [ ] Test: contact opted-out between planning and dispatch is skipped
- [ ] Test: time-window: dispatching at 22:30 sleeps until 09:00 next weekday
- [ ] Test: insufficient credit aborts launch
- [ ] Test: retry policy schedules correct follow-up events
- [ ] Test: end-to-end happy path with mocked Vapi adapter
- [ ] Mark completed

### Task 20: Definition of Done

- [ ] All four Inngest functions deployed and observable in Inngest dashboard
- [ ] Time-window enforcement verified across DST transitions
- [ ] Concurrency limits enforced and tested
- [ ] Pause/cancel work cleanly with reservation release
- [ ] Per-call retries respect 48h spacing and time-of-day variation
- [ ] Aggregate stats updated within 5 minutes of activity
- [ ] Mark completed

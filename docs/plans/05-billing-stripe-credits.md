# Plan: Billing — Stripe, Credits, Top-ups

**Branch:** `feat/05-billing-stripe-credits`
**Wave:** 2
**Depends on:** 01, 02, 03, 04
**Estimated effort:** 3–4 days

## Overview

Implements the entire prepaid billing model from spec §11: Stripe Checkout for top-ups, webhook-driven reconciliation into the credit ledger, the four credit packages (Test, Starter, Growth, Scale), low-balance and out-of-credit handling, per-call billing rules with 6-second granularity, and Italian VAT invoicing via Stripe Tax. The credit ledger built here is the authoritative source of truth queried by every campaign dispatch and every call completion in Wave 3.

## Context

The model is "cash before service": credit must be reserved at campaign launch and charged at call completion (spec §11.1). All money is integer cents EUR (spec §7.1). Idempotency on the ledger is enforced via the unique constraint on `(org_id, reference_type, reference_id, entry_type)` defined in plan 02. Stripe Checkout (hosted) is used in MVP — no PCI scope, no card form, native Italian VAT support (spec §11.2). Auto-recharge is intentionally NOT in Phase 1.

## Validation Commands

- `pnpm typecheck`
- `pnpm test src/lib/services/credit src/lib/services/payments src/lib/stripe`
- `pnpm test:integration src/lib/services/credit`
- `pnpm test:e2e e2e/billing.spec.ts`
- `pnpm exec stripe listen --forward-to localhost:3000/api/webhooks/stripe` (manual smoke test)

### Task 1: Stripe project setup

- [x] Create Stripe accounts: test mode for dev/staging, live mode for production (single Stripe account, two modes)
- [x] Configure business profile: legal entity (Italian SRLS once incorporated), VAT settings via Stripe Tax for Italian B2B
- [x] Enable Italian payment methods: card, SEPA Direct Debit, Bancomat Pay if available; disable methods unsuitable for B2B (Klarna etc.)
- [x] Configure invoice template: include legal name, VAT, address; default to Italian language and EUR
- [x] Configure customer portal (used later for self-serve invoice download): enable invoice history view only
- [x] Save publishable, secret, and webhook signing keys into 1Password
- [x] Mark completed

### Task 2: Stripe products and prices

- [x] Create one Stripe Product per credit package: `Test (200 minuti)`, `Starter (700 minuti)`, `Growth (2.000 minuti)`, `Scale (5.500 minuti)`
- [x] For each product create a one-time price in EUR matching spec §6.1 (€99, €299, €799, €1999)
- [x] Tag prices with metadata `package_slug`, `included_minutes`, `internal_id` (matching `credit_packages.id`)
- [x] Update the seed runner from plan 02 to backfill `credit_packages.stripe_price_id` from a JSON map committed to `src/lib/stripe/products.json`
- [x] Mark completed

### Task 3: Stripe SDK wrapper

- [x] Install `stripe` package
- [x] Create `src/lib/stripe/client.ts` exporting a singleton Stripe client built from `STRIPE_SECRET_KEY` with API version pinned
- [x] Define helper `getOrCreateCustomerForOrg(orgId)`:
  - look up `organizations.stripe_customer_id` (add column via migration `0007_stripe_customer.sql` — add `stripe_customer_id` to `organizations`)
  - if missing, create a Stripe Customer with metadata `org_id`, `vat_number`, `legal_name`, persist back
  - return Stripe customer id
- [x] Mark completed

### Task 4: Credit service — balance and ledger writes

- [ ] Create `src/lib/services/credit.ts` exposing:

```typescript
export async function getBalance(
  orgId: string,
): Promise<{ balanceCents: number; remainingMinutes: number }>;

export async function topUp(
  orgId: string,
  params: {
    amountCents: number;
    packageId: string;
    stripePaymentIntentId: string;
    description: string;
  },
): Promise<void>;

export async function reserveForCampaign(
  orgId: string,
  campaignId: string,
  maxCents: number,
): Promise<void>;

export async function releaseReservation(orgId: string, campaignId: string): Promise<void>;

export async function chargeForCall(
  orgId: string,
  callId: string,
  costCents: number,
): Promise<void>;

export async function refundCall(
  orgId: string,
  callId: string,
  costCents: number,
  reason: string,
): Promise<void>;

export async function adjust(
  orgId: string,
  byUserId: string,
  deltaCents: number,
  reason: string,
): Promise<void>;
```

- [ ] Every function runs inside `db.transaction` with `SELECT ... FOR UPDATE` on the latest ledger row to serialise concurrent writes per org and avoid stale running balance
- [ ] All operations are idempotent on `(org_id, reference_type, reference_id, entry_type)` — duplicate webhook deliveries become no-ops
- [ ] `remainingMinutes` is computed against the org's last-purchased package per-minute rate (or weighted average — implement weighted average for fairness when multiple packages co-exist)
- [ ] Mark completed

### Task 5: Per-call billing computation

- [ ] Create `src/lib/services/billing-rules.ts` with `computeCallCost`:

```typescript
const BILLING_GRANULARITY_SECONDS = 6;
const MIN_BILLABLE_SECONDS = 6;

export function computeCallCost(args: { durationSeconds: number; perMinuteCents: number }): {
  billableSeconds: number;
  costCents: number;
} {
  if (args.durationSeconds < MIN_BILLABLE_SECONDS) {
    return { billableSeconds: 0, costCents: 0 };
  }
  const billable =
    Math.ceil(args.durationSeconds / BILLING_GRANULARITY_SECONDS) * BILLING_GRANULARITY_SECONDS;
  const cost = Math.ceil((billable / 60) * args.perMinuteCents);
  return { billableSeconds: billable, costCents: cost };
}
```

- [ ] Compute `perMinuteCents` per org as a weighted average over un-consumed minute pools (track per-pool consumption; when a pool is depleted move to the next)
- [ ] Add unit tests covering: under min duration, exactly 6s, 7s rounding up, full minute, partial minute
- [ ] Document the rule in customer-facing pricing page (work for plan 12)
- [ ] Mark completed

### Task 6: Credit reservation estimator

- [ ] Create `src/lib/services/campaign-cost-estimator.ts` with `estimateCampaignCost(input)`:
  - inputs: `contactCount`, optional `expectedAvgDurationSeconds` (default 90 from historical baseline; configurable per template)
  - output: `{ minCents, expectedCents, maxCents }` where `maxCents` uses `MAX_CALL_DURATION` (default 180s, per `CreateCallParams.maxDurationSeconds`)
- [ ] At launch we reserve `maxCents` per spec §11.1 to guarantee the campaign cannot exceed available credit mid-run
- [ ] Add unit tests
- [ ] Mark completed

### Task 7: Stripe Checkout Session creation

- [ ] Create Server Action `createTopupSession({ packageId })`:
  - resolves the active org and member capability `billing.topup`
  - looks up `credit_packages` row for the requested slug
  - calls `getOrCreateCustomerForOrg`
  - creates a `checkout.Session` in mode `payment` with `line_items: [{ price: stripe_price_id, quantity: 1 }]`, `success_url`, `cancel_url`, `automatic_tax: { enabled: true }`, `metadata: { org_id, package_id, internal_session_id }`, `customer: stripeCustomerId`, `payment_method_types: ['card', 'sepa_debit']`, `invoice_creation: { enabled: true }`, `customer_update: { address: 'auto', name: 'auto' }`
  - inserts a `payments` row with `status: 'pending'` recording the `stripe_session_id`
  - returns the session URL
- [ ] Mark completed

### Task 8: Top-up page

- [ ] Create `src/app/(app)/credit/topup/page.tsx` rendering four package cards (€99, €299, €799, €1999) with per-minute rate, included minutes, recommended use ("Concessionario piccolo", etc.)
- [ ] Selecting a package and clicking "Procedi al pagamento" calls `createTopupSession`, then `window.location` to the returned URL
- [ ] Cancel URL returns to `/credit/topup?cancelled=1` with a toast
- [ ] Success URL is `/credit/topup/success?session_id={CHECKOUT_SESSION_ID}` (Task 9)
- [ ] Mark completed

### Task 9: Success page with reconciliation poll

- [ ] Create `src/app/(app)/credit/topup/success/page.tsx`:
  - fetches the matching `payments` row by `stripe_session_id`
  - if `status = succeeded` → show success state with new balance (link to dashboard)
  - if still `pending` → polling loop (every 2s, max 30s) checking `payments.status` server-side
  - after 30s timeout → fallback message "Riceverai un'email appena il pagamento è confermato"
- [ ] Use Supabase Realtime subscription to `payments` row as an alternative to polling (Realtime publication enabled in plan 02)
- [ ] Mark completed

### Task 10: Stripe webhook handler

- [ ] Create `src/app/api/webhooks/stripe/route.ts`:
  - read raw body (Next.js: `await req.text()`), verify signature with `stripe.webhooks.constructEvent`
  - dedupe via `webhook_events` table by `(provider='stripe', provider_event_id=event.id)`
  - persist event payload regardless of processing outcome
- [ ] Handle these event types:
  - `checkout.session.completed`: update `payments.status='succeeded'`, call `topUp` to credit the ledger, set `payments.invoice_url` if available, audit log
  - `checkout.session.expired`: update `payments.status='failed'`
  - `payment_intent.payment_failed`: update payment, send notification (email handled in plan 13)
  - `charge.refunded`: call `refundCall` if metadata maps to a call OR adjust the ledger if it's a top-up refund (admin action)
  - `customer.updated`: sync VAT/legal name back to `organizations` if changed
- [ ] All processing happens via `withSystemContext` (cross-org work) but always operates on the explicit `org_id` extracted from session metadata
- [ ] Return 200 within 3 seconds; defer heavy work (email, etc.) to Inngest events
- [ ] Mark completed

### Task 11: Stripe webhook signature verification utility

- [ ] Extract signature verification into `src/lib/stripe/verify.ts` for unit testability
- [ ] Add unit tests using fixture payloads + a known signing secret
- [ ] Mark completed

### Task 12: Credit page — balance and history

- [ ] Create `src/app/(app)/credit/page.tsx`:
  - top: large balance display (remaining minutes + cents), "Ricarica" CTA
  - middle: package consumption breakdown (when multiple packages active)
  - bottom: paginated ledger history (last 100 entries) with type badges (top-up, charge, reservation, refund), description, delta, balance after, timestamp
- [ ] Filters: by entry type, by date range
- [ ] Export to CSV button (downloads the filtered ledger)
- [ ] Mark completed

### Task 13: Low-balance threshold monitor

- [ ] Define thresholds in env: `CREDIT_SOFT_THRESHOLD_MINUTES=30`, `CREDIT_HARD_THRESHOLD_CENTS=0`
- [ ] After every charge in `chargeForCall`, compute remaining minutes; if it crosses below the soft threshold for the first time today (compared against `audit_log` entries), emit Inngest event `credit.low-balance` with `{ orgId, balance, remainingMinutes }`
- [ ] Inngest handler (in plan 09 or 13): send "Credito basso" email to org owner
- [ ] Hard threshold is checked at dispatch time in plan 09's `campaign.dispatch-call`
- [ ] Mark completed

### Task 14: Pre-launch credit check on campaign creation

- [ ] Expose helper `canAffordCampaign(orgId, estimateCents)` returning `{ ok: true } | { ok: false, currentCents, requiredCents }`
- [ ] Used in plan 09's campaign launch flow; here we only define and unit-test the helper
- [ ] On the campaign creation wizard (built in plan 09) the helper renders a warning when estimated cost exceeds 80% of available credit
- [ ] Mark completed

### Task 15: Manual credit adjustment (admin tooling)

- [ ] Create internal-only route `/api/admin/credit-adjustment` callable with a server-side admin token (env `INTERNAL_ADMIN_TOKEN`)
- [ ] Body: `{ orgId, deltaCents, reason }`; logs to `audit_log` with `actor_type='system'`
- [ ] Document the runbook in `docs/runbooks/credit-adjustment.md` (full population in plan 14)
- [ ] Mark completed

### Task 16: Reconciliation cron

- [ ] Add `/api/cron/credit-reconciliation` running daily at 04:00 Europe/Rome:
  - select all `payments` in `pending` for >2 hours → query Stripe and reconcile
  - select last 24h ledger; assert sum of `delta_cents` for an org equals `MAX(balance_after_cents) - previous_day_balance` (sanity check)
  - log discrepancies to Sentry; alert on >€0.10 discrepancy
- [ ] Mark completed

### Task 17: Invoicing access

- [ ] Add download links for invoices on the credit history page (each top-up row links to its `invoice_url`)
- [ ] On settings page add link "Storico fatture" → Stripe customer portal session for that org
- [ ] Mark completed

### Task 18: E2E billing flow with Stripe test mode

- [ ] Playwright `e2e/billing.spec.ts`:
  - sign in as a test user
  - navigate to `/credit/topup`, click Starter
  - on Stripe Checkout fill the test card `4242 4242 4242 4242`, complete payment
  - assert redirect to success page
  - wait for Realtime/poll, assert balance shows €299 / 700 minutes
  - assert ledger has a topup entry
- [ ] Use Stripe CLI's `stripe trigger` or test-clock features for SCA edge cases
- [ ] Mark completed

### Task 19: Definition of Done

- [ ] Stripe products and prices created and persisted to `credit_packages`
- [ ] Top-up flow works end to end with a test card
- [ ] Webhook handler verifies signatures and is idempotent (verified with duplicate-delivery test)
- [ ] Credit ledger never produces negative balances (covered by integration test)
- [ ] All ledger writes are inside transactions with `SELECT FOR UPDATE`
- [ ] Per-call cost computation matches spec §11.3 exactly (unit tests cover boundaries)
- [ ] VAT invoice generated and accessible from the dashboard
- [ ] Low-balance event emitted on threshold crossing
- [ ] Audit log records every monetary movement
- [ ] Mark completed

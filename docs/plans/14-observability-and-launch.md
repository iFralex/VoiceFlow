# Plan: Observability, Alerting, Runbooks, Launch

**Branch:** `feat/14-observability-and-launch`
**Wave:** 5
**Depends on:** 01–13 (sequential close-out)
**Estimated effort:** 3–5 days

## Overview

The final wave that turns a feature-complete platform into a production-ready service. Wires Sentry for error tracking with privacy-aware before-send filters, Axiom for structured logging with org/call correlation, alerting tiers across channels, the feature-flag system, the backup and disaster-recovery drill, the operational runbooks, the launch smoke-test checklist, and the go-live procedure. After this plan merges, the platform can carry real customers.

## Context

Phase 1 is bootstrap: alerting must be loud enough to catch real issues but quiet enough not to drown the founder. Three tiers (critical, high, info) with distinct channels (PagerDuty/SMS, email, Slack-stub). Feature flags via PostHog (or Statsig) enable safe rollouts of risky features (Phase 2 voice-stack canary). Backups: Supabase point-in-time recovery is enabled but we still test a real restore quarterly. Runbooks: every operational task a non-engineer might attempt is written down.

## Validation Commands

- `pnpm typecheck`
- `pnpm test src/lib/observability src/lib/feature-flags`
- `pnpm test:integration src/lib/observability`
- `pnpm test:e2e e2e/launch-smoke.spec.ts`
- `pnpm exec tsx scripts/sentry-test-error.ts` (manual: emits a test error)
- `pnpm exec tsx scripts/axiom-test-log.ts` (manual: emits a test log batch)

### Task 1: Sentry setup

- [x] Install `@sentry/nextjs`; run `pnpm dlx @sentry/wizard@latest -i nextjs --skip-connect` and accept config
- [x] Configure `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts` with `dsn` from env, traces sample rate 0.1 in production, 1.0 in staging
- [x] Configure `beforeSend` filter to scrub PII per spec §15.2:

```typescript
beforeSend(event, hint) {
  const text = JSON.stringify(event);
  // strip phone numbers (Italian E.164)
  event = JSON.parse(text.replace(/\+39[0-9]{6,12}/g, "[redacted-phone]"));
  // strip emails
  event = JSON.parse(JSON.stringify(event).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]"));
  return event;
}
```

- [x] Configure user context: attach `userId` and `orgId` from auth context but NOT email
- [x] Source maps uploaded automatically on Vercel build via `withSentryConfig`
- [x] Mark completed

### Task 2: Axiom logging

- [x] Install `@axiomhq/js`; create `src/lib/observability/logger.ts`:

```typescript
import { Axiom } from '@axiomhq/js';
const axiom = env.AXIOM_TOKEN ? new Axiom({ token: env.AXIOM_TOKEN }) : null;

export const logger = {
  info(msg: string, ctx?: Record<string, unknown>) {
    write('info', msg, ctx);
  },
  warn(msg: string, ctx?: Record<string, unknown>) {
    write('warn', msg, ctx);
  },
  error(msg: string, ctx?: Record<string, unknown>) {
    write('error', msg, ctx);
  },
};

async function write(level: string, message: string, ctx: Record<string, unknown> = {}) {
  const enriched = { level, message, ts: new Date().toISOString(), ...ctx };
  if (env.NODE_ENV !== 'production') console.log(enriched);
  if (axiom) await axiom.ingest(env.AXIOM_DATASET!, [enriched]);
}
```

- [x] Mandatory context for every log: `org_id`, `user_id`, `call_id` (if present), `campaign_id` (if present), `request_id`
- [x] Add a request middleware that injects a `request_id` header (UUID v4) on inbound requests; propagate via `AsyncLocalStorage` so nested logs include it automatically
- [x] Mark completed

### Task 3: Replace ad-hoc logs with structured logger

- [x] Sweep `src/` for `console.log`, `console.error`; replace with `logger.info`/`logger.error` carrying structured context
- [x] ESLint rule `no-console` upgraded from warn to error (with `allow: ['warn']` reserved for known-safe edges)
- [x] Mark completed

### Task 4: Alerting tiers

- [x] Define three tiers in `docs/runbooks/alerting.md`:
  - **CRITICAL** (page founder via SMS/PagerDuty): system outage, payment processor outage, RPO check fully unavailable >15 min, voice provider 5xx >5%, DB connection failures, security incidents
  - **HIGH** (email + Slack channel): elevated voice-provider error rate <5%, AI Act disclosure failure rate >2% over 1h, CLI pool >50% in cooling-down, webhook deactivation >5 in a day
  - **INFO** (Slack channel only): individual call failures, individual webhook retries, low-balance events for orgs
- [x] Implement Sentry alert rules matching CRITICAL and HIGH using Sentry's "Issue Alerts" UI (manual: rules documented in docs/runbooks/alerting.md; configure via Sentry UI)
- [x] Implement Axiom monitors with thresholds for HIGH-tier metrics (manual: APL queries documented in docs/runbooks/alerting.md; configure via Axiom dashboard)
- [x] Document escalation paths and quiet hours (CRITICAL pages 24/7; HIGH only 08:00–22:00)
- [x] Mark completed

### Task 5: Health and readiness endpoints

- [x] Create `src/app/api/health/route.ts` returning `{ status: "ok" }` cheaply (no DB)
- [x] Create `src/app/api/ready/route.ts` checking: DB SELECT 1, Stripe API ping, Vapi API ping, Resend ping; aggregates and returns 200 if all green, 503 otherwise
- [x] Document in `docs/operations.md` how to use these endpoints (Vercel internal monitoring, uptime services)
- [x] Set up an external uptime monitor (Uptime Robot or Better Stack) hitting `/api/ready` every 5 min from EU; alert on 2 consecutive failures [manual: configuration steps documented in docs/operations.md]
- [x] Mark completed

### Task 6: Feature flags

- [x] Sign up for PostHog (free tier sufficient for MVP) — alternative: Statsig [manual: founder must create PostHog account and set NEXT_PUBLIC_POSTHOG_KEY]
- [x] Install `posthog-node` and `posthog-js`
- [x] Create `src/lib/feature-flags/client.ts` exposing `isFlagEnabled(orgId: string, flagKey: string): Promise<boolean>` server-side and a hook `useFlag(flagKey)` client-side
- [x] Initial flags:
  - `voice.proprietary-stack` (Phase 2 canary; default off)
  - `internal.test_call` (gates the test-call endpoint from plan 08; default on for staging only)
  - `dashboard.cmd-k-search` (default on; quick kill switch if heavy)
  - `compliance.aiact-monthly-audit` (default on)
  - `email.weekly-summary` (default on; gate to disable Mondays if overrun)
  - `internal.disclosure-failures-page` (default off in production until QA process is mature)
- [x] Document flag-flip procedure in `docs/runbooks/feature-flags.md`
- [x] Mark completed

### Task 7: Backup verification and DR drill

- [x] Confirm Supabase Point-in-Time Recovery (PITR) is enabled on production project (paid feature; ensure the PostgreSQL plan is at the level that supports it) [manual: steps documented in docs/runbooks/disaster-recovery.md §1]
- [x] Configure daily logical backups (`pg_dump`) to a Backblaze B2 bucket via a Vercel cron `/api/cron/backup` running 03:30 Europe/Rome:
  - dumps schema + data
  - encrypts with `age` using a public key, private key in 1Password
  - uploads to B2 with 30-day retention lifecycle
- [x] Document restore procedure in `docs/runbooks/disaster-recovery.md` covering: point-in-time recovery via Supabase UI, full logical restore from B2 backup, partial table restore
- [x] Run a DR drill: spin up `VoiceFlow-staging`, restore the latest backup into it, verify integrity and queryability; record the RTO and RPO observed [manual: quarterly drill procedure documented in docs/runbooks/disaster-recovery.md §4]
- [x] Schedule quarterly DR drill (next due date noted in calendar, runbook checklist) [manual: next drill date 2026-08-11 noted in docs/runbooks/disaster-recovery.md]
- [x] Mark completed

### Task 8: Runbook — credential rotation

- [x] Author `docs/runbooks/credential-rotation.md` covering:
  - Stripe API keys (every 12 months)
  - Vapi/Retell API keys (every 6 months)
  - Supabase service-role keys (annual, with care)
  - Resend API keys
  - SBC trunk passwords (every 6 months)
  - Internal HMAC secrets (annual)
  - PAT regeneration policy for users
- [x] Each section includes: where to rotate, where to update env vars (Vercel + 1Password), verification step, rollback path
- [x] Mark completed

### Task 9: Runbook — webhook replay

- [x] Author `docs/runbooks/webhook-replay.md`:
  - locating the failed delivery in the Stripe/Vapi dashboard
  - using the admin replay endpoint (or the Stripe CLI for Stripe events)
  - verifying idempotency via `webhook_events` table
  - escalation if replay fails repeatedly
- [x] Mark completed

### Task 10: Runbook — manual credit adjustment

- [ ] Author `docs/runbooks/credit-adjustment.md` documenting plan 05's `/api/admin/credit-adjustment` endpoint:
  - approval flow (founder writes a brief in a Notion / shared doc)
  - executing the adjustment
  - confirming on the org's credit page
  - communication template to the dealer
- [ ] Mark completed

### Task 11: Runbook — GDPR erasure

- [ ] Author `docs/runbooks/gdpr-erasure.md`:
  - intake (where the request comes from: in-app, email, postal)
  - identity verification of the requestor
  - executing the erasure via the `/settings/compliance` page
  - 30-day grace period and final hard purge
  - communication template (confirmation email to requestor)
- [ ] Mark completed

### Task 12: Runbook — Twilio/Vapi incident

- [ ] Author `docs/runbooks/voice-provider-incident.md`:
  - detection (alerts, dashboard observation)
  - immediate triage (check provider status pages, error rate trend)
  - mitigation: switch `VOICE_PROVIDER` to `retell` if Vapi outage; or flip SBC fallback to Twilio if SBC down
  - communication: status email template to active-campaign customers; in-app banner template
  - post-incident: blameless review template
- [ ] Mark completed

### Task 13: Smoke test e2e — launch-readiness

- [ ] Playwright `e2e/launch-smoke.spec.ts` running against production-equivalent staging:
  - sign up via magic link with a fresh email
  - create org through onboarding (with DPA acceptance)
  - top up credit via Stripe test card
  - upload a 10-row CSV
  - configure a script from `lead-reactivation`
  - launch a campaign with 1 contact targeting an internal test number that auto-records and hangs up
  - poll until call status `completed`
  - assert recording, transcript, outcome populated
  - assert appointment booked email arrives in test inbox (if outcome was appointment_booked) or qualified-lead email
  - export campaign results CSV
  - run GDPR export for the test contact
  - run GDPR erasure for the test contact
- [ ] Run this suite as the "launch gate" check; document expected runtime ~10 minutes
- [ ] Schedule weekly via cron (existing `/api/cron/sbc-smoke-test` extended)
- [ ] Mark completed

### Task 14: Pre-launch checklist

- [ ] Author `docs/runbooks/launch-checklist.md` enumerating every item that must be true before the first paying customer:
  - all 14 plans merged
  - Vercel production env vars filled (cross-check against `.env.example`)
  - Supabase production project provisioned with PITR
  - Stripe live mode keys configured; Italian VAT settings verified
  - SBC trunk procured with at least 10 active CLIs
  - RPO intermediary contract live; daily snapshot cron green for 7 days
  - Resend domain verified with SPF/DKIM/DMARC
  - Sentry receives test error from production
  - Axiom receives logs from production
  - Uptime monitor green for 7 days
  - DR drill completed in the last 90 days
  - Founder has documented runbooks accessible
  - Launch smoke test green for 3 consecutive runs
  - Legal review of privacy/DPA/terms complete
- [ ] Each item is a checkbox in the runbook; founder ticks them off as the launch sign-off ritual
- [ ] Mark completed

### Task 15: Customer-facing status page

- [ ] Set up a status page (Statuspage by Atlassian, Better Stack, or self-hosted Cachet) with components:
  - Web app (Vercel)
  - API
  - Database (Supabase)
  - Voice service (Vapi)
  - Telephony (SBC)
  - Email (Resend)
  - Compliance (RPO)
- [ ] Subscribe the status page to uptime checks and add manual incident-posting workflow
- [ ] Link to status page from the marketing footer and from the in-app help menu
- [ ] Mark completed

### Task 16: Quality monitoring of calls

- [ ] Create `/admin/quality` (founder-only) page surfacing per spec §15.5:
  - sample 1% of completed calls per day for human review
  - QA checklist: disclosure verified, transcript readable, outcome correctly classified, no offensive language, no privacy leak
  - status fields: pending review, ok, needs improvement (with note)
  - link to recording player and transcript for each
- [ ] Reviews persisted in `qa_reviews` table (migration `0020_qa_reviews.sql`)
- [ ] Aggregate weekly stats surfaced on the same page
- [ ] Mark completed

### Task 17: Phase 2 readiness scaffolding

- [ ] Although Phase 2 (proprietary voice stack) is post-launch work, drop placeholders that make the future migration cheap:
  - `VOICE_PROVIDER` env supports `proprietary` value (factory throws explanatory error in Phase 1)
  - `voice_catalogue.provider` enum already includes `proprietary`
  - feature flag `voice.proprietary-stack` already created (Task 6)
- [ ] Document Phase 2 acceptance criteria in `docs/architecture-decisions/0004-phase-2-voice.md` referencing spec §17
- [ ] Mark completed

### Task 18: Founder operations dashboard

- [ ] Create `/admin/operations` (founder-only) consolidating:
  - active orgs count, MRR-equivalent (sum of credit consumed last 30d × per-minute pricing)
  - active campaigns count
  - 24h call volume + outcome breakdown
  - 24h credit consumed
  - CLI pool health summary (active / cooling / retired)
  - Stripe payment volume last 30d
  - failed webhook deliveries last 24h
  - GDPR requests last 30d
- [ ] All read via existing tables; no new schema needed
- [ ] Mark completed

### Task 19: Final go-live procedure

- [ ] Author `docs/runbooks/go-live.md`:
  - day -7: complete pre-launch checklist
  - day -3: invite first 3 pilot dealers; manual onboarding call
  - day -1: confirm all alerts wired; confirm founder phone number on Sentry/PagerDuty
  - day 0: enable production traffic; tail logs for 4h; founder available on-call 24h
  - day +1, +3, +7: pilot review checkpoints with each dealer
  - day +14: review pilot data, decide on broader launch
- [ ] Mark completed

### Task 20: Definition of Done

- [ ] Sentry receives errors from production with PII scrubbed
- [ ] Axiom receives structured logs with org/call correlation
- [ ] All alerts configured and verified by injected test conditions
- [ ] Health and ready endpoints respond correctly
- [ ] Feature flags toggleable from PostHog dashboard with sub-30s propagation
- [ ] Backup cron green; DR drill complete with documented RTO/RPO
- [ ] Runbooks (8+) reviewed and committed
- [ ] Launch smoke test green for 3 consecutive runs
- [ ] Status page live and subscribed to uptime
- [ ] Quality monitoring sampling 1% of calls
- [ ] Founder operations dashboard live
- [ ] Pre-launch checklist all items ticked
- [ ] Mark completed

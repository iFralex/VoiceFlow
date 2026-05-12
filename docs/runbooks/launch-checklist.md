# Pre-Launch Checklist

This runbook enumerates every condition that must be verified before the first paying customer is onboarded. The founder (or launch lead) works through each item and ticks the checkbox as a formal sign-off ritual.

**Expected time to complete:** 2–4 hours on launch day, assuming all items have been prepared across the preceding weeks.

---

## Code and Deployment

- [ ] All 14 plans merged to `main` and deployed to production
- [ ] No open critical or high-severity bugs in the issue tracker
- [ ] Latest production deployment status is green on Vercel
- [ ] Source maps uploaded to Sentry for the latest production build

---

## Environment Variables

- [ ] All variables listed in `.env.example` are filled in the Vercel production environment
- [ ] `CRON_SECRET` is set (min 16 chars) and all `/api/cron/*` routes protected
- [ ] `INTERNAL_ADMIN_TOKEN` is set (min 32 chars)
- [ ] `DATABASE_URL` (pooler) and `DATABASE_DIRECT_URL` (direct) are set and pointing to production Supabase
- [ ] `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`, `NEXT_PUBLIC_APP_URL` are set
- [ ] `VAPI_API_KEY` (or `RETELL_API_KEY`) is set for the active voice provider
- [ ] `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are live-mode keys (not test)
- [ ] `SENTRY_DSN` is set in both Vercel and locally-tested configs
- [ ] `AXIOM_TOKEN` and `AXIOM_DATASET` are set
- [ ] `NEXT_PUBLIC_POSTHOG_KEY` is set for feature flags

---

## Database

- [ ] Supabase production project provisioned (PostgreSQL plan with Point-in-Time Recovery enabled)
- [ ] All Drizzle migrations applied: `pnpm db:migrate` exits cleanly against production direct URL
- [ ] Seed data applied: `pnpm db:seed` populates script templates, voice catalogue, credit packages
- [ ] RLS policies verified: spot-check that cross-org query isolation holds (run integration tests)

---

## Payments

- [ ] Stripe live-mode keys configured; webhook endpoint registered and verified
- [ ] Italian VAT settings configured in Stripe Tax (aliquota IVA 22%)
- [ ] At least one credit package visible in the `/billing` page in production
- [ ] A test top-up with a real card processed and credit balance updated correctly

---

## Voice and Telephony

- [ ] SBC trunk procured with at least 10 active CLIs (outbound dial capacity)
- [ ] CLI pool seeded: `pnpm db:seed` populates `phone_numbers` table with production E.164 numbers
- [ ] Outbound test call from production completes successfully to internal test number
- [ ] `VOICE_PROVIDER` env resolves to `vapi` or `retell` (not a stub); voice catalogue populated
- [ ] SBC smoke test cron (`/api/cron/sbc-smoke-test`) green for the last 7 days

---

## Email

- [ ] Resend domain verified with SPF, DKIM, and DMARC records in DNS
- [ ] Transactional emails (magic-link, credit-low, campaign-complete) deliver to a test inbox
- [ ] `EMAIL_FROM_ADDRESS` passes spam checks (MXToolbox or mail-tester.com ≥ 9/10)
- [ ] `EMAIL_REPLY_TO` and `SUPPORT_EMAIL_ADDRESS` configured if applicable

---

## Compliance / RPO

- [ ] RPO (Responsabile della Protezione dei Dati) intermediary contract signed and live
- [ ] Daily AI Act disclosure snapshot cron (`/api/cron/retention-purge`) green for 7 days
- [ ] GDPR erasure flow tested end-to-end in staging: data hard-deleted after 30-day grace period
- [ ] DPA (Data Processing Agreement) banner shown to new orgs and acceptance recorded in DB
- [ ] Privacy policy, cookie policy, and Terms of Service linked from marketing footer

---

## Observability

- [ ] Sentry receives a test error from production (`pnpm exec tsx scripts/sentry-test-error.ts` against production DSN)
- [ ] PII scrubbing verified: phone numbers and emails replaced with `[redacted-*]` in Sentry events
- [ ] Axiom receives structured logs from production (`pnpm exec tsx scripts/axiom-test-log.ts` against production token)
- [ ] Alerting rules configured in Sentry (CRITICAL and HIGH tiers per `docs/runbooks/alerting.md`)
- [ ] Axiom monitors configured with thresholds per `docs/runbooks/alerting.md`
- [ ] Founder phone number registered on Sentry / PagerDuty for CRITICAL pages

---

## Health and Uptime

- [ ] `/api/health` returns `200 { status: "ok" }` in production
- [ ] `/api/ready` returns `200` with all dependency checks green (DB, Stripe, Vapi/Retell, Resend)
- [ ] External uptime monitor (Uptime Robot or Better Stack) configured to hit `/api/ready` every 5 min from EU
- [ ] Uptime monitor has been green for 7 consecutive days before launch

---

## Backup and Disaster Recovery

- [ ] Supabase PITR confirmed enabled on production project
- [ ] Backup cron (`/api/cron/backup`) has been green for 7 consecutive days
- [ ] Latest backup downloaded from Backblaze B2 and spot-checked for integrity
- [ ] DR drill completed in the last 90 days (restore into staging, verify queryability); RTO/RPO documented in `docs/runbooks/disaster-recovery.md`

---

## Feature Flags

- [ ] PostHog project created; `NEXT_PUBLIC_POSTHOG_KEY` set in production
- [ ] All flags listed in `docs/runbooks/feature-flags.md` created in PostHog with correct defaults
- [ ] `voice.proprietary-stack` is OFF in production
- [ ] `internal.test_call` is OFF in production (or gated to staging only)
- [ ] Flag propagation tested: flip a flag in PostHog dashboard; change observed in app within 30 seconds

---

## Runbooks

- [ ] `docs/runbooks/alerting.md` — reviewed and committed
- [ ] `docs/runbooks/credential-rotation.md` — reviewed and committed
- [ ] `docs/runbooks/disaster-recovery.md` — reviewed and committed
- [ ] `docs/runbooks/feature-flags.md` — reviewed and committed
- [ ] `docs/runbooks/gdpr-erasure.md` — reviewed and committed
- [ ] `docs/runbooks/webhook-replay.md` — reviewed and committed
- [ ] `docs/runbooks/credit-adjustment.md` — reviewed and committed
- [ ] `docs/runbooks/voice-provider-incident.md` — reviewed and committed
- [ ] `docs/runbooks/launch-checklist.md` — this file, reviewed and committed
- [ ] `docs/runbooks/go-live.md` — reviewed and committed
- [ ] Founder has read all runbooks and can locate them without assistance

---

## Smoke Test

- [ ] Launch smoke test suite (`e2e/launch-smoke.spec.ts`) executed against staging
- [ ] Smoke test green for 3 consecutive weekly runs (automated cron)
- [ ] Expected runtime ≤ 10 minutes; any regression in runtime investigated

---

## Legal

- [ ] Legal review of privacy policy complete (data retention, GDPR Article 13 disclosure)
- [ ] DPA template reviewed by legal counsel
- [ ] Terms of Service reviewed by legal counsel
- [ ] AI Act compliance disclosure reviewed by legal counsel
- [ ] GDPR Article 30 records of processing activities (RPA) document prepared

---

## Sign-Off

This checklist must be fully ticked before any paying customer is onboarded. If any item cannot be ticked, document the reason and the mitigation in a note below before proceeding.

**Signed off by:** ___________________________________

**Date:** ___________________________________

**Notes (outstanding items and mitigations):**

_(none — all items ticked)_

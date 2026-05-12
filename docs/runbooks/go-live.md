# Go-Live Procedure

This runbook walks through the final week of preparation and the first two weeks of live operation. Follow it sequentially. Each phase builds on the previous one.

**Owner:** Founder / launch lead
**Pre-requisite:** `docs/runbooks/launch-checklist.md` fully ticked

---

## Day −7: Complete Pre-Launch Checklist

Goal: resolve every open item before the countdown begins. A single unchecked item here blocks go-live.

**Actions:**

- [ ] Work through every item in `docs/runbooks/launch-checklist.md` top to bottom
- [ ] Deploy the release candidate to production Vercel and confirm the build is green
- [ ] Run `pnpm typecheck && pnpm lint` against the release commit
- [ ] Execute the launch smoke test suite against staging: `pnpm test:e2e e2e/launch-smoke.spec.ts`
- [ ] Confirm `/api/ready` returns `200` with all dependencies green
- [ ] Confirm Sentry and Axiom receive data from the staging/production environment
- [ ] Confirm uptime monitor is green
- [ ] Confirm backup cron has run successfully at least once against production
- [ ] Review all open GitHub issues for anything labelled `launch-blocker`; close or defer every one
- [ ] Document any items that could not be fully ticked and note the mitigation

**Done when:** launch-checklist.md is fully signed off with no unmitigated blockers.

---

## Day −3: Invite Pilot Dealers

Goal: onboard the first three pilot dealers manually so each has a working account before day 0.

**Actions:**

- [ ] Select three pilot dealers from the beta waiting list (ideally from different regions or verticals)
- [ ] Schedule a 30-minute onboarding call with each dealer (video call + screen share)
- [ ] During each call:
  - Create their org via the normal sign-up flow (magic link)
  - Walk through DPA acceptance and privacy settings
  - Top up their credit account with a complimentary package (use the `/api/admin/credit-adjustment` endpoint documented in `docs/runbooks/credit-adjustment.md`)
  - Import a sample contact list (10–20 rows) and run a test campaign to an internal number
  - Confirm they can hear the call, read the transcript, and see the outcome in the dashboard
  - Share the link to the customer-facing status page (`NEXT_PUBLIC_STATUS_PAGE_URL`)
- [ ] Document any UX friction or confusion observed during each call; file issues immediately
- [ ] After each call, confirm the pilot dealer can log in independently without assistance
- [ ] Give each pilot dealer direct contact info (email + phone) for the first week

**Done when:** three pilot dealers have verified, functioning accounts and have completed at least one live test campaign.

---

## Day −1: Final Operational Check

Goal: confirm every alerting, monitoring, and on-call system is live before traffic starts.

**Actions:**

- [ ] Verify founder phone number is registered in Sentry notifications and PagerDuty (CRITICAL tier)
- [ ] Test CRITICAL alert path: trigger a forced Sentry error via `pnpm exec tsx scripts/sentry-test-error.ts` against production and confirm SMS/PagerDuty fires
- [ ] Verify HIGH alert path: confirm email arrives for a HIGH-tier simulated condition
- [ ] Confirm Axiom dashboard is accessible and showing recent log ingest from production
- [ ] Confirm the status page (Better Stack / Statuspage) shows all components as Operational
- [ ] Confirm external uptime monitor is configured and running
- [ ] Re-run smoke test against staging one final time: `pnpm test:e2e e2e/launch-smoke.spec.ts`
- [ ] Brief the founder on CRITICAL-alert response: what to do at 03:00 if PagerDuty fires
  - Check `/api/ready` output for the failing dependency
  - Follow the relevant runbook (`docs/runbooks/voice-provider-incident.md`, `docs/runbooks/disaster-recovery.md`, etc.)
  - If unresolvable in 30 min, post an incident on the status page and email pilot dealers
- [ ] Confirm all pilot dealer accounts are still active and they have received their welcome email
- [ ] Set personal calendar block: "On-call — go-live day 0" covering 00:00–23:59 the next day

**Done when:** all alerts are wired, smoke test is green, founder is briefed and on-call.

---

## Day 0: Enable Production Traffic

Goal: open the platform to real use while closely monitoring for anomalies.

**Actions (morning, 08:00–09:00):**

- [ ] Confirm no overnight alerts fired; if any did, investigate and resolve before proceeding
- [ ] Send a go-live confirmation email to the three pilot dealers
- [ ] Tail Axiom logs for the first 30 minutes of active use: watch for `error` level entries
- [ ] Keep the Sentry issues dashboard open in a browser tab throughout the day
- [ ] Keep the `/admin/operations` dashboard open: watch active campaigns, call volume, CLI pool health

**During the first 4 hours (08:00–12:00):**

- [ ] Monitor every incoming call in the Axiom log stream for anomalies (unexpected errors, high latency)
- [ ] Verify that at least one real campaign is launched by a pilot dealer and completes without intervention
- [ ] Confirm that credit is deducted correctly and the balance updates on the dealer's `/billing` page
- [ ] Confirm that at least one post-call email (appointment, qualified-lead, or daily report) is delivered
- [ ] Check the CLI pool health: no CLI should enter cooling-down within the first hour of normal use
- [ ] If any CRITICAL alert fires: follow the relevant runbook; do not dismiss without investigation

**End of day (18:00):**

- [ ] Review Axiom log summary: total calls, error rate, p95 call duration
- [ ] Review Sentry for any new issues opened during day 0; triage each one
- [ ] Note any issues in the pilot feedback log
- [ ] Remain reachable (phone on) until 22:00; CRITICAL alerts page 24/7 regardless

**Done when:** day 0 has passed without an unresolved CRITICAL incident and at least one pilot dealer has run a real campaign end-to-end.

---

## Day +1: First Pilot Review

Goal: gather early feedback while issues are fresh.

**Actions:**

- [ ] Send a short feedback form (or email) to each pilot dealer asking:
  - Did any call fail or behave unexpectedly?
  - Was the dashboard intuitive?
  - Were transcripts and outcomes accurate?
  - Any friction in the billing or credit flow?
- [ ] Review the call quality monitoring page (`/admin/quality`): check 1% sample reviews from yesterday
- [ ] Review the founder operations dashboard (`/admin/operations`): compare day 0 metrics with expectations
- [ ] File GitHub issues for any confirmed bugs; label critical ones `launch-blocker`
- [ ] Deploy a hotfix if any P0 bug was identified on day 0; re-run smoke test after deploy
- [ ] Confirm backup cron ran overnight successfully
- [ ] Confirm uptime monitor is still green

---

## Day +3: Stability Check

Goal: confirm the platform is stable under light real-world load.

**Actions:**

- [ ] Review 3-day Axiom aggregate: total calls, error rate trend, CLI pool utilisation
- [ ] Review Sentry for any recurring issues; close resolved ones
- [ ] Check webhook delivery health: no more than 1% of webhooks in failed state
- [ ] Review GDPR requests (if any): confirm intake and acknowledgement per `docs/runbooks/gdpr-erasure.md`
- [ ] Call or message each pilot dealer for a verbal status check
- [ ] If any pilot dealer has stopped using the platform: investigate and resolve the blocker
- [ ] Decide whether to extend credit complimentary packages for another week (if onboarding friction was high)
- [ ] Update pilot feedback log with findings

---

## Day +7: One-Week Review

Goal: produce a concise summary of the pilot week and decide on the next steps.

**Actions:**

- [ ] Pull the 7-day metrics from Axiom and the founder operations dashboard:
  - Total campaigns launched
  - Total calls placed / completed / failed
  - Average call duration
  - Credit consumed per org
  - CLI pool average utilisation
  - Error rate (calls, webhooks, emails)
- [ ] Review call quality samples: any systematic disclosure failures or outcome misclassifications?
- [ ] Review all Sentry issues opened in the week; ensure every P0 and P1 is resolved or has a clear owner and ETA
- [ ] Review pilot dealer feedback (form responses and verbal notes)
- [ ] Rotate any credentials that will expire within 30 days (per `docs/runbooks/credential-rotation.md`)
- [ ] Confirm the weekly SBC smoke-test cron ran and passed
- [ ] Confirm the daily AI Act disclosure snapshot cron has been green all week
- [ ] Update `docs/runbooks/disaster-recovery.md` with next DR drill date if not already set

**Decision gate:** based on the metrics and feedback, choose one of:

- A. **Proceed to broader launch** — invite additional dealers, increase marketing traffic
- B. **Extend pilot** — keep the three pilot dealers, address blockers, re-review in one week
- C. **Pause** — a critical unresolved issue prevents safe scaling; freeze new sign-ups until resolved

Document the decision and rationale in the pilot feedback log.

---

## Day +14: Pilot Close-Out and Broader Launch Decision

Goal: formally close the pilot phase and decide on public launch.

**Actions:**

- [ ] Conduct a 30-minute retrospective call with each pilot dealer (optionally together)
  - What worked well?
  - What was frustrating?
  - Would they recommend the platform to a colleague?
  - Any feature requests for the first post-launch iteration?
- [ ] Compile the 14-day aggregate metrics report (same dimensions as day +7 but with trend lines)
- [ ] Review any outstanding GitHub issues; close, defer, or escalate each one
- [ ] Update the launch-checklist with outcomes from the pilot (note any items that were insufficiently tested)
- [ ] If proceeding to broader launch:
  - Remove any artificial rate limits or invite gates that were protecting the pilot
  - Announce via the usual marketing channels
  - Increase Vercel tier if needed for anticipated traffic
  - Schedule next DR drill (within 90 days)
- [ ] If pausing or extending: document in the pilot feedback log and notify the waiting-list dealers of the delay

**Done when:** a clear go/no-go decision for broader public launch is documented and communicated.

---

## Escalation Contacts

| Role | Contact | Hours |
|------|---------|-------|
| Founder / Platform Owner | See 1Password → Emergency Contacts | 24/7 for CRITICAL |
| Voice Provider (Vapi) | https://vapi.ai/support | Business hours; status at status.vapi.ai |
| Voice Provider (Retell) | https://retell.ai/support | Business hours |
| SBC Provider | See 1Password → SBC Provider | See contract SLA |
| Supabase | https://supabase.com/dashboard/support | Enterprise plan; 24/7 SLA |
| Stripe | https://dashboard.stripe.com/support | Business hours; status at status.stripe.com |
| Resend | https://resend.com/help | Business hours; status at resend.statuspage.io |

---

## Related Runbooks

- `docs/runbooks/launch-checklist.md` — prerequisite sign-off checklist
- `docs/runbooks/alerting.md` — alert tiers and escalation policy
- `docs/runbooks/voice-provider-incident.md` — Vapi/Retell/SBC incidents
- `docs/runbooks/credential-rotation.md` — key rotation schedule
- `docs/runbooks/disaster-recovery.md` — backup restore and DR drill
- `docs/runbooks/gdpr-erasure.md` — handling data erasure requests
- `docs/runbooks/webhook-replay.md` — webhook delivery failures
- `docs/runbooks/credit-adjustment.md` — manual credit operations
- `docs/runbooks/feature-flags.md` — flag-flip procedure

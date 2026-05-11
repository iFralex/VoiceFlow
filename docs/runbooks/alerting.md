# Alerting Tiers and Escalation

## Overview

Three alerting tiers govern how incidents are communicated. Misconfigured or overly noisy alerts cause alert fatigue; too few alerts delay incident response. This runbook defines exactly what triggers each tier, who is notified, via which channel, and at what hours.

---

## Tier Definitions

### CRITICAL — Page founder via SMS / PagerDuty (24/7)

These conditions indicate either revenue loss, data loss risk, or a complete service outage. They demand an immediate human response at any hour.

Trigger conditions:

- System outage: Vercel deployment returning 5xx on `/api/ready` for 2 consecutive checks (10 min)
- Payment processor outage: Stripe API returning non-2xx for >5 min
- RPO intermediary fully unavailable: `/api/cron/rpo-check` returning failure for all enrolled orgs for >15 min
- Voice provider 5xx rate: Vapi or Retell returning 5xx on >5% of outbound call initiations over a 5-min window
- Database connection failures: `withOrgContext` or `withSystemContext` throwing connection errors for >60 s
- Security incidents: any Sentry event with tag `security=true` or matching patterns (SQL injection attempt, auth bypass, excessive failed logins from a single IP within 5 min)

Notification channels:
- PagerDuty (integrates with founder's phone via SMS + push)
- Sentry "Issue Alert" rule: condition "Sentry detects a new issue" with filter `level = fatal` or tag `tier = critical`

Response SLA: acknowledge within 15 min, status update every 30 min until resolved.

---

### HIGH — Email + Slack channel #alerts-high (08:00–22:00 Europe/Rome)

These conditions indicate degraded service or compliance risk. They need attention within the business day but do not warrant waking anyone.

Trigger conditions:

- Elevated voice-provider error rate: Vapi/Retell returning 5xx on 1–5% of call initiations over a 1-h rolling window
- AI Act disclosure failure rate: `compliance.aiact_disclosure_failures` / `compliance.aiact_disclosure_attempts` > 2% over any 1-h window (Axiom monitor)
- CLI pool saturation: >50% of pool entries in `cooling_down` or `retired` state (Axiom monitor on `cli_pool_health` log field)
- Webhook deactivation spike: >5 webhook subscriptions deactivated within any 24-h window (Axiom monitor on `webhook.deactivated` log events)
- Credit package purchase failures: Stripe `payment_intent.payment_failed` rate > 10% of attempts in 1 h
- Low-balance cascade: >3 orgs triggering low-balance alert within 1 h (may indicate a billing bug)

Notification channels:
- Email to `founder@company.com` via automated Sentry/Axiom alert
- Slack webhook to `#alerts-high` channel

Response SLA: acknowledge within 2 h, resolve or escalate within 8 h.

---

### INFO — Slack channel #alerts-info only (no on-call, no email)

These conditions are expected occasionally and require no immediate action, but provide visibility into the system.

Trigger conditions:

- Individual call failure: single call ending with status `failed` or `no_answer` (log-level `warn`, not an alert)
- Individual webhook retry: a single delivery retry (Sentry breadcrumb or Axiom log)
- Low-balance event for a single org: credit balance crossing the threshold for one org
- CLI entering cooling-down state: single CLI number flagged by watchdog
- Script template published: a new version of a seed template deployed

Notification channels:
- Slack webhook to `#alerts-info` channel (auto-post from Axiom monitor on relevant log events)

Response SLA: no SLA; reviewed during normal working hours.

---

## Sentry Alert Rules

Configure these in the Sentry project settings under "Alerts > Issue Alerts".

### Rule: CRITICAL — Fatal errors

- Condition: "A new issue is created"
- Filter: `level = fatal`
- Action: Notify via PagerDuty integration + email to founder
- Environment: production

### Rule: CRITICAL — Security tag

- Condition: "A new issue is created"
- Filter: tag `security = true`
- Action: Notify via PagerDuty integration + email to founder
- Environment: production

### Rule: HIGH — Error spike

- Condition: "The issue is seen more than 10 times in 1 hour"
- Filter: `level = error`
- Action: Send email + Slack webhook
- Environment: production

### Rule: HIGH — New regression

- Condition: "A new issue is created" AND the issue was previously resolved
- Filter: none
- Action: Send email + Slack webhook
- Environment: production

To create these rules:
1. Open Sentry → Settings → Alerts → Create Alert Rule
2. Set project to the production Next.js project
3. Configure conditions/filters/actions as above
4. Save and verify via "Send Test Notification"

---

## Axiom Monitor Thresholds

Configure these in the Axiom workspace under "Monitors".

### Monitor: disclosure-failure-rate

- Dataset: `voiceauto-production`
- APL query:
  ```
  ['voiceauto-production']
  | where level == "warn" or level == "error"
  | where message contains "aiact_disclosure"
  | summarize failures=countif(message contains "failure"), attempts=countif(true()) by bin(_time, 1h)
  | extend rate = failures / attempts
  | where rate > 0.02
  ```
- Threshold: any row returned triggers HIGH alert
- Notify: email + Slack `#alerts-high`

### Monitor: cli-pool-saturation

- Dataset: `voiceauto-production`
- APL query:
  ```
  ['voiceauto-production']
  | where message contains "cli_pool_health"
  | summarize cooling=sumif(cooling_count, true()), total=sumif(total_count, true()) by bin(_time, 15m)
  | extend ratio = todouble(cooling) / todouble(total)
  | where ratio > 0.5
  ```
- Threshold: any row triggers HIGH alert
- Notify: email + Slack `#alerts-high`

### Monitor: webhook-deactivation-spike

- Dataset: `voiceauto-production`
- APL query:
  ```
  ['voiceauto-production']
  | where message == "webhook.deactivated"
  | summarize count() by bin(_time, 24h)
  | where count_ > 5
  ```
- Threshold: any row triggers HIGH alert
- Notify: email + Slack `#alerts-high`

### Monitor: voice-provider-error-rate

- Dataset: `voiceauto-production`
- APL query:
  ```
  ['voiceauto-production']
  | where message contains "vapi" or message contains "retell"
  | summarize errors=countif(level == "error"), total=count() by bin(_time, 1h)
  | extend rate = todouble(errors) / todouble(total)
  | where rate > 0.01
  ```
- Thresholds:
  - `rate > 0.05` → CRITICAL alert
  - `rate > 0.01` → HIGH alert
- Notify: PagerDuty for CRITICAL, email + Slack for HIGH

---

## Escalation Paths

### CRITICAL escalation

1. PagerDuty pages founder immediately
2. Founder acknowledges within 15 min
3. If not acknowledged in 15 min, backup contact (co-founder or designated on-call) is paged
4. First status update to `#incidents` Slack channel within 30 min
5. Ongoing updates every 30 min
6. Post-incident review within 48 h (blameless format; see `voice-provider-incident.md` template)

### HIGH escalation

1. Automated email + Slack message delivered during business hours
2. If unacknowledged (no Slack reaction) after 4 h, escalates to founder via SMS
3. Resolve or downgrade to INFO within 8 h of first alert

---

## Quiet Hours

| Tier | Active hours | Out-of-hours behaviour |
|------|-------------|------------------------|
| CRITICAL | 24/7 | Always pages |
| HIGH | 08:00–22:00 Europe/Rome | Suppressed; delivered at 08:00 next day |
| INFO | Business hours only | Never pages |

PagerDuty "Schedules" must encode these hours so HIGH alerts queued outside the window are delivered at 08:00 rather than dropped.

---

## Testing Alerts

Verify each alert is correctly wired before relying on it:

1. **Sentry CRITICAL**: call `Sentry.captureException(new Error("test-fatal"), { level: "fatal" })` from a production deploy; confirm PagerDuty page and email arrive within 5 min.
2. **Sentry HIGH**: trigger the same error >10 times in production; confirm Slack post.
3. **Axiom monitors**: inject a synthetic log batch with disclosure failure fields; confirm monitor fires within the poll interval (typically 5 min on Axiom free tier).
4. **Uptime monitor**: temporarily break `/api/ready` by removing a required env var on staging; confirm CRITICAL alert fires within 10 min.

Document the last test date in this file after each drill:

| Alert | Last tested | Outcome |
|-------|------------|---------|
| Sentry CRITICAL fatal | — | — |
| Sentry HIGH spike | — | — |
| Axiom disclosure-failure-rate | — | — |
| Axiom cli-pool-saturation | — | — |
| Axiom webhook-deactivation-spike | — | — |
| Axiom voice-provider-error-rate | — | — |

---

## Related Runbooks

- `voice-provider-incident.md` — responding to Vapi/Retell outage
- `credential-rotation.md` — rotating PagerDuty and Sentry tokens
- `go-live.md` — pre-launch alert verification steps

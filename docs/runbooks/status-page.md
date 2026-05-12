# Runbook: Customer-Facing Status Page

## Overview

VoiceFlow exposes a public status page so customers can monitor service health without
contacting support. The page tracks the following components:

| Component | What it represents |
|-----------|-------------------|
| Web app (Vercel) | Dashboard and API availability |
| API | REST and webhook endpoints |
| Database (Supabase) | Postgres read/write |
| Voice service (Vapi / Retell) | Outbound call processing |
| Telephony (SBC) | PSTN trunk and CLI pool |
| Email (Resend) | Transactional email delivery |
| Compliance (RPO) | RPO intermediary integration |

## Recommended provider: Better Stack

Better Stack (betterstack.com) provides a free tier sufficient for MVP with uptime
monitors, incident management, and a hosted status page.

### Initial setup (manual — founder action)

1. Sign up at betterstack.com → create a team for "VoiceFlow".
2. **Monitors** → create one monitor per component using the table below.
3. **Status pages** → create a new status page; add all monitors as components;
   set the public URL (e.g. `https://status.voiceflow.it` via a CNAME to Better Stack).
4. Copy the public status page URL.
5. Set `NEXT_PUBLIC_STATUS_PAGE_URL=<url>` in Vercel production and staging env vars.
6. Re-deploy the app — the "System Status" link will appear in the marketing footer
   and in the in-app help menu automatically.

### Monitor configuration

| Monitor | URL / check | Method | Alert threshold |
|---------|-------------|--------|-----------------|
| Web app | `$NEXT_PUBLIC_APP_URL/api/health` | HTTP GET 200 | 2 consecutive failures |
| API ready | `$NEXT_PUBLIC_APP_URL/api/ready` | HTTP GET 200 | 2 consecutive failures |
| Voice (Vapi) | `https://api.vapi.ai` (TCP or HTTP) | TCP 443 | 2 consecutive failures |
| SBC | SBC trunk IP:5060 | TCP | 2 consecutive failures |
| Email (Resend) | `https://api.resend.com` | TCP 443 | 2 consecutive failures |
| Supabase | `$SUPABASE_URL` (TCP 443) | TCP | 2 consecutive failures |

Check interval: **5 minutes** from at least one EU region.

All monitors should alert via the CRITICAL channel (email + SMS) defined in
`docs/runbooks/alerting.md`.

## Uptime check wiring

Better Stack monitors can be linked directly to status page components. When a
monitor reports a failure, the corresponding component automatically turns red and
an incident is opened. This requires no code change — it is configured in the
Better Stack dashboard.

## Posting a manual incident

Use this when an issue is detected before automated monitors catch it:

1. Log in to betterstack.com → Status pages → VoiceFlow.
2. Click **Create incident**.
3. Set: Title (short), Affected components, Status (`Investigating` / `Identified` /
   `Monitoring` / `Resolved`).
4. Write a brief update message (visible to customers).
5. Click **Publish**.
6. Update the incident as the situation evolves.
7. Mark **Resolved** once service is restored; write a short resolution note.

### Incident message templates

**Investigating:**
> We are aware of an issue affecting [component] and are currently investigating.
> Updates will be posted every 30 minutes.

**Identified:**
> The root cause has been identified: [brief description]. We are working on a fix.

**Resolved:**
> [Component] has been restored. The issue was caused by [brief cause]. No customer
> data was affected. We apologize for the inconvenience.

## Quiet-hours policy

Automated status page incidents follow the alerting tiers in `docs/runbooks/alerting.md`:

- CRITICAL alerts page the founder 24/7.
- HIGH alerts send email between 08:00–22:00 Europe/Rome only.
- The status page itself is always publicly visible regardless of quiet hours.

## Escalation

If Better Stack is itself unavailable and the status page cannot be updated:

1. Post a brief note to customers via the support email address.
2. Update the VoiceFlow website home page `<meta>` description temporarily if the
   outage is severe (revert immediately on resolution).

## Quarterly review

Each quarter, verify:

- [ ] All monitors are green and firing correctly (inject a test failure).
- [ ] Status page URL is still reachable and branded correctly.
- [ ] `NEXT_PUBLIC_STATUS_PAGE_URL` is set in both staging and production Vercel env.
- [ ] Footer and user-menu links resolve to the correct URL.

# Runbook — Voice Provider Incident

**Owner:** Founder / on-call engineer
**Audience:** Founder, on-call engineer
**Trigger:** Vapi or Retell outage, SBC trunk degradation, elevated voice error rate alert

---

## 1. Detection

### 1a. Alert-driven detection

| Alert tier | Condition | Channel |
|---|---|---|
| CRITICAL | Vapi/Retell 5xx rate >5% of outbound call initiations over a 5-min window | PagerDuty SMS + push |
| HIGH | Vapi/Retell 5xx rate 1–5% over 1-h rolling window | Email + Slack #alerts-high |
| HIGH | SBC connectivity error (registration failure or ICE timeout) >3 in 15 min | Sentry issue alert |

See `docs/runbooks/alerting.md` for full tier definitions and acknowledgement SLAs.

### 1b. Dashboard observation

If you notice calls failing without an alert, check:

1. **Sentry** — filter by tag `service=voice` or `provider=vapi` / `provider=retell`; look for `VapiError`, `RetellError`, or `SbcError` issue groups.
2. **Axiom** — run the following APL query:
   ```apl
   ['voiceflow']
   | where service == "voice" and level == "error"
   | summarize count() by bin(_time, 5m), provider
   | order by _time desc
   ```
3. **Campaign dashboard** — an unusual spike in calls with `status = failed` visible in the campaign detail page signals a provider issue.
4. **Provider status pages** (bookmark these):
   - Vapi: https://status.vapi.ai
   - Retell: https://status.retell.ai
   - Twilio: https://status.twilio.com
   - Voiped Telecom SBC: contact details in 1Password vault `voiceflow-prod`, entry "Voiped SBC"

---

## 2. Immediate triage (first 10 minutes)

1. **Open the provider status page** for the affected provider. Check whether a known incident or maintenance window is in progress. If yes, note the estimated resolution time (ERT) and skip to §3.

2. **Check error rate trend in Axiom.** Run:
   ```apl
   ['voiceflow']
   | where service == "voice"
   | summarize
       total = count(),
       errors = countif(level == "error")
     by bin(_time, 5m), provider
   | extend error_pct = errors * 100.0 / total
   | order by _time desc
   ```
   If error rate is climbing and the provider reports no incident, open a support ticket with the provider immediately.

3. **Verify it is not an SBC trunk issue.** Run `pnpm exec tsx scripts/test-sbc-trunk.ts` (or check the latest SBC smoke-test result at `/api/cron/sbc-smoke-test`). An SBC failure is distinct from a Vapi/Retell failure — see §3b.

4. **Check in-flight campaigns.** Navigate to `/admin/operations` and note which campaigns are currently active. Calls being dispatched right now may need to be paused before the mitigation step — see §3.

5. **Determine severity:**
   - Error rate >5% → CRITICAL; proceed to §3 immediately.
   - Error rate 1–5% → HIGH; confirm root cause before switching provider to avoid unnecessary disruption.
   - Isolated errors (<1%) → may be transient; monitor for 10 min before acting.

---

## 3. Mitigation

### 3a. Vapi outage — switch to Retell

If Vapi is confirmed down and the outage is expected to last >15 minutes:

1. Follow `docs/runbooks/retell-sbc-switchover.md` in full, starting with the pre-flight checks.

2. Summary of the switch (do NOT skip the full runbook steps):
   - Confirm `RETELL_API_KEY` and `RETELL_AGENT_ID` are set in the production secret store (Vercel → project settings → environment variables).
   - Set `VOICE_PROVIDER=retell` in Vercel production environment variables.
   - Trigger a Vercel deployment (or redeploy the latest commit) to propagate the variable.
   - Wait for the deployment to complete (~2 min).
   - Run the smoke test: `pnpm exec tsx scripts/test-sbc-trunk.ts`
   - Confirm a test call completes end-to-end.

3. In-flight Vapi calls are unaffected — Vapi webhooks for those calls still route correctly. Do not interrupt them.

4. Log the switchover time and reason in the incident notes (use a shared doc, Notion, or Slack thread in #alerts-high).

### 3b. SBC trunk down — flip to Twilio fallback

If the Voiped Telecom SBC is unreachable (ICE failures, SIP registration errors, no audio path), and Vapi/Retell themselves are healthy:

1. In Vapi dashboard: navigate to the phone numbers section and check the SIP trunk status for `voiped-italy-primary`. If the trunk shows errors, switch outbound routing to the Twilio secondary trunk.
   - In Vapi, edit each phone number resource: change the SIP trunk from `voiped-italy-primary` to `twilio-secondary`.
   - In Retell (if active), the Twilio trunk is registered as a native provider type — no custom SIP trunk re-registration needed.

2. Contact Voiped Telecom support (contact info in 1Password vault `voiceflow-prod`, entry "Voiped SBC") and open a priority ticket. Note the exact error messages from the Sentry/Axiom logs.

3. Once SBC is restored, reverse: switch phone numbers back to `voiped-italy-primary`, run the smoke test, confirm call quality.

### 3c. Retell outage (when Retell is active)

If Retell is the active provider (`VOICE_PROVIDER=retell`) and goes down, switch back to Vapi:

1. Confirm Vapi is healthy (check https://status.vapi.ai).
2. Set `VOICE_PROVIDER=vapi` in Vercel production environment variables.
3. Trigger a Vercel redeployment.
4. Verify `phone_numbers.provider_external_id` values still match the Vapi `phoneNumberId` values (check with a direct DB query or the CLI pool admin page). If the IDs were overwritten during a prior Retell switch, restore them from the last backup or Vapi dashboard.
5. Run the smoke test.

---

## 4. Communication

### 4a. Status email template — active-campaign customers

Send to the org owner of each org with an active campaign. Replace bracketed placeholders.

**Subject:** [VoiceFlow] Interruzione temporanea del servizio voce / Temporary voice service interruption

---

Gentile [Nome],

Ti informiamo che stiamo riscontrando un'interruzione temporanea del servizio di chiamate vocali a partire dalle **[ORA INIZIO INCIDENTE] CET** del **[DATA]**.

**Impatto:** Le campagne attive sono state messe in pausa automaticamente. Nessuna chiamata è stata persa — verranno riprese non appena il servizio sarà ripristinato.

**Causa:** [Breve descrizione, es. "Disservizio del provider voce Vapi, per cui abbiamo attivato il provider di riserva."]

**Stato attuale:** Il servizio è [in ripristino / ripristinato alle ORA].

Ti aggiorneremo entro **[DATA/ORA PROSSIMO AGGIORNAMENTO]** o non appena la situazione sarà risolta.

Ci scusiamo per il disagio.

Cordiali saluti,  
[NOME]  
VoiceFlow

---

Dear [Name],

We are experiencing a temporary interruption to the voice call service starting at **[INCIDENT START TIME] CET** on **[DATE]**.

**Impact:** Active campaigns have been automatically paused. No calls have been lost — they will resume as soon as the service is restored.

**Root cause:** [Brief description, e.g. "Outage from voice provider Vapi; we have activated the fallback provider."]

**Current status:** The service is [being restored / restored at TIME].

We will update you by **[NEXT UPDATE DATE/TIME]** or sooner once the issue is resolved.

We apologize for the inconvenience.

Kind regards,  
[NAME]  
VoiceFlow

---

### 4b. In-app banner template

If the incident lasts more than 30 minutes, add an in-app banner via the `system_flags` table. Set the flag `voice.incident_banner` to the following JSON value (adjust text as needed):

```json
{
  "active": true,
  "severity": "warning",
  "title_it": "Interruzione servizio voce in corso",
  "title_en": "Voice service interruption in progress",
  "body_it": "Stiamo lavorando per ripristinare il servizio. Le campagne attive sono in pausa e riprenderanno automaticamente.",
  "body_en": "We are working to restore the service. Active campaigns are paused and will resume automatically.",
  "started_at": "2026-05-11T14:30:00Z"
}
```

To set the flag from the database console or via the admin API:

```sql
INSERT INTO system_flags (key, value, updated_at)
VALUES ('voice.incident_banner', $1, NOW())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
```

Remove the banner once the service is fully restored by setting `active: false` or deleting the row.

---

## 5. Post-incident blameless review template

Complete within **48 hours** of incident resolution. Store the filled document in `docs/incidents/YYYY-MM-DD-voice-provider.md`.

```markdown
# Incident Review — Voice Provider Incident

**Date:** YYYY-MM-DD
**Duration:** HH:MM (start HH:MM CET → end HH:MM CET)
**Severity:** CRITICAL / HIGH
**Affected provider:** Vapi / Retell / SBC
**Author:** [name]
**Reviewers:** [names]

## Summary

One paragraph describing what happened and the customer impact.

## Timeline

| Time (CET) | Event |
|---|---|
| HH:MM | First alert fired |
| HH:MM | On-call acknowledged |
| HH:MM | Root cause identified |
| HH:MM | Mitigation applied (provider switched / trunk failover) |
| HH:MM | Service restored |
| HH:MM | Campaigns resumed |
| HH:MM | Incident closed |

## Root cause

Detailed technical explanation. Was it provider-side or platform-side?

## What went well

- Alert fired within the expected SLA
- Switchover runbook was accurate and easy to follow
- (add more)

## What could be improved

- (list specific gaps: detection lag, runbook gaps, missing automation, etc.)

## Action items

| Item | Owner | Due |
|---|---|---|
| [Specific improvement] | [name] | YYYY-MM-DD |
| Update smoke-test to catch this failure mode earlier | [name] | YYYY-MM-DD |

## Impact summary

- Orgs affected: N
- Active campaigns paused: N
- Calls not placed during incident: N (estimated)
- Revenue impact: €X (estimated from credit/min rate × calls not placed)
```

---

## 6. Related runbooks

- `docs/runbooks/retell-sbc-switchover.md` — step-by-step Vapi → Retell switchover procedure
- `docs/runbooks/alerting.md` — alert tier definitions, escalation paths, quiet hours
- `docs/runbooks/disaster-recovery.md` — if the incident results in data loss or corruption
- `docs/runbooks/credential-rotation.md` — if rotating provider API keys as a precaution after a security incident

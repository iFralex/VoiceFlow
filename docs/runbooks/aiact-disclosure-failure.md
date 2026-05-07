# Runbook: AI Act Disclosure Failure

**Owner:** Founding engineer
**Audience:** Founder / on-call compliance lead
**Trigger:** A call ends with `metadata.disclosure_verified = false` and a
`quality/disclosure-missing` Inngest event is emitted.

## Purpose

Italian deployment of EU AI Act art. 50 (spec §12.3) requires every outbound
call to disclose its AI nature before any substantive conversation. We enforce
this with three independent layers:

1. **Layer 1 — Preamble**: every assembled system prompt begins with the
   canonical Italian preamble in `src/lib/voice/prompt/preamble.ts`.
2. **Layer 2 — First message**: the static opening line of every script
   template contains the phrase "assistente vocale automatico".
3. **Layer 3 — Transcript verification**: `checkDisclosure()` scans the first
   30 seconds of the transcript for the same phrase and writes the result to
   `calls.metadata.disclosure_verified`. When it returns `false`, the
   `quality/disclosure-missing` event fires.

A failure means at least one layer has been bypassed at runtime. The model may
have hallucinated a different opener, the recording may be truncated, or the
transcript may have garbled the disclosure. Each failure must be triaged
within 24 hours so we can refund the dealer and document the incident before
a regulator could plausibly request the file (typical AGCOM ispection windows
are weeks, not days, but we treat any disclosure miss as urgent).

## What triggers the event

The event is emitted by `src/lib/inngest/voice/classify.ts` when:

- The post-call classifier downloaded the transcript JSON from storage,
- `checkDisclosure(segments)` returned `false`,
- `calls.metadata.disclosure_verified` was set to `false`.

Event payload (`QualityDisclosureMissingData`):

```json
{ "callId": "<uuid>", "orgId": "<uuid>" }
```

The full call (recording, transcript, contact, campaign) can be looked up by
`callId`. The recording lives at `recordings/<org_id>/<call_id>.mp3` in the
`call-media` bucket; the transcript at `transcripts/<org_id>/<call_id>.json`.

## Triage dashboard

Open `/admin/disclosure-failures?token=$INTERNAL_ADMIN_TOKEN`.

The page lists every call with `metadata.disclosure_verified = false`,
newest first. Each row shows:

- Call ID and timestamp
- Org ID and campaign ID
- Inline `<audio>` player streaming the signed recording URL (1-hour TTL)
- A link to the JSON transcript (signed URL, same TTL)
- Current triage status (`pending` / `reviewed` / `refunded` / `escalated`)
- Inline form to update the status with a free-text note

The default filter is `pending`. Use `?status=all` to include already-triaged
rows.

## Triage procedure

For each `pending` row:

1. **Listen to the first 30 seconds** of the recording.
   - If the disclosure phrase is clearly spoken: this is a transcript
     mishearing (Whisper miss, low SNR). Mark the row `reviewed` with a note
     pointing at the suspected cause; no refund.
   - If the disclosure phrase is **absent or paraphrased**: confirmed failure.
     Continue.

2. **Read the transcript JSON** to confirm the timing. If the agent reached a
   substantive turn (asked a qualifying question, referenced the dealer's
   product, etc.) before disclosing, this is a regulatory miss.

3. **Refund the call to the dealer.**
   ```bash
   curl -s -X POST https://app.voxauto.it/api/admin/credit-adjustment \
     -H "Content-Type: application/json" \
     -H "x-admin-token: $INTERNAL_ADMIN_TOKEN" \
     -d '{
       "orgId": "<org_id>",
       "deltaCents": <call_cost_cents>,
       "reason": "AI Act disclosure failure — call <call_id> refunded per runbook"
     }'
   ```
   Look up `cost_cents` on the row directly: it is shown in the dashboard.

4. **Mark the row `refunded`** in the dashboard with the credit-adjustment
   ledger ID in the note.

5. **Log the incident** in the compliance journal at
   `docs/compliance-journal.md` (private, not committed). One line per failure
   with date, call ID, root-cause hypothesis, action taken.

## Pattern detection — when to retrain

Two or more failures from the **same script template** within a 7-day window
indicates a prompt-level problem, not a one-off model lapse. Steps:

1. Pull the assembled system prompt for both calls (use the AI Act audit
   helper `runAiActConformanceAudit({ windowStart, windowEnd })` or rebuild
   manually via `assembleSystemPrompt({ templateBody, variables })`).
2. Verify Layer 1 (preamble) and Layer 2 (first-message file under
   `src/lib/voice/templates/prompts/`) are intact.
3. If both are intact, the model is bypassing the disclosure mid-turn —
   reinforce the constraint by adding an explicit guardrail line to the
   template:
   ```
   PRIMA di qualsiasi domanda sostanziale DEVI pronunciare la frase
   "assistente vocale automatico". Non riformulare, non parafrasare.
   ```
4. Bump the template version with `pnpm db:seed --bump <slug>` so existing
   scripts are not silently overwritten and audit-trail continuity is
   preserved.
5. Mark the original failure rows `escalated` with a pointer to the new
   template version.

## Regulatory escalation

Three or more confirmed disclosure failures within a calendar month, **or**
any single failure where the dealer has signalled intent to involve their
counsel, requires founder + legal counsel involvement.

1. Freeze the affected campaign(s):
   ```sql
   UPDATE campaigns SET status = 'paused'
   WHERE id IN (<campaign_ids>);
   ```
2. Export the relevant calls (recording + transcript + audit log) as evidence.
   The GDPR export helper (`src/lib/compliance/gdpr/export.ts`, plan 11
   task 9) builds a ZIP with all artifacts; pass the contact identifier of
   the affected number.
3. Notify the dealer in writing within 48 hours — the dealer is the data
   controller (DPA art. 4) and any regulator inquiry will land on them first.
4. Prepare the standard AGCOM disclosure: timeline, root cause, corrective
   action, evidence of remediation. Template lives in `docs/legal/agcom/`
   (private repo).
5. After resolution, mark every escalated row `resolved` in the dashboard.

## Audit trail

Every triage state transition writes to `audit_log` with
`action = 'compliance.disclosure_triaged'`, `subject_type = 'call'`,
`subject_id = <call_id>`. To reconstruct the full history of a single failure:

```sql
SELECT created_at, actor_type, action, metadata
FROM audit_log
WHERE subject_type = 'call' AND subject_id = '<call_id>'
ORDER BY created_at;
```

The audit log retains entries for 7 years (spec §12.4) — the same window
covered by the AGCOM statute of limitations.

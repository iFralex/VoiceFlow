# Runbook: Retell Switchover for the Italian SBC Trunk

**Owner:** Founding engineer
**Audience:** Founder / on-call engineer
**Trigger:** Vapi outage or commercial change that forces moving outbound voice traffic to Retell

## Purpose

The platform's primary voice orchestrator is Vapi (see `docs/plans/08-voice-adapter-vapi.md`). The Retell adapter at `src/lib/voice/retell/adapter.ts` is held as a stub fallback so that a switchover can be completed in hours rather than days. This runbook documents the equivalent setup steps in Retell that mirror Task 2 of `docs/plans/10-telephony-cli-pool.md`, which configures the Italian SBC trunk and DIDs in Vapi.

The core CLI pool (`phone_numbers` table) and the rotation algorithm are provider-agnostic. Only the orchestrator-side configuration changes — the same E.164 DIDs that are registered in Vapi must be re-registered in Retell, and `phone_numbers.provider_external_id` must be updated to the new Retell-side identifiers.

## When to switch

- Vapi production outage exceeding the dispatcher's Twilio fallback recovery window (≥30 minutes of consecutive failures, see Task 13).
- Commercial change (Vapi pricing or terms) that makes Retell preferable for sustained operation.
- Validation only: rehearse the switch quarterly so the runbook stays current.

The dispatcher Twilio fallback (Task 13) handles short SBC trunk degradations within Vapi itself. This runbook is for the rarer case where Vapi as a whole is the failure domain.

## Pre-flight checks

1. Confirm Retell account is provisioned and `RETELL_API_KEY` is in the production secret store.
2. Confirm the Retell agent ID (`RETELL_AGENT_ID`) referenced by `src/lib/voice/retell/adapter.ts` exists in the Retell dashboard. The agent's LLM prompt must reference the `retell_llm_dynamic_variables` (`system_prompt`, `first_message`, `voice_id`) — without that the per-call overrides in the adapter are silently dropped.
3. Confirm the SBC carrier (Voiped Telecom) credentials in 1Password are still current (quarterly rotation policy — see ADR 0002).

## Equivalent setup steps (mirror of Task 2)

The following maps Task 2's Vapi-specific steps to Retell. Each step replaces, not augments, the Vapi configuration during a switchover.

### 1. Register the SBC SIP trunk in Retell

In Retell's dashboard, create a SIP trunk entry pointing at the Voiped Telecom SBC:

- **Name**: `voiped-italy-primary`
- **SIP server URI**: from 1Password vault `voiceflow-prod`, entry "Voiped SBC"
- **Username / password**: from the same 1Password entry
- **Allowed origin IPs**: whitelist Retell's outbound SIP origins (published in Retell docs; check the IP list every quarter — Retell's egress IPs may change)
- **Codec preferences**: G.711 µ-law primary, G.722 secondary (matches the Vapi configuration)

Repeat the procedure for the Twilio secondary trunk (Retell supports Twilio as a native provider type; you do not need to register Twilio as a custom SIP trunk — point Retell at the Twilio account SID + auth token instead).

### 2. Import each DID as a Retell phone number resource

For every DID currently in the `phone_numbers` table (E.164 form), call Retell's **Register Phone Number** API or use the dashboard:

- Provider: `voiped-italy-primary` (SBC trunk created in step 1) or `twilio` (for the Twilio failover DIDs).
- Inbound agent: the inbound IVR agent created in step 4 below.
- Capture the Retell-side `phone_number_id` returned by the API — this is the value `CreateCallParams.fromNumber` must carry through to Retell.

Update each `phone_numbers` row in production to set `provider_external_id` to the new Retell `phone_number_id`. Use a one-shot script or run direct SQL inside `withSystemContext`:

```sql
UPDATE phone_numbers SET provider_external_id = $1 WHERE e164 = $2;
```

### 3. Inbound routing for every DID

Every DID's inbound route in Retell must point to the Italian-language inbound IVR agent (the same prompt and DTMF tools defined in Task 9 of plan 10, file `src/lib/voice/templates/prompts/inbound-ivr.txt`). Retell supports DTMF capture via custom functions analogous to Vapi's `capture_dtmf` tool — recreate `register_inbound_optout` and `transfer_to_business_owner` as Retell custom functions exposed to the inbound agent.

The webhook URL Retell calls on inbound events must be `/api/webhooks/retell` (handled by the same lifecycle code path used for Vapi after the adapter dispatches). Configure the shared secret to match `RETELL_WEBHOOK_SECRET` in the secret store.

### 4. Toggle the application to Retell

Set the `VOICE_PROVIDER` environment variable to `retell` (the factory in `src/lib/voice/factory.ts` switches on this) and redeploy. The dispatcher (plan 09) will start using `RetellAdapter` for new calls; in-flight Vapi calls continue under the old adapter and complete naturally because lifecycle webhooks are scoped to provider.

### 5. Smoke test

Run `pnpm exec tsx scripts/test-sbc-trunk.ts` (Task 15) — it picks a non-org-dedicated CLI from the pool, dispatches a test call via the active provider, and asserts a healthy ended call. Verify the call lands as expected and that the recording + transcript are persisted.

### 6. Switch back to Vapi

When Vapi is healthy again, reverse: set `VOICE_PROVIDER=vapi`, redeploy, and update `phone_numbers.provider_external_id` back to the Vapi `phoneNumberId` for each DID. Keep the Retell registration in place so the next switchover does not need to re-import DIDs.

## Differences worth noting

- Retell uses pre-configured agents with `retell_llm_dynamic_variables` for per-call overrides. Vapi accepts the system prompt and first message inline on each call. This means in Retell the inbound IVR prompt lives in the dashboard agent, not in the call payload — keep `src/lib/voice/templates/prompts/inbound-ivr.txt` as the source of truth and copy/paste into the Retell agent on every prompt change.
- Retell exposes transcripts as `transcript_object` with per-word timing; the adapter already maps this to our generic `TranscriptSegment` shape.
- Retell's recording URL is delivered on the `call.ended` event, same shape as Vapi for our purposes.

## References

- ADR 0002: Italian SBC carrier choice — `docs/architecture-decisions/0002-italian-sbc.md`
- Plan 08: Voice adapter — `docs/plans/08-voice-adapter-vapi.md`
- Plan 10: Telephony, CLI pool, anti-spam — `docs/plans/10-telephony-cli-pool.md`
- Retell adapter source — `src/lib/voice/retell/adapter.ts`
- Inbound IVR prompt — `src/lib/voice/templates/prompts/inbound-ivr.txt` (created in Task 9)

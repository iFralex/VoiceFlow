# ADR 0004: Phase 2 — Proprietary Voice Stack

**Date:** 2026-05-11
**Status:** Draft (Phase 2 — post-launch)
**Deciders:** Founding engineer

## Context

Phase 1 ships with two interchangeable voice providers — Vapi (primary) and Retell (fallback) — both accessed through a common `VoiceProvider` interface (`src/lib/voice/types.ts`). The `VOICE_PROVIDER` env var selects the active provider at startup.

Phase 2 will replace the third-party API dependency with a proprietary stack that:
- Routes calls through the Italian SBC directly (spec §17.1)
- Runs open-source ASR (Whisper-based) on a GPU node for transcription
- Uses a self-hosted LLM (Mistral or Llama derivative) for real-time response generation
- Keeps ElevenLabs (or a self-hosted TTS) for voice synthesis
- Eliminates per-call API fees charged by Vapi/Retell, improving unit economics at scale

The `voice.proprietary-stack` feature flag (PostHog) gates the canary rollout so a percentage of new campaigns can be directed to the proprietary stack before full cut-over.

## Decision

### Phase 1 placeholders (already in codebase)

The following scaffolding is present but non-functional in Phase 1:

- `VOICE_PROVIDER` env accepts `'proprietary'` as a valid value (validated in `src/lib/env.ts`).
  Setting it in Phase 1 throws an explanatory error from `getVoiceProvider()` in `src/lib/voice/factory.ts`.
- `call_provider` DB enum (`src/lib/db/schema/calls.ts`) already includes `'proprietary'`; no migration required when Phase 2 ships.
- `voice_catalogue.provider` column uses the same enum; proprietary voices can be seeded without a schema change.
- Feature flag `voice.proprietary-stack` exists in PostHog (created in plan 14 Task 6); default off in all environments.

### Phase 2 acceptance criteria (spec §17)

A Phase 2 voice stack implementation is accepted when all of the following are true:

1. **Functional parity**: `ProprietaryAdapter` implements the `VoiceProvider` interface
   (`src/lib/voice/types.ts`) with the same method signatures as `VapiAdapter` and `RetellAdapter`.
   All callers remain unchanged.

2. **SBC integration**: calls are initiated via the existing SBC trunk (see ADR 0002) — no new PSTN
   carrier required for Phase 2.

3. **Latency budget**: median end-to-end response latency (STT→LLM→TTS→audio playback start)
   ≤ 1,200 ms on a cold LLM (≤ 600 ms warm), measured at p50 over 100 consecutive test calls.

4. **Transcript fidelity**: WER (word error rate) on a held-out Italian corpus ≤ 8%; diarisation
   correctly attributes ≥ 95% of turns.

5. **Disclosure compliance**: the proprietary stack must inject the AI-Act disclosure preamble
   identical to the current `buildDisclosurePreamble()` implementation. Automated checks via the
   existing `disclosure.ts` verifier must pass.

6. **Feature-flag canary**: `voice.proprietary-stack` must gate the new stack, defaulting off.
   Gradual rollout (1% → 10% → 50% → 100%) with revert SLA < 5 minutes if error rate exceeds 2%.

7. **Cost model validated**: a before/after cost comparison at 10,000 minutes/month must show
   ≥ 40% reduction in voice-infra cost vs. Vapi at the same call volume.

8. **Smoke test green**: `e2e/launch-smoke.spec.ts` passes end-to-end with `VOICE_PROVIDER=proprietary`
   in the staging environment.

9. **Runbook updated**: `docs/runbooks/voice-provider-incident.md` updated to cover the proprietary
   stack fallback path (switch to `vapi` or `retell` within 5 minutes).

### Migration path

```
Phase 1 (current): VOICE_PROVIDER=vapi (or retell)
                        ↓  canary via feature flag
Phase 2 canary:    voice.proprietary-stack flag on for 1% of new campaigns
                        ↓  metrics green for 7 days
Phase 2 GA:        VOICE_PROVIDER=proprietary; vapi/retell kept for instant fallback
```

The factory (`src/lib/voice/factory.ts`) will need a `ProprietaryAdapter` import added and a
`case 'proprietary'` branch that instantiates it. Everything else in the call path is unchanged.

## Consequences

**Positive:**

- Phase 1 codebase carries zero dead-weight from Phase 2; only the enum value and feature flag exist.
- When Phase 2 ships, the schema migration cost is zero.
- The feature-flag canary enables a safe, measurable rollout with instant revert.
- Per-call cost reduction improves SaaS margin at scale.

**Negative / Accepted trade-offs:**

- Self-hosted GPU node introduces new infra complexity and operational overhead.
- Phase 2 WER target (≤ 8%) may not hold for thick regional accents without fine-tuning on Italian
  dealer corpus.
- During Phase 2 canary, the platform must support two live providers simultaneously — the factory
  and persistence layer already handle this (`getVoiceProviderByName`), but monitoring dashboards
  will need provider-segmented metrics.

## References

- Spec §17 — Proprietary voice stack requirements
- ADR 0002 — SBC carrier choice and fallback policy
- `src/lib/voice/factory.ts` — provider factory with Phase 2 placeholder
- `src/lib/voice/types.ts` — `VoiceProvider` interface all adapters must implement
- `src/lib/db/schema/calls.ts` — `callProviderEnum` including `'proprietary'`
- `docs/runbooks/voice-provider-incident.md` — incident mitigation including provider switch
- Plan `docs/plans/14-observability-and-launch.md` Task 6 — feature flag `voice.proprietary-stack`

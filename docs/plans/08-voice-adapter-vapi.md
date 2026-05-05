# Plan: Voice Adapter — Vapi + Retell + Lifecycle

**Branch:** `feat/08-voice-adapter-vapi`
**Wave:** 3
**Depends on:** 01, 02, 03, 04, 07
**Estimated effort:** 5–7 days

## Overview

Implements the entire voice orchestration adapter layer described in spec §8. Defines the `VoiceProvider` interface that decouples our application from any specific orchestrator vendor, ships the primary Vapi adapter (and a Retell adapter held as fallback), wires up the call lifecycle webhook, enforces tool-driven and inferred outcome classification, and ships the live-transfer flow. After this plan merges, a single test call from the dashboard can be placed end to end (campaign engine wiring lives in plan 09).

## Context

The adapter is the boundary at which Phase 2 will swap implementations to a proprietary stack (spec §8.2, §17). Tool-driven outcomes from the LLM are authoritative; inferred outcomes come from a post-call transcript classifier and are reconciled with tool outcomes for quality monitoring (§8.5). The webhook handler is idempotent on `provider_event_id` (§6.3, §8.4). The first-message AI Act disclosure passed to the orchestrator is the second of three independent enforcement layers per spec §12.3.

## Validation Commands

- `pnpm typecheck`
- `pnpm test src/lib/voice`
- `pnpm test:integration src/lib/voice`
- `pnpm test:e2e e2e/voice-test-call.spec.ts`
- `pnpm exec ngrok http 3000` (to receive Vapi webhooks during dev)
- `curl -X POST http://localhost:3000/api/internal/test-call -d '{"to": "+39..."}'` (manual smoke)

### Task 1: VoiceProvider interface

- [x] Create `src/lib/voice/types.ts` defining the canonical types per spec §8.2:

```typescript
export interface VoiceProvider {
  name: 'vapi' | 'retell' | 'proprietary';
  createCall(params: CreateCallParams): Promise<{ providerCallId: string }>;
  cancelCall(providerCallId: string): Promise<void>;
  fetchRecording(providerCallId: string): Promise<{ url: string; bytes: Buffer | null }>;
  fetchTranscript(providerCallId: string): Promise<TranscriptSegment[]>;
}

export interface CreateCallParams {
  toNumber: string;
  fromNumber: string;
  systemPrompt: string;
  firstMessage: string;
  voiceId: string;
  language: 'it-IT';
  maxDurationSeconds: number;
  webhookUrl: string;
  metadata: { orgId: string; campaignId: string; callId: string; contactId: string };
  endCallFunctions: ToolDefinition[];
  amdEnabled: boolean;
  recordingEnabled: boolean;
}

export type TranscriptSegment = {
  speaker: 'agent' | 'caller';
  text: string;
  startMs: number;
  endMs: number;
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
};
```

- [x] Mark completed

### Task 2: Provider factory

- [x] Create `src/lib/voice/factory.ts`:

```typescript
import { env } from '@/lib/env';
import { VapiAdapter } from './vapi/adapter';
import { RetellAdapter } from './retell/adapter';

export function getVoiceProvider(): VoiceProvider {
  switch (env.VOICE_PROVIDER) {
    case 'vapi':
      return new VapiAdapter(env.VAPI_API_KEY!);
    case 'retell':
      return new RetellAdapter(env.RETELL_API_KEY!);
    default:
      throw new Error('Unknown voice provider');
  }
}
```

- [x] Mark completed

### Task 3: Vapi assistant configuration

- [x] In Vapi dashboard create a "VoiceFlow Outbound Assistant" with the per-call override pattern: assistant id only carries default settings; per-call we pass `assistantOverrides` for system prompt, first message, voice, tools
- [x] Configure ElevenLabs as TTS provider and OpenAI gpt-4o (or current best) as the LLM in the Vapi assistant defaults
- [x] Configure Vapi to send webhook events to `${APP_URL}/api/webhooks/vapi`
- [x] Save assistant id into env as `VAPI_ASSISTANT_ID`
- [x] Mark completed

### Task 4: Vapi adapter implementation

- [x] Create `src/lib/voice/vapi/adapter.ts` implementing `VoiceProvider`:

```typescript
export class VapiAdapter implements VoiceProvider {
  name = 'vapi' as const;
  constructor(private apiKey: string) {}

  async createCall(params: CreateCallParams) {
    const body = {
      phoneNumberId: params.fromNumber, // Vapi uses ID, mapped via phone_numbers table in plan 10
      customer: { number: params.toNumber },
      assistantId: env.VAPI_ASSISTANT_ID,
      assistantOverrides: {
        firstMessage: params.firstMessage,
        model: {
          provider: 'openai',
          model: 'gpt-4o',
          systemPrompt: params.systemPrompt,
          tools: this.mapTools(params.endCallFunctions),
        },
        voice: { provider: '11labs', voiceId: params.voiceId, model: 'eleven_multilingual_v2' },
        transcriber: { provider: 'deepgram', model: 'nova-2', language: 'it' },
        endCallFunctionEnabled: true,
        recordingEnabled: params.recordingEnabled,
        backgroundDenoisingEnabled: true,
        maxDurationSeconds: params.maxDurationSeconds,
      },
      metadata: params.metadata,
      serverUrl: params.webhookUrl,
      serverUrlSecret: env.VAPI_WEBHOOK_SECRET,
    };
    const res = await fetch('https://api.vapi.ai/call', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new VoiceProviderError('vapi.create_call_failed', await res.text());
    const json = await res.json();
    return { providerCallId: json.id };
  }
  // cancelCall, fetchRecording, fetchTranscript implementations follow
  private mapTools(tools: ToolDefinition[]) {
    /* map our schema to Vapi function tool format */
  }
}
```

- [x] Implement `cancelCall` calling Vapi DELETE `/call/{id}`
- [x] Implement `fetchRecording` returning the recording URL from the call object
- [x] Implement `fetchTranscript` returning Vapi's structured transcript and mapping speakers
- [x] Define `VoiceProviderError` typed error class for upstream catches
- [x] Mark completed

### Task 5: Retell adapter (parallel implementation)

- [x] Create `src/lib/voice/retell/adapter.ts` implementing the same interface using Retell's API
- [x] Map our `endCallFunctions` to Retell's custom functions schema
- [x] Configure Retell webhook url and shared secret
- [x] Wire in factory under `VOICE_PROVIDER=retell`
- [x] Treat as fallback: not used in production by default but kept tested in CI
- [x] Mark completed

### Task 6: Voice catalogue population

- [x] Update `src/lib/db/seed/voice_catalogue.ts` (table created in plan 07) with the actual ElevenLabs voice IDs to be used:
  - 2 male voices for Italian sales tone
  - 2 female voices for Italian sales tone
  - 1 neutral voice for surveys (CSI)
- [x] Each row stores `provider='vapi'` (since both Vapi and Retell route through ElevenLabs and use the same external IDs), `external_voice_id`, `display_name`, `sample_url` to a short MP3 in Storage
- [x] Update template seeds (plan 07) to set `default_voice_id` referencing real entries
- [x] Mark completed

### Task 7: Call service — domain layer

- [x] Create `src/lib/services/calls.ts`:

```typescript
export async function createPendingCall(orgId: string, input: NewCall): Promise<Call>;
export async function dispatchCall(orgId: string, callId: string): Promise<void>;
export async function recordCallStarted(callId: string, providerEventId: string): Promise<void>;
export async function recordCallEnded(
  callId: string,
  args: {
    durationSeconds: number;
    endedReason: string;
    recordingUrl?: string;
    transcriptSegments?: TranscriptSegment[];
  },
): Promise<void>;
export async function recordToolInvocation(
  callId: string,
  tool: string,
  args: unknown,
): Promise<void>;
export async function classifyAndFinaliseCall(callId: string): Promise<void>;
export async function fetchCallTimeline(orgId: string, callId: string): Promise<CallTimeline>;
```

- [x] `dispatchCall` resolves the campaign's script, assembles the system prompt and first message, picks a voice, picks a CLI from the pool (plan 10), calls `provider.createCall`, persists `provider_call_id`, transitions status `pending → dialing`
- [x] `recordCallEnded` persists recording and transcript paths to Storage (download from provider, upload to our bucket — see Task 9), transitions status, computes billable seconds, calls `chargeForCall` from plan 05, emits Inngest events for downstream actions
- [x] All operations wrapped in `withOrgContext` after resolving from `calls.org_id`
- [x] Mark completed

### Task 8: Vapi webhook handler

- [ ] Create `src/app/api/webhooks/vapi/route.ts`:
  - read raw body, verify HMAC against `VAPI_WEBHOOK_SECRET`
  - dedupe via `webhook_events`
  - persist payload
  - dispatch on `event.type`:
    - `call.started` → `recordCallStarted`
    - `call.ended` → emit `call.completed` Inngest event with payload (heavy work deferred)
    - `function-call` → `recordToolInvocation` and side-effect handler (Task 10)
    - `transcript.partial` → ignored (we only consume final)
    - `status-update` → update `calls.status` if mapping exists
  - return 200 within 3s
- [ ] Add unit test using a fixture payload + known signature
- [ ] Mark completed

### Task 9: Recording and transcript persistence

- [ ] Create `src/lib/voice/persistence.ts` with `persistCallArtifacts(callId)`:
  - read `calls.provider_call_id` and `calls.provider`
  - call `provider.fetchRecording` and stream the MP3 into Supabase Storage path `recordings/<org_id>/<call_id>.mp3`
  - call `provider.fetchTranscript`, format as JSON `[{ speaker, text, startMs, endMs }]`, upload to `transcripts/<org_id>/<call_id>.json`
  - update `calls.recording_path` and `calls.transcript_path`
- [ ] Run inside Inngest function `call.persist-artifacts` triggered by `call.completed` (with retry; fetching is sometimes available only minutes after the event)
- [ ] Mark completed

### Task 10: Tool handlers — side effects

- [ ] Create `src/lib/voice/tools/handlers.ts` mapping each tool name to a side-effect function:
  - `book_appointment(orgId, callId, args)`: insert `appointments` row, set `calls.appointment_id`, set `calls.outcome='appointment_booked'`, emit `appointment.booked` Inngest event
  - `mark_not_interested(orgId, callId, args)`: set `calls.outcome='not_interested'`
  - `mark_wrong_number(orgId, callId, args)`: set `calls.outcome='wrong_number'`, soft-update contact metadata (number flagged)
  - `request_callback(orgId, callId, args)`: set `calls.outcome='callback_requested'`, store window in metadata, schedule Inngest event for re-attempt within window
  - `transfer_to_human_agent(orgId, callId, args)`: set `calls.transferred_to_agent=true`, emit Inngest event for plan 13's notification handler
  - `register_opt_out(orgId, callId, args)`: insert into `opt_out_registry`, set contact `opt_out=true`, set `calls.outcome='do_not_call'`
- [ ] Tool handlers run inside the same transaction as the call status update (consistency over speed)
- [ ] All handlers idempotent: re-invoking with the same `(callId, tool)` is a no-op
- [ ] Mark completed

### Task 11: Outcome classifier — inferred path

- [ ] Create `src/lib/voice/classifier.ts` with `classifyTranscript(transcript)`:
  - take the full transcript JSON
  - call OpenAI `gpt-4o-mini` (cheap, fast) with a structured-output JSON Schema returning `{ outcome: enum, confidence: number, reasoning: string }`
  - prompt instructs the model to use the same enum values as our DB outcome enum
- [ ] Triggered from Inngest function `call.classify` after artifacts are persisted, only if no tool-driven outcome was already set
- [ ] Persist result on `calls.outcome` and `calls.outcome_confidence`
- [ ] If both tool and inferred outcomes exist (rare race) and they disagree, do NOT overwrite the tool outcome; emit a `quality.outcome-mismatch` event for the QA dashboard (plan 14)
- [ ] Mark completed

### Task 12: AI disclosure verification

- [ ] In `call.classify` add a step that runs a lightweight check: search the first 30 seconds of the transcript for the literal substring "assistente vocale automatico" (case-insensitive)
- [ ] If absent, set `calls.metadata.disclosure_verified=false` and emit `quality.disclosure-missing` event
- [ ] Surface in the QA dashboard for human review (plan 14); does not block billing
- [ ] Add unit tests on synthetic transcripts
- [ ] Mark completed

### Task 13: Live transfer support

- [ ] Configure Vapi `transferList` per-call: when `transfer_to_human_agent` tool is invoked, Vapi initiates a warm transfer to a configured number
- [ ] Per-script setting: `transfer_target_phone` stored in `scripts.variables` (added to schemas in plan 07; if missing, transfer is disabled)
- [ ] On transfer event update `calls.transferred_to_agent`, emit `call.transferred` Inngest event for plan 13 notification
- [ ] Document in operator-facing docs how the dealership configures their transfer numbers
- [ ] Mark completed

### Task 14: AMD (answering machine detection)

- [ ] Configure Vapi to enable AMD on every call (`amdEnabled: true` per `CreateCallParams`)
- [ ] On `call.ended` with `endedReason='voicemail'` (or equivalent Vapi flag), set `calls.status='voicemail'` and `calls.outcome='voicemail_left'` if a voicemail message was left, else `voicemail_no_message`
- [ ] Per-script policy: `leave_voicemail_message` boolean (default false in Phase 1; the simpler "hang up on AMD" behaviour is safer for compliance)
- [ ] If `leave_voicemail_message=true`, after AMD the agent waits for the beep (Vapi's voicemail-detection-then-message capability) and reads a short pre-authored message also bound by the AI Act preamble (templated separately)
- [ ] Mark completed

### Task 15: Internal test-call endpoint

- [ ] Create `src/app/api/internal/test-call/route.ts` (gated by capability `org.manage` and a feature flag `internal.test_call`):
  - body: `{ scriptId: string; toNumber: string; voiceIdOverride?: string }`
  - dispatches a one-off call against the script (creates a synthetic single-contact campaign or bypasses campaign tables via a `test_call` mode flag on `calls`)
  - returns `{ callId }`
- [ ] UI in `/scripts/<id>` page: "Chiamami ora" button asking for an Italian number; verifies the number belongs to a member of the org (security: someone could try to weaponise the test endpoint)
- [ ] Hard rate limit: 10 test calls per org per day
- [ ] Mark completed

### Task 16: Integration tests

- [ ] Mock Vapi API and webhook signatures via `msw` fixtures
- [ ] Test: `dispatchCall` sends the right payload (system prompt assembled with preamble first; first message contains disclosure)
- [ ] Test: webhook signature verification rejects malformed signatures
- [ ] Test: duplicate `call.ended` webhook is no-op (idempotency)
- [ ] Test: tool invocation idempotent
- [ ] Test: classifier runs only when no tool outcome exists
- [ ] Test: cross-org RLS prevents reading another org's calls
- [ ] Mark completed

### Task 17: E2E test call against staging

- [ ] Playwright `e2e/voice-test-call.spec.ts` runs only against staging (skipped in CI):
  - sign in
  - create a script from `lead-reactivation` template
  - click "Chiamami ora" with a known test number that auto-records and auto-hangs-up
  - poll `/calls/<id>` page until status `completed`
  - assert recording and transcript present
  - assert outcome is one of expected enum values
- [ ] Mark completed

### Task 18: Definition of Done

- [ ] `VoiceProvider` interface stable, both Vapi and Retell adapters pass the same conformance test suite
- [ ] Test call from the dashboard runs end to end
- [ ] AI disclosure verified in transcripts (verification helper integrated)
- [ ] Tool side effects all idempotent
- [ ] Recordings and transcripts persisted to our Storage, retrievable via signed URL
- [ ] Inferred classifier handles all standard cases with >80% confidence on a fixture corpus of 30 transcripts
- [ ] Mark completed

/**
 * VoiceProvider conformance test suite.
 *
 * Both VapiAdapter and RetellAdapter must satisfy the same VoiceProvider
 * interface contract.  This file runs an identical set of assertions against
 * each adapter implementation, acting as a living specification for the
 * interface defined in types.ts.
 *
 * Any future proprietary adapter must also pass this suite before merging.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VapiAdapter } from './vapi/adapter';
import { RetellAdapter } from './retell/adapter';
import { VoiceProviderError } from './errors';
import type { VoiceProvider, CreateCallParams } from './types';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const BASE_PARAMS: CreateCallParams = {
  toNumber: '+393331234567',
  fromNumber: 'phone-number-id-xyz',
  systemPrompt: 'Sei un assistente vocale automatico di prova.',
  firstMessage: 'Buongiorno, sono un assistente vocale automatico.',
  voiceId: 'eleven-voice-id',
  language: 'it-IT',
  maxDurationSeconds: 300,
  webhookUrl: 'https://example.com/api/webhooks/voice',
  metadata: {
    orgId: 'org-1',
    campaignId: 'campaign-1',
    callId: 'call-1',
    contactId: 'contact-1',
  },
  endCallFunctions: [
    {
      name: 'book_appointment',
      description: 'Prenota un appuntamento',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  ],
  amdEnabled: true,
  recordingEnabled: true,
};

const RECORDING_URL = 'https://cdn.example.com/recordings/conformance-test.mp3';

// ---------------------------------------------------------------------------
// Per-adapter configuration
// ---------------------------------------------------------------------------

type AdapterConfig = {
  adapterName: string;
  makeAdapter: () => VoiceProvider;
  callId: string;
  stubEnv: () => void;
  // Fetch mock factories — each returns a stubbed fetch Response
  makeCreateSuccessFetch: () => typeof fetch;
  makeCreateFailureFetch: () => typeof fetch;
  makeCancelSuccessFetch: () => typeof fetch;
  makeCancelNotFoundFetch: () => typeof fetch;
  makeCancelErrorFetch: () => typeof fetch;
  makeRecordingSuccessFetch: () => typeof fetch;
  makeRecordingMissingFetch: () => typeof fetch;
  makeTranscriptSuccessFetch: () => typeof fetch;
  makeTranscriptEmptyFetch: () => typeof fetch;
};

const adapterConfigs: AdapterConfig[] = [
  // ── Vapi ──────────────────────────────────────────────────────────────────
  {
    adapterName: 'VapiAdapter',
    makeAdapter: () => new VapiAdapter('vapi-test-key'),
    callId: 'vapi-call-conformance',
    stubEnv: () => {
      vi.stubEnv('VAPI_ASSISTANT_ID', 'assistant-id-default');
      vi.stubEnv('VAPI_WEBHOOK_SECRET', 'webhook-secret-xyz');
    },
    makeCreateSuccessFetch: () =>
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'vapi-call-conformance' }),
      }) as unknown as typeof fetch,
    makeCreateFailureFetch: () =>
      vi.fn().mockResolvedValue({
        ok: false,
        text: async () => 'Bad Request',
      }) as unknown as typeof fetch,
    makeCancelSuccessFetch: () =>
      vi.fn().mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch,
    makeCancelNotFoundFetch: () =>
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Not Found',
      }) as unknown as typeof fetch,
    makeCancelErrorFetch: () =>
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      }) as unknown as typeof fetch,
    makeRecordingSuccessFetch: () =>
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'vapi-call-conformance', recordingUrl: RECORDING_URL }),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => new ArrayBuffer(16),
        }) as unknown as typeof fetch,
    makeRecordingMissingFetch: () =>
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'vapi-call-conformance' }),
      }) as unknown as typeof fetch,
    makeTranscriptSuccessFetch: () =>
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'vapi-call-conformance',
          artifact: {
            messages: [
              { role: 'assistant', message: 'Buongiorno!', secondsFromStart: 0, endTime: 1.5 },
              { role: 'user', message: 'Sì, sono io.', secondsFromStart: 2.0, endTime: 4.0 },
            ],
          },
        }),
      }) as unknown as typeof fetch,
    makeTranscriptEmptyFetch: () =>
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'vapi-call-conformance' }),
      }) as unknown as typeof fetch,
  },

  // ── Retell ────────────────────────────────────────────────────────────────
  {
    adapterName: 'RetellAdapter',
    makeAdapter: () => new RetellAdapter('retell-test-key'),
    callId: 'retell-call-conformance',
    stubEnv: () => {
      vi.stubEnv('RETELL_AGENT_ID', 'retell-agent-default');
      vi.stubEnv('RETELL_WEBHOOK_SECRET', 'retell-webhook-secret-xyz');
    },
    makeCreateSuccessFetch: () =>
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ call_id: 'retell-call-conformance', call_status: 'registered' }),
      }) as unknown as typeof fetch,
    makeCreateFailureFetch: () =>
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      }) as unknown as typeof fetch,
    makeCancelSuccessFetch: () =>
      vi.fn().mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch,
    makeCancelNotFoundFetch: () =>
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Not Found',
      }) as unknown as typeof fetch,
    makeCancelErrorFetch: () =>
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      }) as unknown as typeof fetch,
    makeRecordingSuccessFetch: () =>
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            call_id: 'retell-call-conformance',
            call_status: 'ended',
            recording_url: RECORDING_URL,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => new ArrayBuffer(16),
        }) as unknown as typeof fetch,
    makeRecordingMissingFetch: () =>
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ call_id: 'retell-call-conformance', call_status: 'ended' }),
      }) as unknown as typeof fetch,
    makeTranscriptSuccessFetch: () =>
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          call_id: 'retell-call-conformance',
          call_status: 'ended',
          transcript_object: [
            {
              role: 'agent',
              content: 'Buongiorno!',
              words: [{ word: 'Buongiorno!', start: 0, end: 1.5 }],
            },
            {
              role: 'user',
              content: 'Sì, sono io.',
              words: [
                { word: 'Sì,', start: 2.0, end: 2.5 },
                { word: 'sono', start: 2.5, end: 3.0 },
                { word: 'io.', start: 3.0, end: 4.0 },
              ],
            },
          ],
        }),
      }) as unknown as typeof fetch,
    makeTranscriptEmptyFetch: () =>
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ call_id: 'retell-call-conformance', call_status: 'ended' }),
      }) as unknown as typeof fetch,
  },
];

// ---------------------------------------------------------------------------
// Conformance suite — runs against every adapter
// ---------------------------------------------------------------------------

for (const config of adapterConfigs) {
  describe(`${config.adapterName} — VoiceProvider conformance`, () => {
    beforeEach(() => {
      vi.stubEnv('SKIP_ENV_VALIDATION', 'true');
      config.stubEnv();
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    });

    // ── Interface contract ────────────────────────────────────────────────

    it('name is a valid VoiceProvider discriminant', () => {
      const adapter = config.makeAdapter();
      expect(['vapi', 'retell', 'proprietary']).toContain(adapter.name);
    });

    it('implements all four VoiceProvider methods', () => {
      const adapter = config.makeAdapter();
      expect(typeof adapter.createCall).toBe('function');
      expect(typeof adapter.cancelCall).toBe('function');
      expect(typeof adapter.fetchRecording).toBe('function');
      expect(typeof adapter.fetchTranscript).toBe('function');
    });

    // ── createCall ────────────────────────────────────────────────────────

    it('createCall resolves with { providerCallId: string }', async () => {
      vi.stubGlobal('fetch', config.makeCreateSuccessFetch());
      const result = await config.makeAdapter().createCall(BASE_PARAMS);
      expect(result).toHaveProperty('providerCallId');
      expect(typeof result.providerCallId).toBe('string');
      expect(result.providerCallId.length).toBeGreaterThan(0);
    });

    it('createCall throws VoiceProviderError on API failure', async () => {
      vi.stubGlobal('fetch', config.makeCreateFailureFetch());
      await expect(config.makeAdapter().createCall(BASE_PARAMS)).rejects.toBeInstanceOf(
        VoiceProviderError,
      );
    });

    // ── cancelCall ────────────────────────────────────────────────────────

    it('cancelCall resolves without error on success', async () => {
      vi.stubGlobal('fetch', config.makeCancelSuccessFetch());
      await expect(config.makeAdapter().cancelCall(config.callId)).resolves.toBeUndefined();
    });

    it('cancelCall is idempotent — resolves without error when call not found', async () => {
      vi.stubGlobal('fetch', config.makeCancelNotFoundFetch());
      await expect(config.makeAdapter().cancelCall(config.callId)).resolves.toBeUndefined();
    });

    it('cancelCall throws VoiceProviderError on unexpected API error', async () => {
      vi.stubGlobal('fetch', config.makeCancelErrorFetch());
      await expect(config.makeAdapter().cancelCall(config.callId)).rejects.toBeInstanceOf(
        VoiceProviderError,
      );
    });

    // ── fetchRecording ────────────────────────────────────────────────────

    it('fetchRecording resolves with { url: string, bytes: Buffer | null }', async () => {
      vi.stubGlobal('fetch', config.makeRecordingSuccessFetch());
      const result = await config.makeAdapter().fetchRecording(config.callId);
      expect(typeof result.url).toBe('string');
      expect(result.url).toBe(RECORDING_URL);
      // bytes may be a Buffer (downloaded) or null (still processing)
      const validBytes = result.bytes === null || Buffer.isBuffer(result.bytes);
      expect(validBytes).toBe(true);
    });

    it('fetchRecording throws VoiceProviderError when no recording URL is present', async () => {
      vi.stubGlobal('fetch', config.makeRecordingMissingFetch());
      await expect(config.makeAdapter().fetchRecording(config.callId)).rejects.toBeInstanceOf(
        VoiceProviderError,
      );
    });

    // ── fetchTranscript ───────────────────────────────────────────────────

    it('fetchTranscript returns TranscriptSegment[] with correct shape and speaker mapping', async () => {
      vi.stubGlobal('fetch', config.makeTranscriptSuccessFetch());
      const segments = await config.makeAdapter().fetchTranscript(config.callId);
      expect(Array.isArray(segments)).toBe(true);
      expect(segments.length).toBeGreaterThan(0);

      for (const seg of segments) {
        expect(['agent', 'caller']).toContain(seg.speaker);
        expect(typeof seg.text).toBe('string');
        expect(typeof seg.startMs).toBe('number');
        expect(typeof seg.endMs).toBe('number');
      }

      // The mock transcript starts with an agent turn
      expect(segments[0]!.speaker).toBe('agent');
      // followed by a caller turn
      expect(segments[1]!.speaker).toBe('caller');
    });

    it('fetchTranscript returns an empty array when no transcript is available', async () => {
      vi.stubGlobal('fetch', config.makeTranscriptEmptyFetch());
      const segments = await config.makeAdapter().fetchTranscript(config.callId);
      expect(segments).toEqual([]);
    });
  });
}

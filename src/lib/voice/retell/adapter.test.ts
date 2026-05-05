import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RetellAdapter } from './adapter';
import { VoiceProviderError } from '../errors';
import type { CreateCallParams } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_API_KEY = 'retell-test-api-key';
const TEST_CALL_ID = 'retell-call-abc123';

const baseParams: CreateCallParams = {
  toNumber: '+393331234567',
  fromNumber: '+390291234567',
  systemPrompt: 'Sei un agente vocale automatico.',
  firstMessage: 'Ciao, sono un assistente vocale automatico.',
  voiceId: 'eleven-voice-id',
  language: 'it-IT',
  maxDurationSeconds: 300,
  webhookUrl: 'https://example.com/api/webhooks/retell',
  metadata: {
    orgId: 'org-1',
    campaignId: 'campaign-1',
    callId: 'call-1',
    contactId: 'contact-1',
  },
  endCallFunctions: [
    {
      name: 'book_appointment',
      description: 'Book an appointment',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  ],
  amdEnabled: true,
  recordingEnabled: true,
};

function makeAdapter() {
  return new RetellAdapter(TEST_API_KEY);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RetellAdapter', () => {
  beforeEach(() => {
    vi.stubEnv('SKIP_ENV_VALIDATION', 'true');
    vi.stubEnv('RETELL_AGENT_ID', 'retell-agent-default');
    vi.stubEnv('RETELL_WEBHOOK_SECRET', 'retell-webhook-secret-xyz');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('createCall', () => {
    it('posts to /v2/create-phone-call with correct Authorization header', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ call_id: TEST_CALL_ID, call_status: 'registered' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const adapter = makeAdapter();
      const result = await adapter.createCall(baseParams);

      expect(result).toEqual({ providerCallId: TEST_CALL_ID });
      expect(fetchMock).toHaveBeenCalledOnce();

      const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
      expect(url).toBe('https://api.retellai.com/v2/create-phone-call');
      expect((init.headers as Record<string, string>)['Authorization']).toBe(
        `Bearer ${TEST_API_KEY}`,
      );
      expect(init.method).toBe('POST');
    });

    it('includes from_number, to_number, and dynamic variables in the payload', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ call_id: TEST_CALL_ID, call_status: 'registered' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await makeAdapter().createCall(baseParams);

      const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.from_number).toBe(baseParams.fromNumber);
      expect(body.to_number).toBe(baseParams.toNumber);
      expect(body.retell_llm_dynamic_variables.system_prompt).toBe(baseParams.systemPrompt);
      expect(body.retell_llm_dynamic_variables.first_message).toBe(baseParams.firstMessage);
      expect(body.metadata).toEqual(baseParams.metadata);
    });

    it('uses RETELL_AGENT_ID from env', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ call_id: TEST_CALL_ID, call_status: 'registered' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await makeAdapter().createCall(baseParams);

      const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.agent_id).toBe('retell-agent-default');
    });

    it('throws VoiceProviderError when Retell returns non-ok response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          text: async () => 'Bad Request',
        }),
      );

      await expect(makeAdapter().createCall(baseParams)).rejects.toThrow(VoiceProviderError);
      await expect(makeAdapter().createCall(baseParams)).rejects.toThrow(
        'retell.create_call_failed',
      );
    });
  });

  describe('cancelCall', () => {
    it('sends DELETE to /v2/delete-call/{id}', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', fetchMock);

      await makeAdapter().cancelCall(TEST_CALL_ID);

      const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
      expect(url).toBe(`https://api.retellai.com/v2/delete-call/${TEST_CALL_ID}`);
      expect(init.method).toBe('DELETE');
    });

    it('treats 404 as success (already cancelled)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'Not Found' }),
      );

      await expect(makeAdapter().cancelCall(TEST_CALL_ID)).resolves.toBeUndefined();
    });

    it('throws VoiceProviderError on other non-ok responses', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          text: async () => 'Internal Server Error',
        }),
      );

      await expect(makeAdapter().cancelCall(TEST_CALL_ID)).rejects.toThrow(VoiceProviderError);
      await expect(makeAdapter().cancelCall(TEST_CALL_ID)).rejects.toThrow(
        'retell.cancel_call_failed',
      );
    });
  });

  describe('fetchRecording', () => {
    it('returns url from recording_url and downloads bytes', async () => {
      const callResponse = {
        call_id: TEST_CALL_ID,
        call_status: 'ended',
        recording_url: 'https://cdn.retellai.com/recordings/abc.mp3',
      };
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => callResponse })
        .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
      vi.stubGlobal('fetch', fetchMock);

      const result = await makeAdapter().fetchRecording(TEST_CALL_ID);
      expect(result.url).toBe('https://cdn.retellai.com/recordings/abc.mp3');
      expect(result.bytes).toBeInstanceOf(Buffer);
    });

    it('returns bytes=null when download fails (recording still processing)', async () => {
      const callResponse = {
        call_id: TEST_CALL_ID,
        call_status: 'ended',
        recording_url: 'https://cdn.retellai.com/recordings/abc.mp3',
      };
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce({ ok: true, json: async () => callResponse })
          .mockResolvedValueOnce({ ok: false }),
      );

      const result = await makeAdapter().fetchRecording(TEST_CALL_ID);
      expect(result.url).toBe('https://cdn.retellai.com/recordings/abc.mp3');
      expect(result.bytes).toBeNull();
    });

    it('throws VoiceProviderError when no recording URL is present', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ call_id: TEST_CALL_ID, call_status: 'ended' }),
        }),
      );

      await expect(makeAdapter().fetchRecording(TEST_CALL_ID)).rejects.toThrow(
        'retell.recording_not_available',
      );
    });

    it('throws VoiceProviderError when fetchCall fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          text: async () => 'Server Error',
        }),
      );

      await expect(makeAdapter().fetchRecording(TEST_CALL_ID)).rejects.toThrow(
        'retell.fetch_call_failed',
      );
    });
  });

  describe('fetchTranscript', () => {
    it('maps agent entries to agent speaker with millisecond timestamps', async () => {
      const callResponse = {
        call_id: TEST_CALL_ID,
        call_status: 'ended',
        transcript_object: [
          {
            role: 'agent',
            content: 'Ciao!',
            words: [
              { word: 'Ciao!', start: 1.0, end: 2.0 },
            ],
          },
          {
            role: 'user',
            content: 'Ciao a lei.',
            words: [
              { word: 'Ciao', start: 2.5, end: 3.0 },
              { word: 'a', start: 3.0, end: 3.2 },
              { word: 'lei.', start: 3.2, end: 4.0 },
            ],
          },
        ],
      };
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: async () => callResponse }),
      );

      const segments = await makeAdapter().fetchTranscript(TEST_CALL_ID);
      expect(segments).toHaveLength(2);
      expect(segments[0]).toEqual({ speaker: 'agent', text: 'Ciao!', startMs: 1000, endMs: 2000 });
      expect(segments[1]).toEqual({
        speaker: 'caller',
        text: 'Ciao a lei.',
        startMs: 2500,
        endMs: 4000,
      });
    });

    it('returns empty array when transcript_object is absent', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ call_id: TEST_CALL_ID, call_status: 'ended' }),
        }),
      );

      const segments = await makeAdapter().fetchTranscript(TEST_CALL_ID);
      expect(segments).toEqual([]);
    });

    it('uses zero timestamps when entry has no words', async () => {
      const callResponse = {
        call_id: TEST_CALL_ID,
        call_status: 'ended',
        transcript_object: [
          { role: 'agent', content: 'Buongiorno.', words: [] },
        ],
      };
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: async () => callResponse }),
      );

      const segments = await makeAdapter().fetchTranscript(TEST_CALL_ID);
      expect(segments[0]).toEqual({ speaker: 'agent', text: 'Buongiorno.', startMs: 0, endMs: 0 });
    });
  });

  describe('mapTools', () => {
    it('maps ToolDefinition to Retell custom function format', () => {
      const adapter = makeAdapter();
      const result = adapter.mapTools([
        {
          name: 'book_appointment',
          description: 'Book an appointment',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      ]);

      expect(result).toEqual([
        {
          name: 'book_appointment',
          description: 'Book an appointment',
          speak_during_execution: false,
          speak_after_execution: false,
          parameters: { type: 'object', properties: {}, required: [] },
        },
      ]);
    });
  });

  describe('VoiceProviderError (from shared errors)', () => {
    it('is an instance of Error with correct properties', () => {
      const err = new VoiceProviderError('retell.create_call_failed', 'Bad request');
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('VoiceProviderError');
      expect(err.code).toBe('retell.create_call_failed');
      expect(err.detail).toBe('Bad request');
      expect(err.message).toBe('[retell.create_call_failed] Bad request');
    });
  });
});

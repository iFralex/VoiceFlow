import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VapiAdapter, VoiceProviderError } from './adapter';
import type { CreateCallParams } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_API_KEY = 'test-api-key';
const TEST_CALL_ID = 'vapi-call-abc123';

const baseParams: CreateCallParams = {
  toNumber: '+393331234567',
  fromNumber: 'phone-number-id-xyz',
  systemPrompt: 'Sei un agente vocale automatico.',
  firstMessage: 'Ciao, sono un assistente vocale automatico.',
  voiceId: 'eleven-voice-id',
  language: 'it-IT',
  maxDurationSeconds: 300,
  webhookUrl: 'https://example.com/api/webhooks/vapi',
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
  return new VapiAdapter(TEST_API_KEY);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VapiAdapter', () => {
  beforeEach(() => {
    vi.stubEnv('SKIP_ENV_VALIDATION', 'true');
    vi.stubEnv('VAPI_ASSISTANT_ID', 'assistant-id-default');
    vi.stubEnv('VAPI_WEBHOOK_SECRET', 'webhook-secret-xyz');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('createCall', () => {
    it('posts to /call with correct Authorization header and returns providerCallId', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: TEST_CALL_ID }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const adapter = makeAdapter();
      const result = await adapter.createCall(baseParams);

      expect(result).toEqual({ providerCallId: TEST_CALL_ID });
      expect(fetchMock).toHaveBeenCalledOnce();

      const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
      expect(url).toBe('https://api.vapi.ai/call');
      expect((init.headers as Record<string, string>)['Authorization']).toBe(
        `Bearer ${TEST_API_KEY}`,
      );
      expect(init.method).toBe('POST');
    });

    it('maps endCallFunctions to Vapi function-tool format', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: TEST_CALL_ID }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await makeAdapter().createCall(baseParams);

      const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.assistantOverrides.model.tools).toEqual([
        {
          type: 'function',
          function: {
            name: 'book_appointment',
            description: 'Book an appointment',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ]);
    });

    it('injects a native transferCall tool when transferTargetPhone is set', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: TEST_CALL_ID }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await makeAdapter().createCall({
        ...baseParams,
        transferTargetPhone: '+390212345678',
      });

      const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
      const tools: unknown[] = body.assistantOverrides.model.tools;
      // Should have the original function tool + one transferCall tool
      expect(tools).toHaveLength(2);
      const transferTool = tools.find(
        (t) => (t as { type: string }).type === 'transferCall',
      ) as { type: string; destinations: { type: string; number: string }[] };
      expect(transferTool).toBeDefined();
      expect(transferTool.destinations[0]!.number).toBe('+390212345678');
    });

    it('does not inject a transferCall tool when transferTargetPhone is absent', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: TEST_CALL_ID }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await makeAdapter().createCall(baseParams);

      const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
      const tools: unknown[] = body.assistantOverrides.model.tools;
      const hasTransferTool = tools.some(
        (t) => (t as { type: string }).type === 'transferCall',
      );
      expect(hasTransferTool).toBe(false);
    });

    it('sends voicemailDetection with enabled=true when amdEnabled=true', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: TEST_CALL_ID }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await makeAdapter().createCall({ ...baseParams, amdEnabled: true });

      const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.assistantOverrides.voicemailDetection).toEqual({
        provider: 'twilio',
        enabled: true,
      });
    });

    it('sends voicemailDetection with enabled=false when amdEnabled=false', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: TEST_CALL_ID }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await makeAdapter().createCall({ ...baseParams, amdEnabled: false });

      const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.assistantOverrides.voicemailDetection).toEqual({
        provider: 'twilio',
        enabled: false,
      });
    });

    it('includes voicemailMessage in assistantOverrides when provided', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: TEST_CALL_ID }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await makeAdapter().createCall({
        ...baseParams,
        voicemailMessage: 'Salve, le lascio un messaggio da parte di AutoRoma.',
      });

      const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.assistantOverrides.voicemailMessage).toBe(
        'Salve, le lascio un messaggio da parte di AutoRoma.',
      );
    });

    it('omits voicemailMessage from assistantOverrides when not provided', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: TEST_CALL_ID }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await makeAdapter().createCall(baseParams);

      const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.assistantOverrides).not.toHaveProperty('voicemailMessage');
    });

    it('includes metadata and serverUrl in the payload', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: TEST_CALL_ID }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await makeAdapter().createCall(baseParams);

      const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.metadata).toEqual(baseParams.metadata);
      expect(body.serverUrl).toBe(baseParams.webhookUrl);
      expect(body.serverUrlSecret).toBe('webhook-secret-xyz');
    });

    it('throws VoiceProviderError when Vapi returns non-ok response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        text: async () => 'Bad Request',
      }));

      await expect(makeAdapter().createCall(baseParams)).rejects.toThrow(VoiceProviderError);
      await expect(makeAdapter().createCall(baseParams)).rejects.toThrow(
        'vapi.create_call_failed',
      );
    });
  });

  describe('cancelCall', () => {
    it('sends DELETE to /call/{id}', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', fetchMock);

      await makeAdapter().cancelCall(TEST_CALL_ID);

      const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
      expect(url).toBe(`https://api.vapi.ai/call/${TEST_CALL_ID}`);
      expect(init.method).toBe('DELETE');
    });

    it('treats 404 as success (already cancelled)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'Not Found' }));

      await expect(makeAdapter().cancelCall(TEST_CALL_ID)).resolves.toBeUndefined();
    });

    it('throws VoiceProviderError on other non-ok responses', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      }));

      await expect(makeAdapter().cancelCall(TEST_CALL_ID)).rejects.toThrow(VoiceProviderError);
    });
  });

  describe('fetchRecording', () => {
    it('returns url from artifact.recordingUrl (preferred)', async () => {
      const callResponse = {
        id: TEST_CALL_ID,
        artifact: { recordingUrl: 'https://cdn.vapi.ai/recordings/abc.mp3' },
      };
      const downloadResponse = {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      };

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => callResponse })   // GET /call
        .mockResolvedValueOnce(downloadResponse);                              // GET recording
      vi.stubGlobal('fetch', fetchMock);

      const result = await makeAdapter().fetchRecording(TEST_CALL_ID);
      expect(result.url).toBe('https://cdn.vapi.ai/recordings/abc.mp3');
      expect(result.bytes).toBeInstanceOf(Buffer);
    });

    it('falls back to top-level recordingUrl when artifact is absent', async () => {
      const callResponse = {
        id: TEST_CALL_ID,
        recordingUrl: 'https://cdn.vapi.ai/recordings/fallback.mp3',
      };
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => callResponse })
        .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }),
      );

      const result = await makeAdapter().fetchRecording(TEST_CALL_ID);
      expect(result.url).toBe('https://cdn.vapi.ai/recordings/fallback.mp3');
    });

    it('returns bytes=null when download fails (recording still processing)', async () => {
      const callResponse = {
        id: TEST_CALL_ID,
        recordingUrl: 'https://cdn.vapi.ai/recordings/abc.mp3',
      };
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => callResponse })
        .mockResolvedValueOnce({ ok: false }),
      );

      const result = await makeAdapter().fetchRecording(TEST_CALL_ID);
      expect(result.url).toBe('https://cdn.vapi.ai/recordings/abc.mp3');
      expect(result.bytes).toBeNull();
    });

    it('throws VoiceProviderError when no recording URL is present', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: TEST_CALL_ID }),
      }));

      await expect(makeAdapter().fetchRecording(TEST_CALL_ID)).rejects.toThrow(
        'vapi.recording_not_available',
      );
    });
  });

  describe('fetchTranscript', () => {
    it('maps assistant messages to agent speaker', async () => {
      const callResponse = {
        id: TEST_CALL_ID,
        artifact: {
          messages: [
            { role: 'assistant', message: 'Ciao!', secondsFromStart: 1.0, endTime: 2.0 },
            { role: 'user', message: 'Ciao a lei.', secondsFromStart: 2.5, endTime: 4.0 },
          ],
        },
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => callResponse,
      }));

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

    it('filters out non-conversation roles (tool, system)', async () => {
      const callResponse = {
        id: TEST_CALL_ID,
        messages: [
          { role: 'system', message: 'System message', secondsFromStart: 0 },
          { role: 'assistant', message: 'Buongiorno.', secondsFromStart: 0.5, endTime: 1.5 },
          { role: 'tool', content: '{}', secondsFromStart: 1.5 },
          { role: 'user', message: 'Sì.', secondsFromStart: 2.0, endTime: 3.0 },
        ],
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => callResponse,
      }));

      const segments = await makeAdapter().fetchTranscript(TEST_CALL_ID);
      expect(segments).toHaveLength(2);
      expect(segments[0]!.speaker).toBe('agent');
      expect(segments[1]!.speaker).toBe('caller');
    });

    it('returns empty array when call has no messages', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: TEST_CALL_ID }),
      }));

      const segments = await makeAdapter().fetchTranscript(TEST_CALL_ID);
      expect(segments).toEqual([]);
    });

    it('prefers artifact.messages over top-level messages', async () => {
      const callResponse = {
        id: TEST_CALL_ID,
        messages: [{ role: 'assistant', message: 'Top-level', secondsFromStart: 0, endTime: 1 }],
        artifact: {
          messages: [
            { role: 'assistant', message: 'Artifact message', secondsFromStart: 0, endTime: 1 },
          ],
        },
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => callResponse,
      }));

      const segments = await makeAdapter().fetchTranscript(TEST_CALL_ID);
      expect(segments[0]!.text).toBe('Artifact message');
    });
  });

  describe('VoiceProviderError', () => {
    it('has correct name, code, and detail', () => {
      const err = new VoiceProviderError('vapi.create_call_failed', 'Bad request body');
      expect(err.name).toBe('VoiceProviderError');
      expect(err.code).toBe('vapi.create_call_failed');
      expect(err.detail).toBe('Bad request body');
      expect(err.message).toBe('[vapi.create_call_failed] Bad request body');
      expect(err).toBeInstanceOf(Error);
    });
  });
});

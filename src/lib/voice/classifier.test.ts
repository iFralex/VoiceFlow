import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/env', () => ({
  env: {
    OPENAI_API_KEY: 'sk-test-key',
  },
}));

// ─── Module under test ────────────────────────────────────────────────────────

import { classifyTranscript, CALL_OUTCOME_VALUES } from './classifier';
import type { TranscriptSegment } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SEGMENTS: TranscriptSegment[] = [
  { speaker: 'agent', text: 'Buongiorno, parlo con Mario Rossi?', startMs: 0, endMs: 2000 },
  { speaker: 'caller', text: 'Sì, sono io.', startMs: 2100, endMs: 3500 },
  { speaker: 'agent', text: 'La chiamo da parte della concessionaria ABC.', startMs: 3600, endMs: 6000 },
  { speaker: 'caller', text: 'Grazie, ma non sono interessato.', startMs: 6100, endMs: 8000 },
];

function makeOpenAIResponse(result: { outcome: string; confidence: number; reasoning: string }) {
  return {
    choices: [{ message: { content: JSON.stringify(result) } }],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CALL_OUTCOME_VALUES', () => {
  it('contains all seven outcome values', () => {
    expect(CALL_OUTCOME_VALUES).toHaveLength(7);
    expect(CALL_OUTCOME_VALUES).toContain('interested');
    expect(CALL_OUTCOME_VALUES).toContain('not_interested');
    expect(CALL_OUTCOME_VALUES).toContain('appointment_booked');
    expect(CALL_OUTCOME_VALUES).toContain('wrong_number');
    expect(CALL_OUTCOME_VALUES).toContain('callback_requested');
    expect(CALL_OUTCOME_VALUES).toContain('voicemail_left');
    expect(CALL_OUTCOME_VALUES).toContain('do_not_call');
  });
});

describe('classifyTranscript', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the classification from OpenAI', async () => {
    const apiResult = { outcome: 'not_interested', confidence: 0.92, reasoning: 'Caller explicitly said not interested.' };
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => makeOpenAIResponse(apiResult),
    } as Response);

    const result = await classifyTranscript(SEGMENTS);

    expect(result.outcome).toBe('not_interested');
    expect(result.confidence).toBeCloseTo(0.92);
    expect(result.reasoning).toBe('Caller explicitly said not interested.');
  });

  it('sends request to correct OpenAI endpoint', async () => {
    const apiResult = { outcome: 'interested', confidence: 0.8, reasoning: 'Caller asked for more info.' };
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => makeOpenAIResponse(apiResult),
    } as Response);

    await classifyTranscript(SEGMENTS);

    expect(fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-test-key',
        }),
      }),
    );
  });

  it('includes transcript text in the request body', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => makeOpenAIResponse({ outcome: 'not_interested', confidence: 0.9, reasoning: 'test' }),
    } as Response);

    await classifyTranscript(SEGMENTS);

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    const userMessage = body.messages.find((m: { role: string }) => m.role === 'user');
    expect(userMessage.content).toContain('Buongiorno, parlo con Mario Rossi?');
    expect(userMessage.content).toContain('[Agent]:');
    expect(userMessage.content).toContain('[Caller]:');
  });

  it('uses gpt-4o-mini model', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => makeOpenAIResponse({ outcome: 'not_interested', confidence: 0.8, reasoning: 'test' }),
    } as Response);

    await classifyTranscript(SEGMENTS);

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('gpt-4o-mini');
  });

  it('uses structured output response_format', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => makeOpenAIResponse({ outcome: 'interested', confidence: 0.75, reasoning: 'Caller curious.' }),
    } as Response);

    await classifyTranscript(SEGMENTS);

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.response_format?.type).toBe('json_schema');
    expect(body.response_format?.json_schema?.schema?.properties?.outcome?.enum).toEqual(
      expect.arrayContaining(['not_interested', 'appointment_booked']),
    );
  });

  it('handles empty transcript gracefully', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => makeOpenAIResponse({ outcome: 'voicemail_left', confidence: 0.6, reasoning: 'No speech.' }),
    } as Response);

    const result = await classifyTranscript([]);

    expect(result.outcome).toBe('voicemail_left');
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    const userMessage = body.messages.find((m: { role: string }) => m.role === 'user');
    expect(userMessage.content).toContain('(empty transcript)');
  });

  it('clamps confidence above 1.0 to 1.0', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => makeOpenAIResponse({ outcome: 'not_interested', confidence: 1.5, reasoning: 'over-confident' }),
    } as Response);

    const result = await classifyTranscript(SEGMENTS);
    expect(result.confidence).toBe(1.0);
  });

  it('clamps confidence below 0.0 to 0.0', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => makeOpenAIResponse({ outcome: 'not_interested', confidence: -0.3, reasoning: 'negative' }),
    } as Response);

    const result = await classifyTranscript(SEGMENTS);
    expect(result.confidence).toBe(0.0);
  });

  it('throws when OpenAI returns a non-ok status', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'Rate limit exceeded',
    } as Response);

    await expect(classifyTranscript(SEGMENTS)).rejects.toThrow('OpenAI API error (429)');
  });

  it('throws when the response has no content', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: null } }] }),
    } as Response);

    await expect(classifyTranscript(SEGMENTS)).rejects.toThrow('Empty response content from OpenAI');
  });

  it('throws when OPENAI_API_KEY is not configured', async () => {
    const { env } = await import('@/lib/env');
    const saved = env.OPENAI_API_KEY;
    // Temporarily clear the key on the mocked env object
    (env as Record<string, unknown>)['OPENAI_API_KEY'] = undefined;

    try {
      await expect(classifyTranscript(SEGMENTS)).rejects.toThrow('OPENAI_API_KEY is not configured');
    } finally {
      (env as Record<string, unknown>)['OPENAI_API_KEY'] = saved;
    }
  });
});

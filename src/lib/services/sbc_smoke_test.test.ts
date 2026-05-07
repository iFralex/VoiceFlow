/**
 * Unit tests for the SBC smoke test (plan 10 task 15).
 *
 * The DB context, the Vapi adapter, and the polling fetch are all stubbed so
 * these tests cover the decision tree (no candidate, createCall throws,
 * timeout, duration assertion, ended-reason assertion) without standing up
 * Postgres or hitting Vapi. Integration coverage of the SQL candidate query
 * lives in `sbc_smoke_test.integration.test.ts` (when added — out of scope
 * for the task as plan 10 task 15 only mandates the script and the cron).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockWithSystemContext, mockEnv, mockSendInngestEvent } = vi.hoisted(() => {
  const mockWithSystemContext = vi.fn(
    async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  );
  const mockEnv: {
    SBC_SMOKE_TEST_NUMBER?: string;
    VAPI_API_KEY?: string;
    NEXT_PUBLIC_APP_URL: string;
  } = {
    SBC_SMOKE_TEST_NUMBER: '+393331234567',
    VAPI_API_KEY: 'vapi-test-key',
    NEXT_PUBLIC_APP_URL: 'https://app.example.com',
  };
  const mockSendInngestEvent = vi.fn(async () => undefined);
  return { mockWithSystemContext, mockEnv, mockSendInngestEvent };
});

vi.mock('@/lib/db/context', () => ({
  withSystemContext: mockWithSystemContext,
}));

vi.mock('@/lib/db/schema', () => ({
  phoneNumbers: {
    id: 'pn_id',
    e164: 'pn_e164',
    org_id: 'pn_org_id',
    provider: 'pn_provider',
    provider_external_id: 'pn_provider_external_id',
    status: 'pn_status',
    daily_call_count: 'pn_daily_call_count',
    last_used_at: 'pn_last_used_at',
  },
}));

vi.mock('@/lib/env', () => ({ env: mockEnv }));

vi.mock('@/lib/inngest/client', () => ({
  sendInngestEvent: mockSendInngestEvent,
}));

// Drizzle helpers are opaque tags — the mocked tx ignores them.
vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ kind: 'and', args }),
  asc: (col: unknown) => ({ kind: 'asc', col }),
  eq: (col: unknown, val: unknown) => ({ kind: 'eq', col, val }),
  isNotNull: (col: unknown) => ({ kind: 'isNotNull', col }),
  isNull: (col: unknown) => ({ kind: 'isNull', col }),
}));

import { VoiceProviderError } from '@/lib/voice/errors';

import {
  ALLOWED_ENDED_REASONS,
  DEFAULT_POLL_INTERVAL_MS,
  DURATION_THRESHOLD_SECONDS,
  runSbcSmokeTest,
} from './sbc_smoke_test';

interface PoolRow {
  id: string;
  e164: string;
  provider_external_id: string | null;
  provider: string;
}

function makeMockTx(rows: PoolRow[]): unknown {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn().mockResolvedValue(rows),
        })),
      })),
    })),
  };
}

function setPoolRows(rows: PoolRow[]): void {
  mockWithSystemContext.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => fn(makeMockTx(rows)),
  );
}

interface MockAdapterOptions {
  createCallReturn?: { providerCallId: string };
  createCallThrow?: Error;
}

function makeAdapter(options: MockAdapterOptions = {}): {
  createCall: ReturnType<typeof vi.fn>;
} {
  const createCall = vi.fn(async () => {
    if (options.createCallThrow) throw options.createCallThrow;
    return options.createCallReturn ?? { providerCallId: 'vapi-call-default' };
  });
  return { createCall };
}

function makeFetchSequence(
  responses: Array<
    | { ok: true; body: Record<string, unknown> }
    | { ok: false; status: number }
  >,
): typeof fetch {
  let i = 0;
  return vi.fn(async () => {
    const r = responses[Math.min(i++, responses.length - 1)]!;
    if (r.ok) {
      return {
        ok: true,
        status: 200,
        json: async () => r.body,
      } as unknown as Response;
    }
    return {
      ok: false,
      status: r.status,
      text: async () => `http_${r.status}`,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

const HAPPY_PATH_ROW: PoolRow = {
  id: 'pn-1',
  e164: '+390299990001',
  provider_external_id: 'vapi-pn-abc',
  provider: 'voiped',
};

const VAPI_CALL_ID = 'vapi-call-xyz';

describe('runSbcSmokeTest', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockEnv.SBC_SMOKE_TEST_NUMBER = '+393331234567';
    mockEnv.VAPI_API_KEY = 'vapi-test-key';
    mockEnv.NEXT_PUBLIC_APP_URL = 'https://app.example.com';
    mockWithSystemContext.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(makeMockTx([])),
    );
    mockSendInngestEvent.mockResolvedValue(undefined);
  });

  it('emits no_test_number_configured when SBC_SMOKE_TEST_NUMBER is unset', async () => {
    delete mockEnv.SBC_SMOKE_TEST_NUMBER;
    const emit = vi.fn();
    const result = await runSbcSmokeTest({ emit });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_test_number_configured');
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'no_test_number_configured' }),
    );
    expect(mockWithSystemContext).not.toHaveBeenCalled();
  });

  it('emits no_candidate_cli when the pool has no active SBC rows', async () => {
    setPoolRows([]);
    const emit = vi.fn();
    const adapter = makeAdapter() as unknown as ConstructorParameters<
      typeof Object
    >[0];
    const result = await runSbcSmokeTest({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      adapter: adapter as any,
      emit,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_candidate_cli');
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'no_candidate_cli' }),
    );
  });

  it('emits no_candidate_cli when the only candidates are Twilio fallback CLIs', async () => {
    // Twilio is not part of SBC_PROVIDERS; selecting a Twilio CLI here would
    // exercise the wrong trunk so the smoke test should refuse.
    setPoolRows([
      {
        id: 'pn-twilio',
        e164: '+390666666666',
        provider_external_id: 'vapi-pn-twilio',
        provider: 'twilio',
      },
    ]);
    const emit = vi.fn();
    const adapter = makeAdapter();
    const result = await runSbcSmokeTest({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      adapter: adapter as any,
      emit,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_candidate_cli');
  });

  it('emits create_call_failed when the selected CLI has no provider_external_id', async () => {
    setPoolRows([{ ...HAPPY_PATH_ROW, provider_external_id: null }]);
    const emit = vi.fn();
    const adapter = makeAdapter();
    const result = await runSbcSmokeTest({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      adapter: adapter as any,
      emit,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('create_call_failed');
    expect(result.detail).toContain('provider_external_id');
    expect(adapter.createCall).not.toHaveBeenCalled();
  });

  it('emits create_call_failed when Vapi createCall throws a VoiceProviderError', async () => {
    setPoolRows([HAPPY_PATH_ROW]);
    const emit = vi.fn();
    const adapter = makeAdapter({
      createCallThrow: new VoiceProviderError(
        'vapi.create_call_failed',
        'trunk auth rejected',
      ),
    });
    const result = await runSbcSmokeTest({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      adapter: adapter as any,
      emit,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('create_call_failed');
    expect(result.detail).toContain('vapi.create_call_failed');
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'create_call_failed',
        e164: HAPPY_PATH_ROW.e164,
        phoneNumberId: HAPPY_PATH_ROW.id,
      }),
    );
  });

  it('emits timeout_waiting_for_end when the call never reaches `ended` status', async () => {
    setPoolRows([HAPPY_PATH_ROW]);
    const emit = vi.fn();
    const adapter = makeAdapter({ createCallReturn: { providerCallId: VAPI_CALL_ID } });

    // Always return in-progress status — every poll falls through to sleep.
    const fetchImpl = makeFetchSequence([
      { ok: true, body: { id: VAPI_CALL_ID, status: 'in-progress' } },
    ]);

    // Fake clock: each call advances by 5 seconds. Timeout 10s → 3 polls then deadline.
    let nowMs = 0;
    const result = await runSbcSmokeTest({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      adapter: adapter as any,
      emit,
      fetchImpl,
      timeoutMs: 10_000,
      pollIntervalMs: 5_000,
      now: () => {
        const t = nowMs;
        nowMs += 5_000;
        return t;
      },
      sleep: async () => undefined,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('timeout_waiting_for_end');
    expect(result.providerCallId).toBe(VAPI_CALL_ID);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'timeout_waiting_for_end' }),
    );
  });

  it('emits duration_too_short when the call ends in ≤ 2s', async () => {
    setPoolRows([HAPPY_PATH_ROW]);
    const emit = vi.fn();
    const adapter = makeAdapter({ createCallReturn: { providerCallId: VAPI_CALL_ID } });

    const fetchImpl = makeFetchSequence([
      {
        ok: true,
        body: {
          id: VAPI_CALL_ID,
          status: 'ended',
          endedReason: 'hangup',
          startedAt: '2026-05-07T03:00:00.000Z',
          endedAt: '2026-05-07T03:00:01.500Z', // 1.5s
        },
      },
    ]);

    const result = await runSbcSmokeTest({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      adapter: adapter as any,
      emit,
      fetchImpl,
      now: () => 0,
      sleep: async () => undefined,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('duration_too_short');
    expect(result.durationSeconds).toBeCloseTo(1.5, 5);
    expect(result.endedReason).toBe('hangup');
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'duration_too_short',
        durationSeconds: 1.5,
      }),
    );
  });

  it('emits unexpected_ended_reason for endedReason outside the allowlist', async () => {
    setPoolRows([HAPPY_PATH_ROW]);
    const emit = vi.fn();
    const adapter = makeAdapter({ createCallReturn: { providerCallId: VAPI_CALL_ID } });

    const fetchImpl = makeFetchSequence([
      {
        ok: true,
        body: {
          id: VAPI_CALL_ID,
          status: 'ended',
          endedReason: 'pipeline-error',
          startedAt: '2026-05-07T03:00:00.000Z',
          endedAt: '2026-05-07T03:00:08.000Z', // 8s — duration is fine
        },
      },
    ]);

    const result = await runSbcSmokeTest({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      adapter: adapter as any,
      emit,
      fetchImpl,
      now: () => 0,
      sleep: async () => undefined,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unexpected_ended_reason');
    expect(result.endedReason).toBe('pipeline-error');
    expect(result.durationSeconds).toBeCloseTo(8, 5);
  });

  it('returns ok:true and does NOT emit when the call ends with an allowed reason and > 2s', async () => {
    setPoolRows([HAPPY_PATH_ROW]);
    const emit = vi.fn();
    const adapter = makeAdapter({ createCallReturn: { providerCallId: VAPI_CALL_ID } });

    const fetchImpl = makeFetchSequence([
      {
        ok: true,
        body: {
          id: VAPI_CALL_ID,
          status: 'ended',
          endedReason: 'silence-timeout',
          startedAt: '2026-05-07T03:00:00.000Z',
          endedAt: '2026-05-07T03:00:09.000Z',
        },
      },
    ]);

    const result = await runSbcSmokeTest({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      adapter: adapter as any,
      emit,
      fetchImpl,
      now: () => 0,
      sleep: async () => undefined,
    });

    expect(result.ok).toBe(true);
    expect(result.endedReason).toBe('silence-timeout');
    expect(result.durationSeconds).toBeCloseTo(9, 5);
    expect(result.providerCallId).toBe(VAPI_CALL_ID);
    expect(emit).not.toHaveBeenCalled();
  });

  it('treats fetch network errors as "not ended yet" and keeps polling instead of throwing', async () => {
    // The cron route depends on runSbcSmokeTest never throwing. A DNS / TCP
    // glitch during polling must not bubble out — it should be classified
    // identically to a 5xx blip and continue polling until the call ends or
    // the timeout elapses.
    setPoolRows([HAPPY_PATH_ROW]);
    const emit = vi.fn();
    const adapter = makeAdapter({ createCallReturn: { providerCallId: VAPI_CALL_ID } });

    let polls = 0;
    const fetchImpl = vi.fn(async () => {
      polls += 1;
      if (polls <= 2) throw new Error('ECONNRESET');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: VAPI_CALL_ID,
          status: 'ended',
          endedReason: 'hangup',
          startedAt: '2026-05-07T03:00:00.000Z',
          endedAt: '2026-05-07T03:00:05.000Z',
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    let nowMs = 0;
    const result = await runSbcSmokeTest({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      adapter: adapter as any,
      emit,
      fetchImpl,
      timeoutMs: 60_000,
      pollIntervalMs: 1_000,
      now: () => {
        const t = nowMs;
        nowMs += 1_000;
        return t;
      },
      sleep: async () => undefined,
    });

    expect(result.ok).toBe(true);
    expect(result.endedReason).toBe('hangup');
    expect(polls).toBe(3);
  });

  it('treats transient HTTP errors as "not ended yet" and keeps polling until timeout', async () => {
    setPoolRows([HAPPY_PATH_ROW]);
    const emit = vi.fn();
    const adapter = makeAdapter({ createCallReturn: { providerCallId: VAPI_CALL_ID } });

    const fetchImpl = makeFetchSequence([
      { ok: false, status: 502 },
      { ok: false, status: 502 },
      {
        ok: true,
        body: {
          id: VAPI_CALL_ID,
          status: 'ended',
          endedReason: 'hangup',
          startedAt: '2026-05-07T03:00:00.000Z',
          endedAt: '2026-05-07T03:00:05.000Z',
        },
      },
    ]);

    let nowMs = 0;
    const result = await runSbcSmokeTest({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      adapter: adapter as any,
      emit,
      fetchImpl,
      timeoutMs: 60_000,
      pollIntervalMs: 1_000,
      now: () => {
        const t = nowMs;
        nowMs += 1_000;
        return t;
      },
      sleep: async () => undefined,
    });

    expect(result.ok).toBe(true);
    expect(result.endedReason).toBe('hangup');
  });

  it('passes the test number, picked CLI, and webhook URL to Vapi.createCall', async () => {
    setPoolRows([HAPPY_PATH_ROW]);
    const adapter = makeAdapter({ createCallReturn: { providerCallId: VAPI_CALL_ID } });
    const fetchImpl = makeFetchSequence([
      {
        ok: true,
        body: {
          id: VAPI_CALL_ID,
          status: 'ended',
          endedReason: 'hangup',
          startedAt: '2026-05-07T03:00:00.000Z',
          endedAt: '2026-05-07T03:00:05.000Z',
        },
      },
    ]);

    await runSbcSmokeTest({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      adapter: adapter as any,
      fetchImpl,
      now: () => 0,
      sleep: async () => undefined,
    });

    expect(adapter.createCall).toHaveBeenCalledTimes(1);
    const args = adapter.createCall.mock.calls[0]![0] as {
      toNumber: string;
      fromNumber: string;
      webhookUrl: string;
      language: string;
    };
    expect(args.toNumber).toBe('+393331234567');
    expect(args.fromNumber).toBe(HAPPY_PATH_ROW.provider_external_id);
    expect(args.webhookUrl).toBe('https://app.example.com/api/webhooks/vapi');
    expect(args.language).toBe('it-IT');
  });

  it('exports the documented constants', () => {
    expect(ALLOWED_ENDED_REASONS).toEqual(['hangup', 'silence-timeout']);
    expect(DURATION_THRESHOLD_SECONDS).toBe(2);
    expect(DEFAULT_POLL_INTERVAL_MS).toBeGreaterThan(0);
  });
});

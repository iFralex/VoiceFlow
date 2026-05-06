/**
 * Unit tests for the `/api/cron/sbc-smoke-test` route handler (plan 10 task 15).
 * The smoke-test logic itself is mocked — service-level behaviour is covered by
 * `src/lib/services/sbc_smoke_test.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRunSbcSmokeTest, mockEnv } = vi.hoisted(() => {
  const mockRunSbcSmokeTest = vi.fn();
  const mockEnv = { CRON_SECRET: 'test-cron-secret-16chars' };
  return { mockRunSbcSmokeTest, mockEnv };
});

vi.mock('@/lib/services/sbc_smoke_test', () => ({
  runSbcSmokeTest: mockRunSbcSmokeTest,
}));

vi.mock('@/lib/env', () => ({ env: mockEnv }));

import { GET } from './route';

const CRON_SECRET = 'test-cron-secret-16chars';

function makeRequest(secret?: string): Request {
  return new Request('http://localhost/api/cron/sbc-smoke-test', {
    method: 'GET',
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

describe('GET /api/cron/sbc-smoke-test', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockEnv.CRON_SECRET = CRON_SECRET;
    mockRunSbcSmokeTest.mockResolvedValue({
      ok: true,
      e164: '+390299990001',
      providerCallId: 'vapi-call-123',
      durationSeconds: 7.5,
      endedReason: 'hangup',
    });
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockRunSbcSmokeTest).not.toHaveBeenCalled();
  });

  it('returns 401 when bearer token does not match CRON_SECRET', async () => {
    const res = await GET(makeRequest('wrong-secret-16chars-xx'));
    expect(res.status).toBe(401);
    expect(mockRunSbcSmokeTest).not.toHaveBeenCalled();
  });

  it('returns 200 with the success result on a healthy smoke test', async () => {
    const res = await GET(makeRequest(CRON_SECRET));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; endedReason: string };
    expect(json.ok).toBe(true);
    expect(json.endedReason).toBe('hangup');
  });

  it('still returns 200 on smoke-test failure (Inngest carries the alert)', async () => {
    mockRunSbcSmokeTest.mockResolvedValueOnce({
      ok: false,
      reason: 'unexpected_ended_reason',
      detail: 'endedReason="pipeline-error" not in [hangup, silence-timeout]',
      e164: '+390299990001',
      providerCallId: 'vapi-call-456',
      durationSeconds: 4.2,
      endedReason: 'pipeline-error',
    });

    const res = await GET(makeRequest(CRON_SECRET));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      reason: string;
      detail: string;
    };
    expect(json.ok).toBe(false);
    expect(json.reason).toBe('unexpected_ended_reason');
    expect(json.detail).toContain('pipeline-error');
  });
});

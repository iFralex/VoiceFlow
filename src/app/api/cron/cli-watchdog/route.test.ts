import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRunWatchdog, mockClearStaleSbcUnhealthyFlag, mockEnv } = vi.hoisted(() => {
  const mockRunWatchdog = vi.fn();
  const mockClearStaleSbcUnhealthyFlag = vi.fn();
  const mockEnv = { CRON_SECRET: 'test-cron-secret-16chars' };
  return { mockRunWatchdog, mockClearStaleSbcUnhealthyFlag, mockEnv };
});

vi.mock('@/lib/services/cli_watchdog', () => ({
  runWatchdog: mockRunWatchdog,
}));

vi.mock('@/lib/services/system_flags', () => ({
  clearStaleSbcUnhealthyFlag: mockClearStaleSbcUnhealthyFlag,
}));

vi.mock('@/lib/env', () => ({ env: mockEnv }));

import { GET } from './route';

const CRON_SECRET = 'test-cron-secret-16chars';

function makeRequest(secret?: string): Request {
  return new Request('http://localhost/api/cron/cli-watchdog', {
    method: 'GET',
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

describe('GET /api/cron/cli-watchdog', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockEnv.CRON_SECRET = CRON_SECRET;
    mockRunWatchdog.mockResolvedValue({ evaluated: 5, transitions: [] });
    mockClearStaleSbcUnhealthyFlag.mockResolvedValue(false);
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockRunWatchdog).not.toHaveBeenCalled();
  });

  it('returns 401 when bearer token does not match CRON_SECRET', async () => {
    // Same length as CRON_SECRET ("test-cron-secret-16chars" → 24 chars)
    // so the timing-safe compare runs (length-mismatch short-circuit avoided).
    const res = await GET(makeRequest('wrong-cron-secret-16chrs'));
    expect(res.status).toBe(401);
    expect(mockRunWatchdog).not.toHaveBeenCalled();
  });

  it('returns 200 with the watchdog summary on a valid request', async () => {
    mockRunWatchdog.mockResolvedValueOnce({
      evaluated: 12,
      transitions: [
        {
          phoneNumberId: 'pn-1',
          e164: '+390299990001',
          from: 'active',
          to: 'cooling_down',
          spamScore: 78,
          cooldownsInWindow: 1,
        },
      ],
    });

    const res = await GET(makeRequest(CRON_SECRET));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      evaluated: number;
      transitions: Array<{ to: string }>;
      sbcFlagCleared: boolean;
    };
    expect(json.ok).toBe(true);
    expect(json.evaluated).toBe(12);
    expect(json.transitions).toHaveLength(1);
    expect(json.transitions[0]?.to).toBe('cooling_down');
    expect(json.sbcFlagCleared).toBe(false);
  });

  it('garbage-collects a stale SBC unhealthy flag and surfaces the result', async () => {
    mockClearStaleSbcUnhealthyFlag.mockResolvedValueOnce(true);

    const res = await GET(makeRequest(CRON_SECRET));
    expect(res.status).toBe(200);
    expect(mockClearStaleSbcUnhealthyFlag).toHaveBeenCalledOnce();
    const json = (await res.json()) as { sbcFlagCleared: boolean };
    expect(json.sbcFlagCleared).toBe(true);
  });

  it('still returns 200 if clearStaleSbcUnhealthyFlag throws', async () => {
    mockClearStaleSbcUnhealthyFlag.mockRejectedValueOnce(new Error('db down'));

    const res = await GET(makeRequest(CRON_SECRET));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { sbcFlagCleared: boolean };
    expect(json.sbcFlagCleared).toBe(false);
  });
});

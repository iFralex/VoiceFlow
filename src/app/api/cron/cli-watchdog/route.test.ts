import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRunWatchdog, mockEnv } = vi.hoisted(() => {
  const mockRunWatchdog = vi.fn();
  const mockEnv = { CRON_SECRET: 'test-cron-secret-16chars' };
  return { mockRunWatchdog, mockEnv };
});

vi.mock('@/lib/services/cli_watchdog', () => ({
  runWatchdog: mockRunWatchdog,
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
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockRunWatchdog).not.toHaveBeenCalled();
  });

  it('returns 401 when bearer token does not match CRON_SECRET', async () => {
    const res = await GET(makeRequest('wrong-secret-16chars-xx'));
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
    };
    expect(json.ok).toBe(true);
    expect(json.evaluated).toBe(12);
    expect(json.transitions).toHaveLength(1);
    expect(json.transitions[0]?.to).toBe('cooling_down');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRunDailyReport, mockEnv } = vi.hoisted(() => {
  const mockRunDailyReport = vi.fn();
  const mockEnv = { CRON_SECRET: 'test-cron-secret-16chars' };
  return { mockRunDailyReport, mockEnv };
});

vi.mock('@/lib/services/daily-report', () => ({
  runDailyReport: mockRunDailyReport,
}));

vi.mock('@/lib/env', () => ({ env: mockEnv }));

import { GET } from './route';

const CRON_SECRET = 'test-cron-secret-16chars';

function makeRequest(secret?: string): Request {
  return new Request('http://localhost/api/cron/daily-report', {
    method: 'GET',
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

describe('GET /api/cron/daily-report', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockEnv.CRON_SECRET = CRON_SECRET;
    mockRunDailyReport.mockResolvedValue({
      range: {
        start: new Date('2026-05-07T22:00:00Z'),
        end: new Date('2026-05-08T21:59:59.999Z'),
        reportDate: new Date('2026-05-07T22:00:00Z'),
      },
      orgsConsidered: 2,
      orgsProcessed: 2,
      orgsSkipped: 0,
      orgsFailed: 0,
      emailsSent: 4,
      outcomes: [],
    });
  });

  it('returns 401 when the Authorization header is missing', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockRunDailyReport).not.toHaveBeenCalled();
  });

  it('returns 401 when the bearer token does not match CRON_SECRET', async () => {
    const res = await GET(makeRequest('wrong-secret-16chars-xx'));
    expect(res.status).toBe(401);
    expect(mockRunDailyReport).not.toHaveBeenCalled();
  });

  it('runs the dispatcher and returns the per-org tallies on success', async () => {
    const res = await GET(makeRequest(CRON_SECRET));
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      ok: boolean;
      orgsConsidered: number;
      orgsProcessed: number;
      orgsSkipped: number;
      orgsFailed: number;
      emailsSent: number;
      range: { start: string; end: string };
    };

    expect(body.ok).toBe(true);
    expect(body.orgsConsidered).toBe(2);
    expect(body.orgsProcessed).toBe(2);
    expect(body.orgsFailed).toBe(0);
    expect(body.emailsSent).toBe(4);
    expect(body.range.start).toBe('2026-05-07T22:00:00.000Z');
    expect(mockRunDailyReport).toHaveBeenCalledTimes(1);
  });
});

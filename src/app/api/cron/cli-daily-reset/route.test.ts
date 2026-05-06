import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockWithSystemContext, mockUpdate, mockEnv } = vi.hoisted(() => {
  const mockUpdate = vi.fn();
  const mockTx = { update: mockUpdate };
  const mockWithSystemContext = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockTx));
  const mockEnv = { CRON_SECRET: 'test-cron-secret-16chars' };
  return { mockWithSystemContext, mockUpdate, mockEnv };
});

vi.mock('@/lib/db/context', () => ({
  withSystemContext: mockWithSystemContext,
}));

vi.mock('@/lib/env', () => ({
  env: mockEnv,
}));

vi.mock('@/lib/db/schema', () => ({
  phoneNumbers: {
    id: 'pn_id',
    daily_call_count: 'pn_daily_call_count',
  },
}));

vi.mock('drizzle-orm', () => ({
  ne: (col: unknown, val: unknown) => ({ type: 'ne', col, val }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { GET, resetDailyCallCounts } from './route';

const CRON_SECRET = 'test-cron-secret-16chars';

function makeRequest(secret?: string): Request {
  return new Request('http://localhost/api/cron/cli-daily-reset', {
    method: 'GET',
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

function makeUpdateChain(returningRows: unknown[]) {
  return vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue(returningRows),
      })),
    })),
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/cron/cli-daily-reset', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockEnv.CRON_SECRET = CRON_SECRET;
    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ update: mockUpdate }),
    );
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Unauthorized');
  });

  it('returns 401 when bearer token does not match CRON_SECRET', async () => {
    const res = await GET(makeRequest('wrong-secret-16chars-x'));
    expect(res.status).toBe(401);
  });

  it('returns 200 with reset count on a valid request', async () => {
    mockUpdate.mockImplementationOnce(
      makeUpdateChain([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]),
    );

    const res = await GET(makeRequest(CRON_SECRET));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; reset: number };
    expect(json.ok).toBe(true);
    expect(json.reset).toBe(3);
  });

  it('returns reset:0 when every CLI is already at 0', async () => {
    mockUpdate.mockImplementationOnce(makeUpdateChain([]));

    const res = await GET(makeRequest(CRON_SECRET));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; reset: number };
    expect(json.reset).toBe(0);
  });
});

describe('resetDailyCallCounts', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ update: mockUpdate }),
    );
  });

  it('issues an update wrapped in withSystemContext and reports the row count', async () => {
    mockUpdate.mockImplementationOnce(makeUpdateChain([{ id: 'p1' }, { id: 'p2' }]));

    const result = await resetDailyCallCounts();
    expect(result).toEqual({ reset: 2 });
    expect(mockWithSystemContext).toHaveBeenCalledOnce();
    expect(mockUpdate).toHaveBeenCalledOnce();
  });

  it('skips rows already at 0 via the ne(daily_call_count, 0) predicate', async () => {
    let observedWhereArg: unknown;
    mockUpdate.mockImplementationOnce(() => ({
      set: vi.fn(() => ({
        where: vi.fn((arg: unknown) => {
          observedWhereArg = arg;
          return { returning: vi.fn().mockResolvedValue([]) };
        }),
      })),
    }));

    await resetDailyCallCounts();
    expect(observedWhereArg).toMatchObject({
      type: 'ne',
      col: 'pn_daily_call_count',
      val: 0,
    });
  });

  it('sets daily_call_count to 0 in the update payload', async () => {
    let observedSetArg: unknown;
    mockUpdate.mockImplementationOnce(() => ({
      set: vi.fn((arg: unknown) => {
        observedSetArg = arg;
        return {
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([]),
          })),
        };
      }),
    }));

    await resetDailyCallCounts();
    expect(observedSetArg).toEqual({ daily_call_count: 0 });
  });
});

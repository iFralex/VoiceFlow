import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockWithSystemContext, mockEnv } = vi.hoisted(() => {
  const mockWithSystemContext = vi.fn();
  const mockEnv = { CRON_SECRET: 'test-cron-secret-16chars' };

  return { mockWithSystemContext, mockEnv };
});

vi.mock('@/lib/db/context', () => ({
  withSystemContext: mockWithSystemContext,
}));

vi.mock('@/lib/env', () => ({
  env: mockEnv,
}));

vi.mock('@/lib/db/schema', () => ({
  campaigns: {
    id: 'c_id',
    org_id: 'c_org_id',
    status: 'c_status',
  },
  calls: {
    campaign_id: 'cl_campaign_id',
    status: 'cl_status',
    outcome: 'cl_outcome',
    billable_seconds: 'cl_billable_seconds',
    cost_cents: 'cl_cost_cents',
  },
  campaignStats: {
    campaign_id: 'cs_campaign_id',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ type: 'eq', col, val }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.raw.join('') + values.join(''),
    { raw: (s: string) => s },
  ),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { GET, aggregateCampaignStats, aggregateOneCampaign } from './route';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CAMPAIGN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const ORG_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002';
const CRON_SECRET = 'test-cron-secret-16chars';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSelectMock(rows: unknown[]) {
  return vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(rows),
    })),
  }));
}

function makeAggregateSelectMock(statsRow: Record<string, number>) {
  return vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn().mockResolvedValue([statsRow]),
    })),
  }));
}

function makeInsertMock() {
  return vi.fn(() => ({
    values: vi.fn(() => ({
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    })),
  }));
}

function makeRequest(secret?: string): Request {
  return new Request('http://localhost/api/cron/aggregate-campaigns', {
    method: 'GET',
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

const ZERO_STATS = {
  total_calls: 0,
  pending_calls: 0,
  dialing_calls: 0,
  in_progress_calls: 0,
  completed_calls: 0,
  failed_calls: 0,
  outcome_appointment_booked: 0,
  outcome_interested: 0,
  outcome_not_interested: 0,
  outcome_wrong_number: 0,
  outcome_callback: 0,
  outcome_voicemail: 0,
  outcome_do_not_call: 0,
  total_billed_seconds: 0,
  total_cost_cents: 0,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/cron/aggregate-campaigns', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockEnv.CRON_SECRET = CRON_SECRET;
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Unauthorized');
  });

  it('returns 401 when CRON_SECRET is not configured', async () => {
    mockEnv.CRON_SECRET = undefined as unknown as string;
    const res = await GET(makeRequest(CRON_SECRET));
    expect(res.status).toBe(401);
  });

  it('returns 401 when bearer token does not match CRON_SECRET', async () => {
    const res = await GET(makeRequest('wrong-secret'));
    expect(res.status).toBe(401);
  });

  it('returns 200 with ok:true and zero counts when no active campaigns', async () => {
    // First call: SELECT running/paused campaigns → empty
    mockWithSystemContext.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ select: makeSelectMock([]) }),
    );

    const res = await GET(makeRequest(CRON_SECRET));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; processed: number; errors: number };
    expect(json.ok).toBe(true);
    expect(json.processed).toBe(0);
    expect(json.errors).toBe(0);
  });

  it('returns 200 and processes one campaign', async () => {
    // 1. SELECT campaigns → one campaign
    mockWithSystemContext.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ select: makeSelectMock([{ id: CAMPAIGN_ID, org_id: ORG_ID }]) }),
    );
    // 2. SELECT aggregate stats for the campaign
    mockWithSystemContext.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ select: makeAggregateSelectMock(ZERO_STATS) }),
    );
    // 3. INSERT ... ON CONFLICT DO UPDATE
    mockWithSystemContext.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ insert: makeInsertMock() }),
    );

    const res = await GET(makeRequest(CRON_SECRET));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; processed: number; errors: number };
    expect(json.ok).toBe(true);
    expect(json.processed).toBe(1);
    expect(json.errors).toBe(0);
  });
});

describe('aggregateCampaignStats', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns zeros when no active campaigns', async () => {
    mockWithSystemContext.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ select: makeSelectMock([]) }),
    );

    const result = await aggregateCampaignStats();
    expect(result).toEqual({ processed: 0, errors: 0 });
  });

  it('processes multiple campaigns and reports count', async () => {
    const campaigns = [
      { id: CAMPAIGN_ID, org_id: ORG_ID },
      { id: 'cccccccc-cccc-4ccc-8ccc-000000000003', org_id: ORG_ID },
    ];

    // 1. SELECT campaigns
    mockWithSystemContext.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ select: makeSelectMock(campaigns) }),
    );
    // 2. Aggregate for campaign 1
    mockWithSystemContext.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ select: makeAggregateSelectMock(ZERO_STATS) }),
    );
    // 3. Upsert for campaign 1
    mockWithSystemContext.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ insert: makeInsertMock() }),
    );
    // 4. Aggregate for campaign 2
    mockWithSystemContext.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ select: makeAggregateSelectMock(ZERO_STATS) }),
    );
    // 5. Upsert for campaign 2
    mockWithSystemContext.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ insert: makeInsertMock() }),
    );

    const result = await aggregateCampaignStats();
    expect(result).toEqual({ processed: 2, errors: 0 });
  });

  it('counts errors without crashing when a campaign aggregation fails', async () => {
    // 1. SELECT campaigns
    mockWithSystemContext.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ select: makeSelectMock([{ id: CAMPAIGN_ID, org_id: ORG_ID }]) }),
    );
    // 2. Aggregate fails
    mockWithSystemContext.mockImplementationOnce(() => Promise.reject(new Error('DB error')));

    const result = await aggregateCampaignStats();
    expect(result).toEqual({ processed: 0, errors: 1 });
  });
});

describe('aggregateOneCampaign', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns early when aggregate query returns no rows', async () => {
    // Aggregate → no rows
    mockWithSystemContext.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([]),
          })),
        })),
      }),
    );

    await aggregateOneCampaign(CAMPAIGN_ID, ORG_ID);
    // Only one withSystemContext call (the aggregate); upsert skipped
    expect(mockWithSystemContext).toHaveBeenCalledTimes(1);
  });

  it('calls upsert with correct stats values', async () => {
    const statsRow = {
      total_calls: 10,
      pending_calls: 2,
      dialing_calls: 1,
      in_progress_calls: 1,
      completed_calls: 5,
      failed_calls: 1,
      outcome_appointment_booked: 3,
      outcome_interested: 1,
      outcome_not_interested: 1,
      outcome_wrong_number: 0,
      outcome_callback: 0,
      outcome_voicemail: 0,
      outcome_do_not_call: 0,
      total_billed_seconds: 300,
      total_cost_cents: 150,
    };

    // 1. Aggregate query
    mockWithSystemContext.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ select: makeAggregateSelectMock(statsRow) }),
    );

    const mockInsertFn = vi.fn();
    const mockValuesFn = vi.fn();
    const mockOnConflictFn = vi.fn().mockResolvedValue(undefined);
    mockInsertFn.mockReturnValue({ values: mockValuesFn });
    mockValuesFn.mockReturnValue({ onConflictDoUpdate: mockOnConflictFn });

    // 2. Upsert
    mockWithSystemContext.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ insert: mockInsertFn }),
    );

    await aggregateOneCampaign(CAMPAIGN_ID, ORG_ID);

    expect(mockInsertFn).toHaveBeenCalledTimes(1);
    expect(mockValuesFn).toHaveBeenCalledWith(
      expect.objectContaining({
        campaign_id: CAMPAIGN_ID,
        total_calls: 10,
        pending_calls: 2,
        completed_calls: 5,
        outcome_appointment_booked: 3,
        total_billed_seconds: 300,
        total_cost_cents: 150,
      }),
    );
    expect(mockOnConflictFn).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          total_calls: 10,
          completed_calls: 5,
          total_cost_cents: 150,
        }),
      }),
    );
  });

  it('upserts last_aggregated_at as a Date', async () => {
    mockWithSystemContext.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ select: makeAggregateSelectMock(ZERO_STATS) }),
    );

    const mockInsertFn = vi.fn();
    const mockValuesFn = vi.fn();
    const mockOnConflictFn = vi.fn().mockResolvedValue(undefined);
    mockInsertFn.mockReturnValue({ values: mockValuesFn });
    mockValuesFn.mockReturnValue({ onConflictDoUpdate: mockOnConflictFn });

    mockWithSystemContext.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ insert: mockInsertFn }),
    );

    await aggregateOneCampaign(CAMPAIGN_ID, ORG_ID);

    const callArg = mockValuesFn.mock.calls[0]?.[0] as { last_aggregated_at: unknown };
    expect(callArg.last_aggregated_at).toBeInstanceOf(Date);
  });
});

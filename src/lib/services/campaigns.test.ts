import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ─────────────────────────────────────────────────────────────────────

const mockRecordAudit = vi.fn().mockResolvedValue(undefined);
const mockSendInngestEvent = vi.fn().mockResolvedValue(undefined);
const mockReserveForCampaign = vi.fn().mockResolvedValue(undefined);
const mockReleaseReservation = vi.fn().mockResolvedValue(undefined);
const mockComputePerMinuteCents = vi.fn().mockResolvedValue(10); // 10 cents/min
const mockGetDpaStatus = vi.fn().mockResolvedValue({
  state: 'current',
  record: {
    acceptedAt: '2026-01-01T00:00:00.000Z',
    version: '2026-01-01',
    acceptedByUserId: 'user-1',
    ip: null,
    userAgent: null,
  },
});

vi.mock('@/lib/compliance/dpa', () => ({
  getDpaStatus: (...args: unknown[]) => mockGetDpaStatus(...args),
}));

vi.mock('@/lib/db/audit', () => ({
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

vi.mock('@/lib/inngest/client', () => ({
  sendInngestEvent: (...args: unknown[]) => mockSendInngestEvent(...args),
}));

vi.mock('./credit', () => ({
  reserveForCampaign: (...args: unknown[]) => mockReserveForCampaign(...args),
  releaseReservation: (...args: unknown[]) => mockReleaseReservation(...args),
}));

vi.mock('./billing-rules', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./billing-rules')>();
  return {
    ...actual,
    computePerMinuteCents: (...args: unknown[]) => mockComputePerMinuteCents(...args),
  };
});

// ─── DB mock ──────────────────────────────────────────────────────────────────

let selectResults: unknown[][] = [];
let insertResults: unknown[][] = [];
let updateResults: unknown[][] = [];

function makeSelectChain(result: unknown[]) {
  const chain: Record<string, (...args: unknown[]) => typeof chain> & {
    then?: unknown;
  } = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    for: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    groupBy: () => chain,
  };
  (chain as Record<string, unknown>).then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

const mockTx = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
};

function resetMockTx() {
  mockTx.select.mockImplementation(() => {
    const result = selectResults.shift() ?? [];
    return makeSelectChain(result);
  });

  mockTx.insert.mockImplementation(() => ({
    values: vi.fn(() => ({
      returning: vi.fn().mockResolvedValue(insertResults.shift() ?? []),
      onConflictDoNothing: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue(insertResults.shift() ?? []),
      })),
    })),
  }));

  mockTx.update.mockImplementation(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue(updateResults.shift() ?? []),
      })),
    })),
  }));
}

vi.mock('@/lib/db/context', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn(mockTx),
  ),
  withSystemContext: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
}));

// ─── Import under test ────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  selectResults = [];
  insertResults = [];
  updateResults = [];
  resetMockTx();
  mockGetDpaStatus.mockResolvedValue({
    state: 'current',
    record: {
      acceptedAt: '2026-01-01T00:00:00.000Z',
      version: '2026-01-01',
      acceptedByUserId: 'user-1',
      ip: null,
      userAgent: null,
    },
  });
});

const ORG_ID = 'org-1';
const USER_ID = 'user-1';
const CAMPAIGN_ID = 'campaign-1';

const DRAFT_CAMPAIGN = {
  id: CAMPAIGN_ID,
  org_id: ORG_ID,
  script_id: 'script-1',
  contact_list_id: 'list-1',
  name: 'Test Campaign',
  status: 'draft' as const,
  concurrency_limit: 5,
  time_window_start: '09:00',
  time_window_end: '19:00',
  scheduled_at: null,
  started_at: null,
  completed_at: null,
  estimated_max_cents: null,
  actual_cents: 0,
  created_at: new Date('2026-01-01T10:00:00Z'),
  updated_at: new Date('2026-01-01T10:00:00Z'),
};

describe('createCampaign', () => {
  it('creates a campaign in draft state when no scheduled date', async () => {
    insertResults = [[DRAFT_CAMPAIGN]];

    const { createCampaign } = await import('./campaigns');

    const result = await createCampaign(ORG_ID, USER_ID, {
      name: 'Test Campaign',
      scriptId: 'script-1',
      contactListId: 'list-1',
    });

    expect(result).toEqual(DRAFT_CAMPAIGN);
    expect(mockTx.insert).toHaveBeenCalledOnce();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        orgId: ORG_ID,
        actorUserId: USER_ID,
        actorType: 'user',
        action: 'campaign.created',
        subjectType: 'campaign',
        subjectId: CAMPAIGN_ID,
      }),
    );
  });

  it('creates a campaign in scheduled state when future scheduledStart is provided', async () => {
    const scheduledCampaign = { ...DRAFT_CAMPAIGN, status: 'scheduled' as const };
    insertResults = [[scheduledCampaign]];

    const { createCampaign } = await import('./campaigns');

    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const result = await createCampaign(ORG_ID, USER_ID, {
      name: 'Test Campaign',
      scriptId: 'script-1',
      contactListId: 'list-1',
      scheduledStart: futureDate,
    });

    expect(result.status).toBe('scheduled');
  });
});

describe('launchCampaign', () => {
  it('launches a draft campaign successfully', async () => {
    // getCampaign: select campaign + select stats
    selectResults = [
      [DRAFT_CAMPAIGN], // getCampaign → campaigns select
      [],               // getCampaign → attachStats calls select
      [{ contact_list_id: 'list-1' }], // countEligibleContacts → get campaign
      [],               // countEligibleContacts → recent calls (none)
      [{ total: 10 }],  // countEligibleContacts → count eligible
    ];
    updateResults = [[{ id: CAMPAIGN_ID }]]; // transition to running

    const { launchCampaign } = await import('./campaigns');
    await launchCampaign(ORG_ID, USER_ID, CAMPAIGN_ID);

    expect(mockReserveForCampaign).toHaveBeenCalledWith(
      ORG_ID,
      CAMPAIGN_ID,
      expect.any(Number),
    );
    expect(mockSendInngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'campaign/launched',
        data: { campaignId: CAMPAIGN_ID, orgId: ORG_ID },
      }),
    );
    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        action: 'campaign.launched',
        subjectId: CAMPAIGN_ID,
      }),
    );
  });

  it('throws campaign_not_found when campaign does not exist', async () => {
    selectResults = [[], []]; // getCampaign returns null

    const { launchCampaign } = await import('./campaigns');
    await expect(launchCampaign(ORG_ID, USER_ID, 'missing-id')).rejects.toThrow(
      'campaign_not_found',
    );
  });

  it('throws campaign_not_launchable for non-draft/scheduled campaigns', async () => {
    const runningCampaign = { ...DRAFT_CAMPAIGN, status: 'running' as const };
    selectResults = [[runningCampaign], []]; // getCampaign

    const { launchCampaign } = await import('./campaigns');
    await expect(launchCampaign(ORG_ID, USER_ID, CAMPAIGN_ID)).rejects.toThrow(
      'campaign_not_launchable',
    );
  });

  it('throws no_eligible_contacts when count is zero', async () => {
    selectResults = [
      [DRAFT_CAMPAIGN], // getCampaign
      [],               // attachStats
      [{ contact_list_id: 'list-1' }], // countEligibleContacts → campaign
      [],               // recent calls
      [{ total: 0 }],   // countEligibleContacts → count
    ];

    const { launchCampaign } = await import('./campaigns');
    await expect(launchCampaign(ORG_ID, USER_ID, CAMPAIGN_ID)).rejects.toThrow(
      'no_eligible_contacts',
    );
  });

  it('throws no_billing_rate when no per-minute rate available', async () => {
    mockComputePerMinuteCents.mockResolvedValueOnce(null);
    selectResults = [
      [DRAFT_CAMPAIGN],
      [],
      [{ contact_list_id: 'list-1' }],
      [],               // recent calls
      [{ total: 5 }],
    ];

    const { launchCampaign } = await import('./campaigns');
    await expect(launchCampaign(ORG_ID, USER_ID, CAMPAIGN_ID)).rejects.toThrow(
      'no_billing_rate',
    );
  });

  it('propagates insufficient_credit error from reserveForCampaign', async () => {
    mockReserveForCampaign.mockRejectedValueOnce(new Error('insufficient_credit'));
    selectResults = [
      [DRAFT_CAMPAIGN],
      [],
      [{ contact_list_id: 'list-1' }],
      [],               // recent calls
      [{ total: 5 }],
    ];

    const { launchCampaign } = await import('./campaigns');
    await expect(launchCampaign(ORG_ID, USER_ID, CAMPAIGN_ID)).rejects.toThrow(
      'insufficient_credit',
    );
  });

  it('throws dpa_outdated when org has not accepted current DPA version', async () => {
    selectResults = [[DRAFT_CAMPAIGN], []];
    mockGetDpaStatus.mockResolvedValueOnce({
      state: 'outdated',
      record: {
        acceptedAt: '2020-01-01T00:00:00.000Z',
        version: '2020-01-01',
        acceptedByUserId: USER_ID,
        ip: null,
        userAgent: null,
      },
      currentVersion: '2026-01-01',
    });

    const { launchCampaign } = await import('./campaigns');
    await expect(launchCampaign(ORG_ID, USER_ID, CAMPAIGN_ID)).rejects.toThrow(
      'dpa_outdated',
    );
    expect(mockReserveForCampaign).not.toHaveBeenCalled();
    expect(mockSendInngestEvent).not.toHaveBeenCalled();
  });

  it('throws dpa_outdated when org has never accepted DPA', async () => {
    selectResults = [[DRAFT_CAMPAIGN], []];
    mockGetDpaStatus.mockResolvedValueOnce({
      state: 'never_accepted',
      currentVersion: '2026-01-01',
    });

    const { launchCampaign } = await import('./campaigns');
    await expect(launchCampaign(ORG_ID, USER_ID, CAMPAIGN_ID)).rejects.toThrow(
      'dpa_outdated',
    );
  });
});

describe('pauseCampaign', () => {
  it('pauses a running campaign', async () => {
    updateResults = [[{ id: CAMPAIGN_ID }]];

    const { pauseCampaign } = await import('./campaigns');
    await pauseCampaign(ORG_ID, USER_ID, CAMPAIGN_ID);

    expect(mockTx.update).toHaveBeenCalledOnce();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ action: 'campaign.paused' }),
    );
  });

  it('throws campaign_not_running when campaign is not in running state', async () => {
    updateResults = [[]]; // no row updated

    const { pauseCampaign } = await import('./campaigns');
    await expect(pauseCampaign(ORG_ID, USER_ID, CAMPAIGN_ID)).rejects.toThrow(
      'campaign_not_running',
    );
  });
});

describe('resumeCampaign', () => {
  it('resumes a paused campaign', async () => {
    updateResults = [[{ id: CAMPAIGN_ID }]];

    const { resumeCampaign } = await import('./campaigns');
    await resumeCampaign(ORG_ID, USER_ID, CAMPAIGN_ID);

    expect(mockTx.update).toHaveBeenCalledOnce();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ action: 'campaign.resumed' }),
    );
  });

  it('throws campaign_not_paused when campaign is not paused', async () => {
    updateResults = [[]];

    const { resumeCampaign } = await import('./campaigns');
    await expect(resumeCampaign(ORG_ID, USER_ID, CAMPAIGN_ID)).rejects.toThrow(
      'campaign_not_paused',
    );
  });
});

describe('cancelCampaign', () => {
  it('cancels a campaign and releases reservation', async () => {
    updateResults = [[{ id: CAMPAIGN_ID }]];

    const { cancelCampaign } = await import('./campaigns');
    await cancelCampaign(ORG_ID, USER_ID, CAMPAIGN_ID);

    expect(mockTx.update).toHaveBeenCalledOnce();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ action: 'campaign.cancelled' }),
    );
    expect(mockReleaseReservation).toHaveBeenCalledWith(ORG_ID, CAMPAIGN_ID);
  });

  it('throws campaign_already_terminal when campaign is already cancelled', async () => {
    updateResults = [[]]; // no row updated (already terminal)

    const { cancelCampaign } = await import('./campaigns');
    await expect(cancelCampaign(ORG_ID, USER_ID, CAMPAIGN_ID)).rejects.toThrow(
      'campaign_already_terminal',
    );
  });
});

describe('getCampaign', () => {
  it('returns null when campaign not found', async () => {
    selectResults = [[]]; // campaigns select returns empty

    const { getCampaign } = await import('./campaigns');
    const result = await getCampaign(ORG_ID, CAMPAIGN_ID);
    expect(result).toBeNull();
  });

  it('returns campaign with stats', async () => {
    selectResults = [
      [DRAFT_CAMPAIGN], // campaigns select
      [{ campaign_id: CAMPAIGN_ID, status: 'pending', cnt: 3 }], // calls stats
    ];

    const { getCampaign } = await import('./campaigns');
    const result = await getCampaign(ORG_ID, CAMPAIGN_ID);

    expect(result).not.toBeNull();
    expect(result!.pendingCalls).toBe(3);
    expect(result!.totalCalls).toBe(3);
    expect(result!.completedCalls).toBe(0);
  });
});

describe('listCampaigns', () => {
  it('returns paginated campaigns', async () => {
    selectResults = [
      [DRAFT_CAMPAIGN], // campaigns select
      [],               // calls stats
    ];

    const { listCampaigns } = await import('./campaigns');
    const result = await listCampaigns(ORG_ID, {}, { limit: 10 });

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeUndefined();
  });

  it('returns nextCursor when there are more pages', async () => {
    // Return limit+1 rows to trigger next cursor
    const campaign2 = { ...DRAFT_CAMPAIGN, id: 'campaign-2' };
    selectResults = [
      [DRAFT_CAMPAIGN, campaign2], // returns 2 rows for limit of 1
      [],                           // calls stats for 1 campaign
    ];

    const { listCampaigns } = await import('./campaigns');
    const result = await listCampaigns(ORG_ID, {}, { limit: 1 });

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeDefined();
  });

  it('filters by status', async () => {
    selectResults = [
      [], // no matching campaigns
      [], // empty stats
    ];

    const { listCampaigns } = await import('./campaigns');
    const result = await listCampaigns(ORG_ID, { status: ['running'] }, { limit: 10 });

    expect(result.items).toHaveLength(0);
  });
});

describe('markCampaignCompleted', () => {
  it('marks campaign as completed and releases reservation', async () => {
    updateResults = [[{ id: CAMPAIGN_ID }]];

    const { markCampaignCompleted } = await import('./campaigns');
    await markCampaignCompleted(ORG_ID, CAMPAIGN_ID);

    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ action: 'campaign.completed' }),
    );
    expect(mockReleaseReservation).toHaveBeenCalledWith(ORG_ID, CAMPAIGN_ID);
  });

  it('is idempotent when campaign already completed', async () => {
    updateResults = [[]];

    const { markCampaignCompleted } = await import('./campaigns');
    // Should not throw
    await expect(markCampaignCompleted(ORG_ID, CAMPAIGN_ID)).resolves.toBeUndefined();
  });
});

describe('requireRunning', () => {
  it('returns the campaign when found', async () => {
    selectResults = [[DRAFT_CAMPAIGN]];

    const { requireRunning } = await import('./campaigns');
    const result = await requireRunning(ORG_ID, CAMPAIGN_ID);
    expect(result).toEqual(DRAFT_CAMPAIGN);
  });

  it('throws campaign_not_found when not found', async () => {
    selectResults = [[]];

    const { requireRunning } = await import('./campaigns');
    await expect(requireRunning(ORG_ID, 'missing')).rejects.toThrow(
      'campaign_not_found',
    );
  });
});

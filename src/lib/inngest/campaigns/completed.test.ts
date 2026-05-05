import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/services/campaigns', () => ({
  markCampaignCompleted: vi.fn(),
}));

vi.mock('@/lib/inngest/client', () => ({
  sendInngestEvent: vi.fn(),
}));

// DB context mock — system context only (no RLS)
const mockSystemTx: Record<string, unknown> = {};

vi.mock('@/lib/db/context', () => ({
  withSystemContext: vi.fn((fn: (tx: unknown) => unknown) => fn(mockSystemTx)),
}));

// tx.select() is the entry point for all DB chains in this handler.
// We expose it on the mock tx so individual tests can override the chain.
const mockSelect = vi.fn();
mockSystemTx.select = mockSelect;

// ─── Module under test ────────────────────────────────────────────────────────

import { sendInngestEvent } from '@/lib/inngest/client';
import { markCampaignCompleted } from '@/lib/services/campaigns';

import { campaignCompletedHandler, countActiveCalls } from './completed';
import { CAMPAIGN_COMPLETED_EVENT } from './events';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CALL_ID = 'call-xyz-001';
const CAMPAIGN_ID = 'camp-abc-001';
const ORG_ID = 'org-111';

const basePayload = {
  callId: CALL_ID,
  orgId: ORG_ID,
  durationSeconds: 60,
  endedReason: 'completed',
  recordingUrl: null,
};

// Helper: build a select chain that resolves with the given rows.
// For the call-row lookup:  select().from().where().limit() → rows
function makeCallRowChain(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  return { from, where, limit };
}

// Helper: build a select chain for countActiveCalls:
// select().from().where() → rows (no .limit() call)
function makeCountChain(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn(() => ({ where }));
  return { from, where };
}

// ─── Tests: countActiveCalls ──────────────────────────────────────────────────

describe('countActiveCalls', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns total active-call count from the DB', async () => {
    const { from } = makeCountChain([{ total: 3 }]);
    mockSelect.mockReturnValue({ from });

    const result = await countActiveCalls(CAMPAIGN_ID, ORG_ID);

    expect(result).toBe(3);
  });

  it('returns 0 when no rows returned', async () => {
    const { from } = makeCountChain([]);
    mockSelect.mockReturnValue({ from });

    const result = await countActiveCalls(CAMPAIGN_ID, ORG_ID);

    expect(result).toBe(0);
  });

  it('returns 0 when row has total: 0', async () => {
    const { from } = makeCountChain([{ total: 0 }]);
    mockSelect.mockReturnValue({ from });

    const result = await countActiveCalls(CAMPAIGN_ID, ORG_ID);

    expect(result).toBe(0);
  });
});

// ─── Tests: campaignCompletedHandler ─────────────────────────────────────────

describe('campaignCompletedHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(markCampaignCompleted).mockResolvedValue(undefined);
    vi.mocked(sendInngestEvent).mockResolvedValue(undefined);
  });

  it('is a no-op when the call is not found in the DB', async () => {
    // First select (call-row lookup) returns empty
    const chain = makeCallRowChain([]);
    mockSelect.mockReturnValue({ from: chain.from });

    await campaignCompletedHandler(basePayload);

    expect(markCampaignCompleted).not.toHaveBeenCalled();
    expect(sendInngestEvent).not.toHaveBeenCalled();
  });

  it('is a no-op when the call has no campaign_id', async () => {
    const chain = makeCallRowChain([{ campaign_id: null, org_id: ORG_ID }]);
    mockSelect.mockReturnValue({ from: chain.from });

    await campaignCompletedHandler(basePayload);

    expect(markCampaignCompleted).not.toHaveBeenCalled();
    expect(sendInngestEvent).not.toHaveBeenCalled();
  });

  it('is a no-op when active calls still remain', async () => {
    let callCount = 0;
    mockSelect.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // call-row lookup
        const { from } = makeCallRowChain([{ campaign_id: CAMPAIGN_ID, org_id: ORG_ID }]);
        return { from };
      }
      // countActiveCalls — 2 active calls remain
      const { from } = makeCountChain([{ total: 2 }]);
      return { from };
    });

    await campaignCompletedHandler(basePayload);

    expect(markCampaignCompleted).not.toHaveBeenCalled();
    expect(sendInngestEvent).not.toHaveBeenCalled();
  });

  it('finalises the campaign when all calls are terminal', async () => {
    let callCount = 0;
    mockSelect.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        const { from } = makeCallRowChain([{ campaign_id: CAMPAIGN_ID, org_id: ORG_ID }]);
        return { from };
      }
      // countActiveCalls — 0 active
      const { from } = makeCountChain([{ total: 0 }]);
      return { from };
    });

    await campaignCompletedHandler(basePayload);

    expect(markCampaignCompleted).toHaveBeenCalledWith(ORG_ID, CAMPAIGN_ID);
    expect(sendInngestEvent).toHaveBeenCalledWith({
      name: CAMPAIGN_COMPLETED_EVENT,
      data: { campaignId: CAMPAIGN_ID, orgId: ORG_ID },
      id: `campaign-completed-${CAMPAIGN_ID}`,
    });
  });

  it('emits campaign/completed after marking the campaign completed', async () => {
    const order: string[] = [];
    vi.mocked(markCampaignCompleted).mockImplementation(async () => {
      order.push('mark-completed');
    });
    vi.mocked(sendInngestEvent).mockImplementation(async () => {
      order.push('emit-event');
    });

    let callCount = 0;
    mockSelect.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        const { from } = makeCallRowChain([{ campaign_id: CAMPAIGN_ID, org_id: ORG_ID }]);
        return { from };
      }
      const { from } = makeCountChain([{ total: 0 }]);
      return { from };
    });

    await campaignCompletedHandler(basePayload);

    expect(order).toEqual(['mark-completed', 'emit-event']);
  });

  it('does not emit campaign/completed if markCampaignCompleted throws', async () => {
    vi.mocked(markCampaignCompleted).mockRejectedValue(new Error('db error'));

    let callCount = 0;
    mockSelect.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        const { from } = makeCallRowChain([{ campaign_id: CAMPAIGN_ID, org_id: ORG_ID }]);
        return { from };
      }
      const { from } = makeCountChain([{ total: 0 }]);
      return { from };
    });

    await expect(campaignCompletedHandler(basePayload)).rejects.toThrow('db error');
    expect(sendInngestEvent).not.toHaveBeenCalled();
  });

  it('uses a deterministic idempotency key for the completed event', async () => {
    let callCount = 0;
    mockSelect.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        const { from } = makeCallRowChain([{ campaign_id: CAMPAIGN_ID, org_id: ORG_ID }]);
        return { from };
      }
      const { from } = makeCountChain([{ total: 0 }]);
      return { from };
    });

    await campaignCompletedHandler(basePayload);

    expect(vi.mocked(sendInngestEvent).mock.calls[0]?.[0]).toMatchObject({
      id: `campaign-completed-${CAMPAIGN_ID}`,
    });
  });
});

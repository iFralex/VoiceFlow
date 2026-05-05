import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/inngest/client', () => ({
  sendInngestEvents: vi.fn(),
}));

vi.mock('@/lib/services/eligibility', () => ({
  findEligibleContactsForCampaign: vi.fn(),
}));

vi.mock('@/lib/services/campaigns', () => ({
  markCampaignCompletedEmpty: vi.fn(),
}));

const mockInsert = vi.fn();
const mockTxChain: Record<string, unknown> = {};

vi.mock('@/lib/db/context', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => unknown) => fn(mockTxChain)),
}));

// Insert chain: tx.insert(calls).values([...]).returning(...)
const mockReturning = vi.fn();
const mockValues = vi.fn(() => ({ returning: mockReturning }));
mockInsert.mockReturnValue({ values: mockValues });
mockTxChain.insert = mockInsert;

// ─── Module under test ────────────────────────────────────────────────────────

import { sendInngestEvents } from '@/lib/inngest/client';
import { markCampaignCompletedEmpty } from '@/lib/services/campaigns';
import { findEligibleContactsForCampaign } from '@/lib/services/eligibility';

import { campaignLaunchedHandler, createPendingCallRows } from './launched';
import { CAMPAIGN_DISPATCH_CALL_EVENT } from './events';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG = 'org-111';
const CAMPAIGN = 'camp-222';

const eligible = [
  { contactId: 'c-1', phoneE164: '+39012345678', attemptNumber: 1 },
  { contactId: 'c-2', phoneE164: '+39087654321', attemptNumber: 1 },
];

// ─── Tests: createPendingCallRows ─────────────────────────────────────────────

describe('createPendingCallRows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockReturnValue({ returning: mockReturning });
  });

  it('inserts one pending calls row per eligible contact', async () => {
    mockReturning.mockResolvedValue([
      { id: 'call-1', contact_id: 'c-1' },
      { id: 'call-2', contact_id: 'c-2' },
    ]);

    const result = await createPendingCallRows(ORG, CAMPAIGN, eligible);

    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockValues).toHaveBeenCalledWith([
      expect.objectContaining({ org_id: ORG, campaign_id: CAMPAIGN, contact_id: 'c-1', status: 'pending' }),
      expect.objectContaining({ org_id: ORG, campaign_id: CAMPAIGN, contact_id: 'c-2', status: 'pending' }),
    ]);
    expect(result).toHaveLength(2);
  });

  it('attaches callId to each eligible contact', async () => {
    mockReturning.mockResolvedValue([
      { id: 'call-1', contact_id: 'c-1' },
      { id: 'call-2', contact_id: 'c-2' },
    ]);

    const result = await createPendingCallRows(ORG, CAMPAIGN, eligible);

    expect(result[0]).toMatchObject({ contactId: 'c-1', callId: 'call-1', attemptNumber: 1 });
    expect(result[1]).toMatchObject({ contactId: 'c-2', callId: 'call-2', attemptNumber: 1 });
  });

  it('preserves attemptNumber from the eligible input', async () => {
    const retryEligible = [
      { contactId: 'c-1', phoneE164: '+39012345678', attemptNumber: 2 },
    ];
    mockReturning.mockResolvedValue([{ id: 'call-r', contact_id: 'c-1' }]);

    const result = await createPendingCallRows(ORG, CAMPAIGN, retryEligible);

    expect(result[0]?.attemptNumber).toBe(2);
  });
});

// ─── Tests: campaignLaunchedHandler ──────────────────────────────────────────

describe('campaignLaunchedHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockReturnValue({ returning: mockReturning });
    vi.mocked(sendInngestEvents).mockResolvedValue(undefined);
    vi.mocked(markCampaignCompletedEmpty).mockResolvedValue(undefined);
  });

  it('marks campaign completed empty when no eligible contacts', async () => {
    vi.mocked(findEligibleContactsForCampaign).mockResolvedValue([]);

    await campaignLaunchedHandler({ campaignId: CAMPAIGN, orgId: ORG });

    expect(markCampaignCompletedEmpty).toHaveBeenCalledWith(ORG, CAMPAIGN);
    expect(sendInngestEvents).not.toHaveBeenCalled();
  });

  it('does not insert call rows when no eligible contacts', async () => {
    vi.mocked(findEligibleContactsForCampaign).mockResolvedValue([]);

    await campaignLaunchedHandler({ campaignId: CAMPAIGN, orgId: ORG });

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('creates pending call rows for each eligible contact', async () => {
    vi.mocked(findEligibleContactsForCampaign).mockResolvedValue(eligible);
    mockReturning.mockResolvedValue([
      { id: 'call-1', contact_id: 'c-1' },
      { id: 'call-2', contact_id: 'c-2' },
    ]);

    await campaignLaunchedHandler({ campaignId: CAMPAIGN, orgId: ORG });

    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockValues).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ contact_id: 'c-1' }),
        expect.objectContaining({ contact_id: 'c-2' }),
      ]),
    );
  });

  it('batch-sends one dispatch event per eligible contact', async () => {
    vi.mocked(findEligibleContactsForCampaign).mockResolvedValue(eligible);
    mockReturning.mockResolvedValue([
      { id: 'call-1', contact_id: 'c-1' },
      { id: 'call-2', contact_id: 'c-2' },
    ]);

    await campaignLaunchedHandler({ campaignId: CAMPAIGN, orgId: ORG });

    expect(sendInngestEvents).toHaveBeenCalledOnce();
    const [events] = vi.mocked(sendInngestEvents).mock.calls[0] as [unknown[]];
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      name: CAMPAIGN_DISPATCH_CALL_EVENT,
      data: { campaignId: CAMPAIGN, orgId: ORG, contactId: 'c-1', callId: 'call-1', attempt: 1 },
    });
    expect(events[1]).toMatchObject({
      name: CAMPAIGN_DISPATCH_CALL_EVENT,
      data: { campaignId: CAMPAIGN, orgId: ORG, contactId: 'c-2', callId: 'call-2', attempt: 1 },
    });
  });

  it('sets idempotency key per dispatch event', async () => {
    vi.mocked(findEligibleContactsForCampaign).mockResolvedValue([eligible[0]!]);
    mockReturning.mockResolvedValue([{ id: 'call-1', contact_id: 'c-1' }]);

    await campaignLaunchedHandler({ campaignId: CAMPAIGN, orgId: ORG });

    const [events] = vi.mocked(sendInngestEvents).mock.calls[0] as [{ id?: string }[]];
    expect(events[0]?.id).toBe(`dispatch-${CAMPAIGN}-c-1-1`);
  });

  it('does not call markCampaignCompletedEmpty when contacts are present', async () => {
    vi.mocked(findEligibleContactsForCampaign).mockResolvedValue(eligible);
    mockReturning.mockResolvedValue([
      { id: 'call-1', contact_id: 'c-1' },
      { id: 'call-2', contact_id: 'c-2' },
    ]);

    await campaignLaunchedHandler({ campaignId: CAMPAIGN, orgId: ORG });

    expect(markCampaignCompletedEmpty).not.toHaveBeenCalled();
  });
});

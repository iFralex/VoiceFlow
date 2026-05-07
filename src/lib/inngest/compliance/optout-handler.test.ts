import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const {
  mockWithOrgContext,
  mockRecordAudit,
  mockSendInngestEvents,
  mockCheckAndFinaliseCampaignCompletion,
  mockGetVoiceProviderByName,
  mockProviderCancelCall,
} = vi.hoisted(() => ({
  mockWithOrgContext: vi.fn(),
  mockRecordAudit: vi.fn().mockResolvedValue(undefined),
  mockSendInngestEvents: vi.fn().mockResolvedValue(undefined),
  mockCheckAndFinaliseCampaignCompletion: vi.fn().mockResolvedValue(undefined),
  mockGetVoiceProviderByName: vi.fn(),
  mockProviderCancelCall: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/db/context', () => ({
  withOrgContext: mockWithOrgContext,
}));

vi.mock('@/lib/db/audit', () => ({
  recordAudit: mockRecordAudit,
}));

vi.mock('../client', () => ({
  sendInngestEvents: mockSendInngestEvents,
}));

vi.mock('../campaigns/completed', () => ({
  checkAndFinaliseCampaignCompletion: mockCheckAndFinaliseCampaignCompletion,
}));

vi.mock('@/lib/voice/factory', () => ({
  getVoiceProviderByName: mockGetVoiceProviderByName,
}));

vi.mock('@/lib/db/schema', () => ({
  contacts: {
    id: 'c_id',
    org_id: 'c_org_id',
    phone_e164: 'c_phone_e164',
  },
  calls: {
    id: 'k_id',
    org_id: 'k_org_id',
    campaign_id: 'k_campaign_id',
    contact_id: 'k_contact_id',
    status: 'k_status',
    provider: 'k_provider',
    provider_call_id: 'k_provider_call_id',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  eq: (col: unknown, val: unknown) => ({ type: 'eq', col, val }),
  inArray: (col: unknown, vals: unknown[]) => ({ type: 'inArray', col, vals }),
}));

// ─── Module under test ───────────────────────────────────────────────────────

import { CAMPAIGN_CONTACT_OPTED_OUT_EVENT } from './events';
import { complianceOptOutRegisteredHandler } from './optout-handler';

// ─── Fixture helpers ─────────────────────────────────────────────────────────

interface CallRow {
  id: string;
  campaign_id: string | null;
  contact_id: string | null;
  status: 'pending' | 'dialing' | 'in_progress';
  provider: 'vapi' | 'retell' | 'proprietary';
  provider_call_id: string | null;
}

interface ContactRow {
  id: string;
}

interface FixtureOpts {
  contactRows: ContactRow[];
  callRows: CallRow[];
  /** When provided, the UPDATE returns only the call ids in this list. Defaults to all callRows ids. */
  flipReturning?: string[];
}

function buildMockTxFactory(opts: FixtureOpts) {
  const calls = {
    selectCalls: 0,
    selectCallsArgs: [] as unknown[],
    updateCallSet: undefined as Record<string, unknown> | undefined,
  };

  const flipReturningIds = opts.flipReturning ?? opts.callRows.map((c) => c.id);

  function makeTx(callIndex: number) {
    return {
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => {
          if (table === 'contacts_table') {
            // never reached because schema mock is opaque — branch by call order
          }
          return {
            where: vi.fn(() => {
              if (callIndex === 0) {
                // 1st select inside withOrgContext = contact lookup
                return Promise.resolve(opts.contactRows);
              }
              // 2nd select = candidateCalls
              calls.selectCalls += 1;
              return Promise.resolve(opts.callRows);
            }),
          };
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn((s: Record<string, unknown>) => {
          calls.updateCallSet = s;
          return {
            where: vi.fn(() => ({
              returning: vi.fn(() =>
                Promise.resolve(flipReturningIds.map((id) => ({ id }))),
              ),
            })),
          };
        }),
      })),
    };
  }

  let counter = 0;
  mockWithOrgContext.mockImplementation(
    async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
      const tx = makeTx(counter);
      counter += 1;
      return fn(tx);
    },
  );

  return calls;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('complianceOptOutRegisteredHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProviderCancelCall.mockResolvedValue(undefined);
    mockGetVoiceProviderByName.mockReturnValue({
      cancelCall: mockProviderCancelCall,
    });
  });

  it('returns early when no contact matches the phone', async () => {
    buildMockTxFactory({ contactRows: [], callRows: [] });

    await complianceOptOutRegisteredHandler({
      orgId: 'org-1',
      phoneE164: '+393331234567',
      source: 'dealer_input',
      recordedAt: '2026-05-07T10:00:00Z',
    });

    expect(mockWithOrgContext).toHaveBeenCalledTimes(1);
    expect(mockSendInngestEvents).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
    expect(mockProviderCancelCall).not.toHaveBeenCalled();
    expect(mockCheckAndFinaliseCampaignCompletion).not.toHaveBeenCalled();
  });

  it('returns early when no in-flight calls match', async () => {
    buildMockTxFactory({ contactRows: [{ id: 'contact-1' }], callRows: [] });

    await complianceOptOutRegisteredHandler({
      orgId: 'org-1',
      phoneE164: '+393331234567',
      source: 'gdpr_request',
      recordedAt: '2026-05-07T10:00:00Z',
    });

    expect(mockWithOrgContext).toHaveBeenCalledTimes(2);
    expect(mockSendInngestEvents).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
    expect(mockProviderCancelCall).not.toHaveBeenCalled();
  });

  it('flips a single pending call to failed/opted_out without invoking provider.cancelCall', async () => {
    const captured = buildMockTxFactory({
      contactRows: [{ id: 'contact-1' }],
      callRows: [
        {
          id: 'call-pending-1',
          campaign_id: 'camp-A',
          contact_id: 'contact-1',
          status: 'pending',
          provider: 'vapi',
          provider_call_id: null,
        },
      ],
    });

    await complianceOptOutRegisteredHandler({
      orgId: 'org-1',
      phoneE164: '+393331234567',
      source: 'inbound_ivr',
      recordedAt: '2026-05-07T10:00:00Z',
    });

    expect(mockProviderCancelCall).not.toHaveBeenCalled();
    expect(captured.updateCallSet).toEqual({
      status: 'failed',
      error_code: 'opted_out',
    });

    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit.mock.calls[0]?.[1]).toMatchObject({
      orgId: 'org-1',
      actorType: 'system',
      action: 'call.skipped',
      subjectType: 'call',
      subjectId: 'call-pending-1',
      metadata: {
        reason: 'opted_out',
        source: 'inbound_ivr',
        phoneE164: '+393331234567',
      },
    });

    expect(mockSendInngestEvents).toHaveBeenCalledOnce();
    const events = mockSendInngestEvents.mock.calls[0]?.[0] as Array<{
      name: string;
      id: string;
      data: Record<string, unknown>;
    }>;
    expect(events).toHaveLength(1);
    expect(events[0]?.name).toBe(CAMPAIGN_CONTACT_OPTED_OUT_EVENT);
    expect(events[0]?.id).toBe(
      'contact-opted-out-camp-A-+393331234567-inbound_ivr',
    );
    expect(events[0]?.data).toMatchObject({
      orgId: 'org-1',
      campaignId: 'camp-A',
      contactId: 'contact-1',
      phoneE164: '+393331234567',
      source: 'inbound_ivr',
      cancelledPendingCount: 1,
      cancelledActiveCount: 0,
    });

    expect(mockCheckAndFinaliseCampaignCompletion).toHaveBeenCalledWith(
      'org-1',
      'camp-A',
    );
  });

  it('cancels dialing/in_progress calls at the voice provider before flipping locally', async () => {
    buildMockTxFactory({
      contactRows: [{ id: 'contact-1' }],
      callRows: [
        {
          id: 'call-dialing-1',
          campaign_id: 'camp-A',
          contact_id: 'contact-1',
          status: 'dialing',
          provider: 'vapi',
          provider_call_id: 'vapi-xyz',
        },
        {
          id: 'call-in-progress-1',
          campaign_id: 'camp-A',
          contact_id: 'contact-1',
          status: 'in_progress',
          provider: 'retell',
          provider_call_id: 'retell-abc',
        },
      ],
    });

    await complianceOptOutRegisteredHandler({
      orgId: 'org-1',
      phoneE164: '+393331234567',
      source: 'call_outcome',
      recordedAt: '2026-05-07T10:00:00Z',
    });

    expect(mockGetVoiceProviderByName).toHaveBeenCalledTimes(2);
    expect(mockGetVoiceProviderByName).toHaveBeenCalledWith('vapi');
    expect(mockGetVoiceProviderByName).toHaveBeenCalledWith('retell');
    expect(mockProviderCancelCall).toHaveBeenCalledTimes(2);
    expect(mockProviderCancelCall).toHaveBeenCalledWith('vapi-xyz');
    expect(mockProviderCancelCall).toHaveBeenCalledWith('retell-abc');

    const events = mockSendInngestEvents.mock.calls[0]?.[0] as Array<{
      data: Record<string, unknown>;
    }>;
    expect(events?.[0]?.data).toMatchObject({
      cancelledPendingCount: 0,
      cancelledActiveCount: 2,
    });
  });

  it('swallows provider.cancelCall errors and still flips the call locally', async () => {
    mockProviderCancelCall.mockRejectedValueOnce(new Error('provider down'));

    const captured = buildMockTxFactory({
      contactRows: [{ id: 'contact-1' }],
      callRows: [
        {
          id: 'call-dialing-1',
          campaign_id: 'camp-A',
          contact_id: 'contact-1',
          status: 'dialing',
          provider: 'vapi',
          provider_call_id: 'vapi-xyz',
        },
      ],
    });

    await expect(
      complianceOptOutRegisteredHandler({
        orgId: 'org-1',
        phoneE164: '+393331234567',
        source: 'rpo_block',
        recordedAt: '2026-05-07T10:00:00Z',
      }),
    ).resolves.toBeUndefined();

    expect(mockProviderCancelCall).toHaveBeenCalled();
    expect(captured.updateCallSet).toEqual({
      status: 'failed',
      error_code: 'opted_out',
    });
    expect(mockRecordAudit).toHaveBeenCalledOnce();
    expect(mockSendInngestEvents).toHaveBeenCalledOnce();
  });

  it('emits one event per affected campaign and groups counts correctly', async () => {
    buildMockTxFactory({
      contactRows: [{ id: 'contact-1' }],
      callRows: [
        {
          id: 'call-pending-A',
          campaign_id: 'camp-A',
          contact_id: 'contact-1',
          status: 'pending',
          provider: 'vapi',
          provider_call_id: null,
        },
        {
          id: 'call-dialing-A',
          campaign_id: 'camp-A',
          contact_id: 'contact-1',
          status: 'dialing',
          provider: 'vapi',
          provider_call_id: 'vapi-1',
        },
        {
          id: 'call-pending-B',
          campaign_id: 'camp-B',
          contact_id: 'contact-1',
          status: 'pending',
          provider: 'vapi',
          provider_call_id: null,
        },
      ],
    });

    await complianceOptOutRegisteredHandler({
      orgId: 'org-1',
      phoneE164: '+393331234567',
      source: 'dealer_input',
      recordedAt: '2026-05-07T10:00:00Z',
    });

    const events = mockSendInngestEvents.mock.calls[0]?.[0] as Array<{
      data: Record<string, unknown>;
    }>;
    expect(events).toHaveLength(2);
    const byCampaign = new Map(
      events.map((e) => [e.data['campaignId'] as string, e.data] as const),
    );
    expect(byCampaign.get('camp-A')).toMatchObject({
      cancelledPendingCount: 1,
      cancelledActiveCount: 1,
    });
    expect(byCampaign.get('camp-B')).toMatchObject({
      cancelledPendingCount: 1,
      cancelledActiveCount: 0,
    });

    expect(mockCheckAndFinaliseCampaignCompletion).toHaveBeenCalledTimes(2);
    const finaliseArgs = mockCheckAndFinaliseCampaignCompletion.mock.calls
      .map((c) => c[1])
      .sort();
    expect(finaliseArgs).toEqual(['camp-A', 'camp-B']);
  });

  it('does not emit campaign events for inbound rows (campaign_id=null)', async () => {
    buildMockTxFactory({
      contactRows: [{ id: 'contact-1' }],
      callRows: [
        {
          id: 'call-inbound-1',
          campaign_id: null,
          contact_id: 'contact-1',
          status: 'in_progress',
          provider: 'vapi',
          provider_call_id: 'vapi-inbound-1',
        },
      ],
    });

    await complianceOptOutRegisteredHandler({
      orgId: 'org-1',
      phoneE164: '+393331234567',
      source: 'inbound_ivr',
      recordedAt: '2026-05-07T10:00:00Z',
    });

    // Provider was still asked to cancel, audit was still written
    expect(mockProviderCancelCall).toHaveBeenCalledOnce();
    expect(mockRecordAudit).toHaveBeenCalledOnce();
    // …but no campaign event should be emitted (no campaign_id)
    expect(mockSendInngestEvents).not.toHaveBeenCalled();
    expect(mockCheckAndFinaliseCampaignCompletion).not.toHaveBeenCalled();
  });

  it('is idempotent: when the UPDATE returns no rows nothing is emitted', async () => {
    buildMockTxFactory({
      contactRows: [{ id: 'contact-1' }],
      callRows: [
        {
          id: 'call-pending-A',
          campaign_id: 'camp-A',
          contact_id: 'contact-1',
          status: 'pending',
          provider: 'vapi',
          provider_call_id: null,
        },
      ],
      // Race: by the time the UPDATE runs, another path already terminated
      // the row. The status filter excludes it, so returning() is empty.
      flipReturning: [],
    });

    await complianceOptOutRegisteredHandler({
      orgId: 'org-1',
      phoneE164: '+393331234567',
      source: 'dealer_input',
      recordedAt: '2026-05-07T10:00:00Z',
    });

    expect(mockRecordAudit).not.toHaveBeenCalled();
    expect(mockSendInngestEvents).not.toHaveBeenCalled();
    expect(mockCheckAndFinaliseCampaignCompletion).not.toHaveBeenCalled();
  });

  it('finalisation failures are logged and swallowed', async () => {
    const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockCheckAndFinaliseCampaignCompletion.mockRejectedValueOnce(
      new Error('boom'),
    );

    buildMockTxFactory({
      contactRows: [{ id: 'contact-1' }],
      callRows: [
        {
          id: 'call-pending-1',
          campaign_id: 'camp-A',
          contact_id: 'contact-1',
          status: 'pending',
          provider: 'vapi',
          provider_call_id: null,
        },
      ],
    });

    await expect(
      complianceOptOutRegisteredHandler({
        orgId: 'org-1',
        phoneE164: '+393331234567',
        source: 'dealer_input',
        recordedAt: '2026-05-07T10:00:00Z',
      }),
    ).resolves.toBeUndefined();

    expect(consoleErrSpy).toHaveBeenCalled();
    consoleErrSpy.mockRestore();
  });
});

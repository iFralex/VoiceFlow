import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/voice/persistence', () => ({
  persistCallArtifacts: vi.fn(),
}));

vi.mock('@/lib/services/calls', () => ({
  classifyAndFinaliseCall: vi.fn(),
}));

vi.mock('@/lib/services/credit', () => ({
  chargeForCall: vi.fn(),
}));

vi.mock('@/lib/inngest/client', () => ({
  sendInngestEvent: vi.fn(),
}));

// DB context mocks
const mockSystemSelect = vi.fn();
const mockOrgUpdate = vi.fn();
const mockSystemTx: Record<string, unknown> = {};
const mockOrgTx: Record<string, unknown> = {};

vi.mock('@/lib/db/context', () => ({
  withSystemContext: vi.fn((fn: (tx: unknown) => unknown) => fn(mockSystemTx)),
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => unknown) => fn(mockOrgTx)),
}));

// System tx select chain: tx.select({...}).from(...).where(...).limit(1)
const mockSystemLimit = vi.fn();
const mockSystemWhere = vi.fn(() => ({ limit: mockSystemLimit }));
const mockSystemFrom = vi.fn(() => ({ where: mockSystemWhere }));
mockSystemSelect.mockReturnValue({ from: mockSystemFrom });
mockSystemTx.select = mockSystemSelect;

// Org tx update chain: tx.update(...).set({...}).where(...)
const mockUpdateWhere = vi.fn();
const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
const mockUpdateTable = vi.fn(() => ({ set: mockUpdateSet }));
mockOrgUpdate.mockImplementation(mockUpdateTable);
mockOrgTx.update = mockOrgUpdate;

// ─── Module under test ────────────────────────────────────────────────────────

import { sendInngestEvent } from '@/lib/inngest/client';
import { classifyAndFinaliseCall } from '@/lib/services/calls';
import { chargeForCall } from '@/lib/services/credit';
import { persistCallArtifacts } from '@/lib/voice/persistence';

import {
  callCompletedHandler,
  chargeCallToLedger,
  emitOutcomeEvents,
  incrementCampaignCounters,
  persistCallArtifactsStep,
} from './completed';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CALL_ID = 'call-abc-123';
const ORG_ID = 'org-111';
const CAMPAIGN_ID = 'camp-222';
const CONTACT_ID = 'contact-333';

const baseCallRow = {
  org_id: ORG_ID,
  campaign_id: CAMPAIGN_ID,
  contact_id: CONTACT_ID,
  cost_cents: 500,
  outcome: null as string | null,
};

// ─── Tests: persistCallArtifactsStep ─────────────────────────────────────────

describe('persistCallArtifactsStep', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates to persistCallArtifacts from voice/persistence', async () => {
    vi.mocked(persistCallArtifacts).mockResolvedValue(undefined);

    await persistCallArtifactsStep(CALL_ID);

    expect(persistCallArtifacts).toHaveBeenCalledWith(CALL_ID);
  });

  it('propagates errors from persistCallArtifacts', async () => {
    vi.mocked(persistCallArtifacts).mockRejectedValue(new Error('storage error'));

    await expect(persistCallArtifactsStep(CALL_ID)).rejects.toThrow('storage error');
  });
});

// ─── Tests: chargeCallToLedger ────────────────────────────────────────────────

describe('chargeCallToLedger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSystemSelect.mockReturnValue({ from: mockSystemFrom });
    mockSystemFrom.mockReturnValue({ where: mockSystemWhere });
    mockSystemWhere.mockReturnValue({ limit: mockSystemLimit });
    vi.mocked(chargeForCall).mockResolvedValue(undefined);
  });

  it('calls chargeForCall with org, callId, and cost from DB', async () => {
    mockSystemLimit.mockResolvedValue([{ org_id: ORG_ID, cost_cents: 500 }]);

    await chargeCallToLedger(CALL_ID);

    expect(chargeForCall).toHaveBeenCalledWith(ORG_ID, CALL_ID, 500);
  });

  it('is a no-op when call not found', async () => {
    mockSystemLimit.mockResolvedValue([]);

    await chargeCallToLedger(CALL_ID);

    expect(chargeForCall).not.toHaveBeenCalled();
  });

  it('is a no-op when cost_cents is null', async () => {
    mockSystemLimit.mockResolvedValue([{ org_id: ORG_ID, cost_cents: null }]);

    await chargeCallToLedger(CALL_ID);

    expect(chargeForCall).not.toHaveBeenCalled();
  });

  it('is a no-op when cost_cents is zero', async () => {
    mockSystemLimit.mockResolvedValue([{ org_id: ORG_ID, cost_cents: 0 }]);

    await chargeCallToLedger(CALL_ID);

    expect(chargeForCall).not.toHaveBeenCalled();
  });
});

// ─── Tests: incrementCampaignCounters ────────────────────────────────────────

describe('incrementCampaignCounters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSystemSelect.mockReturnValue({ from: mockSystemFrom });
    mockSystemFrom.mockReturnValue({ where: mockSystemWhere });
    mockSystemWhere.mockReturnValue({ limit: mockSystemLimit });
    mockOrgUpdate.mockImplementation(mockUpdateTable);
    mockUpdateTable.mockReturnValue({ set: mockUpdateSet });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdateWhere.mockResolvedValue(undefined);
  });

  it('updates campaigns actual_cents via withOrgContext', async () => {
    mockSystemLimit.mockResolvedValue([{ org_id: ORG_ID, campaign_id: CAMPAIGN_ID }]);

    await incrementCampaignCounters(CALL_ID);

    expect(mockOrgUpdate).toHaveBeenCalledOnce();
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ updated_at: expect.any(Date) }),
    );
  });

  it('is a no-op when call not found', async () => {
    mockSystemLimit.mockResolvedValue([]);

    await incrementCampaignCounters(CALL_ID);

    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });
});

// ─── Tests: emitOutcomeEvents ─────────────────────────────────────────────────

describe('emitOutcomeEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSystemSelect.mockReturnValue({ from: mockSystemFrom });
    mockSystemFrom.mockReturnValue({ where: mockSystemWhere });
    mockSystemWhere.mockReturnValue({ limit: mockSystemLimit });
    vi.mocked(sendInngestEvent).mockResolvedValue(undefined);
  });

  it('emits appointment/booked when outcome is appointment_booked', async () => {
    mockSystemLimit.mockResolvedValue([{
      ...baseCallRow,
      outcome: 'appointment_booked',
    }]);

    await emitOutcomeEvents(CALL_ID);

    expect(sendInngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'appointment/booked',
        data: expect.objectContaining({ callId: CALL_ID, orgId: ORG_ID }),
        id: `appointment-booked-${CALL_ID}`,
      }),
    );
  });

  it('emits contact/do-not-call when outcome is do_not_call', async () => {
    mockSystemLimit.mockResolvedValue([{
      ...baseCallRow,
      outcome: 'do_not_call',
    }]);

    await emitOutcomeEvents(CALL_ID);

    expect(sendInngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'contact/do-not-call',
        data: expect.objectContaining({ callId: CALL_ID, orgId: ORG_ID }),
        id: `do-not-call-${CALL_ID}`,
      }),
    );
  });

  it('emits no events for other outcomes', async () => {
    mockSystemLimit.mockResolvedValue([{
      ...baseCallRow,
      outcome: 'not_interested',
    }]);

    await emitOutcomeEvents(CALL_ID);

    expect(sendInngestEvent).not.toHaveBeenCalled();
  });

  it('is a no-op when call has no outcome yet', async () => {
    mockSystemLimit.mockResolvedValue([{ ...baseCallRow, outcome: null }]);

    await emitOutcomeEvents(CALL_ID);

    expect(sendInngestEvent).not.toHaveBeenCalled();
  });

  it('is a no-op when call not found', async () => {
    mockSystemLimit.mockResolvedValue([]);

    await emitOutcomeEvents(CALL_ID);

    expect(sendInngestEvent).not.toHaveBeenCalled();
  });
});

// ─── Tests: callCompletedHandler ─────────────────────────────────────────────

describe('callCompletedHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: call found with appointment_booked outcome
    mockSystemSelect.mockReturnValue({ from: mockSystemFrom });
    mockSystemFrom.mockReturnValue({ where: mockSystemWhere });
    mockSystemWhere.mockReturnValue({ limit: mockSystemLimit });

    let callCount = 0;
    mockSystemLimit.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // chargeCallToLedger lookup
        return Promise.resolve([{ org_id: ORG_ID, cost_cents: 500 }]);
      }
      if (callCount === 2) {
        // incrementCampaignCounters lookup
        return Promise.resolve([{ org_id: ORG_ID, campaign_id: CAMPAIGN_ID }]);
      }
      // emitOutcomeEvents lookup
      return Promise.resolve([{ ...baseCallRow, outcome: 'not_interested' }]);
    });

    mockOrgUpdate.mockImplementation(mockUpdateTable);
    mockUpdateTable.mockReturnValue({ set: mockUpdateSet });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdateWhere.mockResolvedValue(undefined);

    vi.mocked(persistCallArtifacts).mockResolvedValue(undefined);
    vi.mocked(chargeForCall).mockResolvedValue(undefined);
    vi.mocked(classifyAndFinaliseCall).mockResolvedValue(undefined);
    vi.mocked(sendInngestEvent).mockResolvedValue(undefined);
  });

  it('executes all five steps in sequence', async () => {
    await callCompletedHandler({
      callId: CALL_ID,
      orgId: ORG_ID,
      durationSeconds: 60,
      endedReason: 'completed',
      recordingUrl: null,
    });

    expect(persistCallArtifacts).toHaveBeenCalledWith(CALL_ID);
    expect(chargeForCall).toHaveBeenCalledWith(ORG_ID, CALL_ID, 500);
    expect(classifyAndFinaliseCall).toHaveBeenCalledWith(CALL_ID);
    expect(mockOrgUpdate).toHaveBeenCalledOnce(); // incrementCampaignCounters
  });

  it('charge step runs before classify step', async () => {
    const order: string[] = [];
    vi.mocked(chargeForCall).mockImplementation(async () => { order.push('charge'); });
    vi.mocked(classifyAndFinaliseCall).mockImplementation(async () => { order.push('classify'); });

    await callCompletedHandler({
      callId: CALL_ID,
      orgId: ORG_ID,
      durationSeconds: 30,
      endedReason: 'completed',
      recordingUrl: null,
    });

    expect(order.indexOf('charge')).toBeLessThan(order.indexOf('classify'));
  });
});

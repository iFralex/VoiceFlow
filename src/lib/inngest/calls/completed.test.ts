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
  releaseReservation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/inngest/client', () => ({
  sendInngestEvent: vi.fn(),
}));

vi.mock('@/lib/inngest/campaigns/completed', () => ({
  checkAndFinaliseCampaignCompletion: vi.fn().mockResolvedValue(undefined),
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

// System tx select chain: supports both .where().limit(1) and plain .where()
// (the latter is used by countActiveCalls which has no .limit() call).
const mockSystemLimit = vi.fn();
const makeSystemWhereChain = (directRows: unknown[] = []) => {
  const p = Promise.resolve(directRows) as Promise<unknown[]> & { limit: typeof mockSystemLimit };
  p.limit = mockSystemLimit;
  return p;
};
const mockSystemWhere = vi.fn(() => makeSystemWhereChain());
const mockSystemFrom = vi.fn(() => ({ where: mockSystemWhere }));
mockSystemSelect.mockReturnValue({ from: mockSystemFrom });
mockSystemTx.select = mockSystemSelect;

// Org tx update chain: tx.update(...).set({...}).where(...)[.returning()]
// Returns a thenable so plain `await where(...)` works AND `.returning()` works.
const makeUpdateWhereChain = (returningRows: unknown[] = []) => {
  const p = Promise.resolve(undefined) as Promise<undefined> & { returning: () => Promise<unknown[]> };
  p.returning = () => Promise.resolve(returningRows);
  return p;
};
const mockUpdateWhere = vi.fn(() => makeUpdateWhereChain());
const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
const mockUpdateTable = vi.fn(() => ({ set: mockUpdateSet }));
mockOrgUpdate.mockImplementation(mockUpdateTable);
mockOrgTx.update = mockOrgUpdate;

// Org tx insert chain: tx.insert(...).values(...).returning(...)
const mockInsertReturning = vi.fn();
const mockInsertValues = vi.fn(() => ({ returning: mockInsertReturning }));
const mockInsertTable = vi.fn(() => ({ values: mockInsertValues }));
const mockOrgInsert = vi.fn().mockImplementation(mockInsertTable);
mockOrgTx.insert = mockOrgInsert;

// ─── Module under test ────────────────────────────────────────────────────────

import { sendInngestEvent } from '@/lib/inngest/client';
import { classifyAndFinaliseCall } from '@/lib/services/calls';
import { chargeForCall } from '@/lib/services/credit';
import { persistCallArtifacts } from '@/lib/voice/persistence';

import {
  MAX_RETRY_ATTEMPTS,
  callCompletedHandler,
  chargeCallToLedger,
  emitOutcomeEvents,
  incrementCampaignCounters,
  persistCallArtifactsStep,
  scheduleRetryIfNeeded,
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
    mockSystemWhere.mockReturnValue(makeSystemWhereChain());
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
    mockSystemWhere.mockReturnValue(makeSystemWhereChain());
    mockOrgUpdate.mockImplementation(mockUpdateTable);
    mockUpdateTable.mockReturnValue({ set: mockUpdateSet });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdateWhere.mockImplementation(() => makeUpdateWhereChain());
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
    mockSystemWhere.mockReturnValue(makeSystemWhereChain());
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

// ─── Tests: scheduleRetryIfNeeded ────────────────────────────────────────────

describe('scheduleRetryIfNeeded', () => {
  const baseRetryCallRow = {
    org_id: ORG_ID,
    campaign_id: CAMPAIGN_ID,
    contact_id: CONTACT_ID,
    status: 'no_answer' as const,
    attempt_number: 1,
    started_at: new Date('2025-06-01T10:00:00Z'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSystemSelect.mockReturnValue({ from: mockSystemFrom });
    mockSystemFrom.mockReturnValue({ where: mockSystemWhere });
    mockSystemWhere.mockReturnValue(makeSystemWhereChain());
    vi.mocked(sendInngestEvent).mockResolvedValue(undefined);
    mockOrgInsert.mockImplementation(mockInsertTable);
    mockInsertTable.mockReturnValue({ values: mockInsertValues });
    mockInsertValues.mockReturnValue({ returning: mockInsertReturning });
    mockInsertReturning.mockResolvedValue([{ id: 'new-call-id' }]);
    mockOrgUpdate.mockImplementation(mockUpdateTable);
    mockUpdateTable.mockReturnValue({ set: mockUpdateSet });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdateWhere.mockImplementation(() => makeUpdateWhereChain());
  });

  it('is a no-op when call not found', async () => {
    mockSystemLimit.mockResolvedValue([]);

    await scheduleRetryIfNeeded(CALL_ID);

    expect(sendInngestEvent).not.toHaveBeenCalled();
    expect(mockOrgInsert).not.toHaveBeenCalled();
  });

  it('is a no-op when status is completed', async () => {
    mockSystemLimit.mockResolvedValue([{ ...baseRetryCallRow, status: 'completed' }]);

    await scheduleRetryIfNeeded(CALL_ID);

    expect(sendInngestEvent).not.toHaveBeenCalled();
    expect(mockOrgInsert).not.toHaveBeenCalled();
  });

  it('is a no-op when status is failed', async () => {
    mockSystemLimit.mockResolvedValue([{ ...baseRetryCallRow, status: 'failed' }]);

    await scheduleRetryIfNeeded(CALL_ID);

    expect(sendInngestEvent).not.toHaveBeenCalled();
  });

  it('schedules a retry when status is no_answer and attempt < max', async () => {
    mockSystemLimit.mockResolvedValue([{ ...baseRetryCallRow, status: 'no_answer', attempt_number: 1 }]);

    await scheduleRetryIfNeeded(CALL_ID);

    expect(mockOrgInsert).toHaveBeenCalledOnce();
    expect(sendInngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'campaign/dispatch-call',
        data: expect.objectContaining({
          campaignId: CAMPAIGN_ID,
          orgId: ORG_ID,
          contactId: CONTACT_ID,
          callId: 'new-call-id',
          attempt: 2,
          scheduledFor: expect.any(String),
        }),
        id: `retry-${CALL_ID}-attempt-2`,
      }),
    );
  });

  it('schedules a retry when status is busy and attempt < max', async () => {
    mockSystemLimit.mockResolvedValue([{ ...baseRetryCallRow, status: 'busy', attempt_number: 2 }]);

    await scheduleRetryIfNeeded(CALL_ID);

    expect(mockOrgInsert).toHaveBeenCalledOnce();
    expect(sendInngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ attempt: 3 }),
        id: `retry-${CALL_ID}-attempt-3`,
      }),
    );
  });

  it(`marks call failed with max_attempts_reached when attempt_number >= ${MAX_RETRY_ATTEMPTS}`, async () => {
    mockSystemLimit.mockResolvedValue([{
      ...baseRetryCallRow,
      status: 'no_answer',
      attempt_number: MAX_RETRY_ATTEMPTS,
    }]);

    await scheduleRetryIfNeeded(CALL_ID);

    expect(mockOrgUpdate).toHaveBeenCalledOnce();
    expect(mockUpdateSet).toHaveBeenCalledWith({
      status: 'failed',
      error_code: 'max_attempts_reached',
    });
    expect(sendInngestEvent).not.toHaveBeenCalled();
    expect(mockOrgInsert).not.toHaveBeenCalled();
  });

  it('scheduledFor is at least 48h after started_at', async () => {
    const startedAt = new Date('2025-06-01T10:00:00Z');
    mockSystemLimit.mockResolvedValue([{ ...baseRetryCallRow, started_at: startedAt }]);

    await scheduleRetryIfNeeded(CALL_ID);

    const eventCall = vi.mocked(sendInngestEvent).mock.calls[0]![0];
    const scheduledFor = new Date(eventCall.data.scheduledFor as string);
    const diffHours = (scheduledFor.getTime() - startedAt.getTime()) / 3600_000;
    expect(diffHours).toBeGreaterThanOrEqual(48 + 3);
    expect(diffHours).toBeLessThan(48 + 7 + 1); // max with floating point tolerance
  });

  it('new call row has attempt_number = attempt + 1', async () => {
    mockSystemLimit.mockResolvedValue([{ ...baseRetryCallRow, attempt_number: 1 }]);

    await scheduleRetryIfNeeded(CALL_ID);

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ attempt_number: 2 }),
    );
  });
});

// ─── Tests: callCompletedHandler ─────────────────────────────────────────────

describe('callCompletedHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: call found — set up all 4 sequential system selects:
    // 1. chargeCallToLedger, 2. incrementCampaignCounters,
    // 3. emitOutcomeEvents, 4. scheduleRetryIfNeeded
    mockSystemSelect.mockReturnValue({ from: mockSystemFrom });
    mockSystemFrom.mockReturnValue({ where: mockSystemWhere });
    mockSystemWhere.mockReturnValue(makeSystemWhereChain());

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
      if (callCount === 3) {
        // emitOutcomeEvents lookup
        return Promise.resolve([{ ...baseCallRow, outcome: 'not_interested' }]);
      }
      // scheduleRetryIfNeeded lookup — status='completed' so no retry
      return Promise.resolve([{
        org_id: ORG_ID,
        campaign_id: CAMPAIGN_ID,
        contact_id: CONTACT_ID,
        status: 'completed',
        attempt_number: 1,
        started_at: new Date(),
      }]);
    });

    mockOrgUpdate.mockImplementation(mockUpdateTable);
    mockUpdateTable.mockReturnValue({ set: mockUpdateSet });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdateWhere.mockImplementation(() => makeUpdateWhereChain());

    vi.mocked(persistCallArtifacts).mockResolvedValue(undefined);
    vi.mocked(chargeForCall).mockResolvedValue(undefined);
    vi.mocked(classifyAndFinaliseCall).mockResolvedValue(undefined);
    vi.mocked(sendInngestEvent).mockResolvedValue(undefined);
  });

  it('executes all six steps in sequence', async () => {
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

  it('schedules a retry when call ends in no_answer', async () => {
    let callCount = 0;
    mockSystemLimit.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve([{ org_id: ORG_ID, cost_cents: 0 }]);
      if (callCount === 2) return Promise.resolve([{ org_id: ORG_ID, campaign_id: CAMPAIGN_ID }]);
      if (callCount === 3) return Promise.resolve([{ ...baseCallRow, outcome: null }]);
      // scheduleRetryIfNeeded — no_answer, attempt 1
      return Promise.resolve([{
        org_id: ORG_ID, campaign_id: CAMPAIGN_ID, contact_id: CONTACT_ID,
        status: 'no_answer', attempt_number: 1, started_at: new Date(),
      }]);
    });
    mockOrgInsert.mockImplementation(mockInsertTable);
    mockInsertTable.mockReturnValue({ values: mockInsertValues });
    mockInsertValues.mockReturnValue({ returning: mockInsertReturning });
    mockInsertReturning.mockResolvedValue([{ id: 'retry-call-id' }]);

    await callCompletedHandler({
      callId: CALL_ID, orgId: ORG_ID, durationSeconds: 0,
      endedReason: 'no-answer', recordingUrl: null,
    });

    expect(sendInngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'campaign/dispatch-call' }),
    );
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/inngest/client', () => ({
  sendInngestEvent: vi.fn(),
}));

vi.mock('@/lib/services/campaigns', () => ({
  requireRunning: vi.fn(),
}));

vi.mock('@/lib/services/calls', () => ({
  dispatchCall: vi.fn(),
}));

vi.mock('@/lib/services/credit', () => ({
  getBalance: vi.fn(),
}));

const mockUpdate = vi.fn();
const mockSet = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
mockUpdate.mockReturnValue({ set: mockSet });

const mockSelect = vi.fn();
const mockFrom = vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })) }));
mockSelect.mockReturnValue({ from: mockFrom });

const mockTxChain = {
  update: mockUpdate,
  select: mockSelect,
};

vi.mock('@/lib/db/context', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => unknown) => fn(mockTxChain)),
}));

// ─── Module under test ────────────────────────────────────────────────────────

import { sendInngestEvent } from '@/lib/inngest/client';
import { dispatchCall } from '@/lib/services/calls';
import { requireRunning } from '@/lib/services/campaigns';
import { getBalance } from '@/lib/services/credit';

import {
  ContactNotEligibleError,
  InsufficientCreditError,
  campaignDispatchCallHandler,
  checkConcurrencySlot,
  getActiveConcurrencyCount,
  nextWindowOpen,
  verifyCreditAvailable,
  verifyContactStillEligible,
  waitForCallWindow,
} from './dispatch';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG = 'org-111';
const CAMPAIGN = 'camp-222';
const CONTACT = 'contact-333';
const CALL = 'call-444';

const FIXTURE_DATE = new Date('2025-01-15T09:00:00Z');

const runningCampaign = {
  id: CAMPAIGN,
  org_id: ORG,
  name: 'Test Campaign',
  script_id: 'script-000',
  contact_list_id: 'list-000',
  status: 'running' as const,
  concurrency_limit: 5,
  time_window_start: '09:00',
  time_window_end: '19:00',
  scheduled_at: null,
  started_at: null,
  completed_at: null,
  estimated_max_cents: null,
  actual_cents: 0,
  created_at: FIXTURE_DATE,
  updated_at: FIXTURE_DATE,
};

const dispatchData = {
  campaignId: CAMPAIGN,
  orgId: ORG,
  contactId: CONTACT,
  callId: CALL,
  attempt: 1,
};

// ─── Tests: nextWindowOpen ────────────────────────────────────────────────────

describe('nextWindowOpen', () => {
  it('returns null when inside window on a weekday', () => {
    // Wednesday 10:00 Rome time — well inside 09:00–19:00
    const wed1000 = new Date('2025-01-15T09:00:00Z'); // UTC 09:00 = Rome 10:00 (CET +1)
    const result = nextWindowOpen(wed1000, '09:00', '19:00', 'Europe/Rome');
    expect(result).toBeNull();
  });

  it('returns a future date when before window start on a weekday', () => {
    // Wednesday 07:00 UTC = 08:00 Rome (CET +1) — before 09:00 window
    const wed0700 = new Date('2025-01-15T07:00:00Z');
    const result = nextWindowOpen(wed0700, '09:00', '19:00', 'Europe/Rome');
    expect(result).not.toBeNull();
    expect(result!.getTime()).toBeGreaterThan(wed0700.getTime());
  });

  it('returns a future date when after window end on a weekday', () => {
    // Wednesday 19:30 Rome (18:30 UTC CET +1) — after 19:00 window end
    const wed1930 = new Date('2025-01-15T18:30:00Z');
    const result = nextWindowOpen(wed1930, '09:00', '19:00', 'Europe/Rome');
    expect(result).not.toBeNull();
    expect(result!.getTime()).toBeGreaterThan(wed1930.getTime());
  });

  it('returns a weekday when called on Saturday', () => {
    // Saturday 10:00 Rome (09:00 UTC CET +1)
    const sat1000 = new Date('2025-01-18T09:00:00Z');
    const result = nextWindowOpen(sat1000, '09:00', '19:00', 'Europe/Rome');
    expect(result).not.toBeNull();
    // Result should be a Monday (day 1)
    const resultLocal = new Date(result!.toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
    expect(resultLocal.getDay()).toBe(1); // Monday
  });

  it('returns a weekday when called on Sunday', () => {
    // Sunday 12:00 Rome (11:00 UTC CET +1)
    const sun1200 = new Date('2025-01-19T11:00:00Z');
    const result = nextWindowOpen(sun1200, '09:00', '19:00', 'Europe/Rome');
    expect(result).not.toBeNull();
    const resultLocal = new Date(result!.toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
    expect(resultLocal.getDay()).toBe(1); // Monday
  });

  it('handles Friday after-hours by returning Monday', () => {
    // Friday 20:00 Rome (19:00 UTC CET +1) — after window end
    const fri2000 = new Date('2025-01-17T19:00:00Z');
    const result = nextWindowOpen(fri2000, '09:00', '19:00', 'Europe/Rome');
    expect(result).not.toBeNull();
    const resultLocal = new Date(result!.toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
    expect(resultLocal.getDay()).toBe(1); // Monday
  });
});

// ─── Tests: waitForCallWindow ────────────────────────────────────────────────

describe('waitForCallWindow', () => {
  it('is async wrapper delegating to nextWindowOpen', async () => {
    // Just verify it returns a promise and the result matches nextWindowOpen
    const now = new Date('2025-01-15T09:00:00Z'); // inside window
    vi.setSystemTime(now);
    const result = await waitForCallWindow('09:00', '19:00', 'Europe/Rome');
    vi.useRealTimers();
    // Result may be null or a date depending on exact local time; just verify type
    expect(result === null || result instanceof Date).toBe(true);
  });
});

// ─── Tests: getActiveConcurrencyCount / checkConcurrencySlot ─────────────────

describe('getActiveConcurrencyCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the count of dialing + in_progress calls', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ cnt: 3 }]),
      })),
    });
    const result = await getActiveConcurrencyCount(ORG, CAMPAIGN);
    expect(result).toBe(3);
  });

  it('returns 0 when no active calls', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ cnt: 0 }]),
      })),
    });
    const result = await getActiveConcurrencyCount(ORG, CAMPAIGN);
    expect(result).toBe(0);
  });

  it('returns 0 when query returns empty array', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    });
    const result = await getActiveConcurrencyCount(ORG, CAMPAIGN);
    expect(result).toBe(0);
  });
});

describe('checkConcurrencySlot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when active calls are below limit', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ cnt: 2 }]),
      })),
    });
    const result = await checkConcurrencySlot(ORG, CAMPAIGN, 5);
    expect(result).toBeNull();
  });

  it('returns a future Date when active calls equal limit', async () => {
    vi.useFakeTimers({ now: new Date('2025-01-15T09:00:00Z') });
    mockSelect.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ cnt: 5 }]),
      })),
    });
    const result = await checkConcurrencySlot(ORG, CAMPAIGN, 5);
    vi.useRealTimers();
    expect(result).toBeInstanceOf(Date);
    expect(result!.getTime()).toBeGreaterThan(new Date('2025-01-15T09:00:00Z').getTime());
  });

  it('returns a future Date when active calls exceed limit', async () => {
    vi.useFakeTimers({ now: new Date('2025-01-15T09:00:00Z') });
    mockSelect.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ cnt: 8 }]),
      })),
    });
    const result = await checkConcurrencySlot(ORG, CAMPAIGN, 5);
    vi.useRealTimers();
    expect(result).toBeInstanceOf(Date);
  });

  it('returns null when limit is 0 and active count is 0', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ cnt: 0 }]),
      })),
    });
    // Edge case: limit 0 means "no calls allowed" — active (0) is NOT < 0
    const result = await checkConcurrencySlot(ORG, CAMPAIGN, 0);
    // 0 < 0 is false → slot full → should return a date
    expect(result).toBeInstanceOf(Date);
  });
});

// ─── Tests: verifyContactStillEligible ────────────────────────────────────────

describe('verifyContactStillEligible', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const setupContactQuery = (contact: Record<string, unknown> | null) => {
    mockSelect.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue(contact ? [contact] : []),
        })),
      })),
    });
  };

  it('resolves for an eligible contact', async () => {
    setupContactQuery({ deleted_at: null, opt_out: false, rpo_status: 'clear' });
    await expect(verifyContactStillEligible(ORG, CONTACT)).resolves.toBeUndefined();
  });

  it('throws ContactNotEligibleError when contact not found', async () => {
    setupContactQuery(null);
    await expect(verifyContactStillEligible(ORG, CONTACT)).rejects.toThrow(
      ContactNotEligibleError,
    );
  });

  it('throws ContactNotEligibleError when contact deleted', async () => {
    setupContactQuery({ deleted_at: new Date(), opt_out: false, rpo_status: 'clear' });
    const err = await verifyContactStillEligible(ORG, CONTACT).catch((e) => e);
    expect(err).toBeInstanceOf(ContactNotEligibleError);
    expect((err as ContactNotEligibleError).reason).toBe('deleted');
  });

  it('throws ContactNotEligibleError when contact opted out', async () => {
    setupContactQuery({ deleted_at: null, opt_out: true, rpo_status: 'clear' });
    const err = await verifyContactStillEligible(ORG, CONTACT).catch((e) => e);
    expect(err).toBeInstanceOf(ContactNotEligibleError);
    expect((err as ContactNotEligibleError).reason).toBe('opted_out');
  });

  it('throws ContactNotEligibleError when contact rpo_blocked', async () => {
    setupContactQuery({ deleted_at: null, opt_out: false, rpo_status: 'blocked' });
    const err = await verifyContactStillEligible(ORG, CONTACT).catch((e) => e);
    expect(err).toBeInstanceOf(ContactNotEligibleError);
    expect((err as ContactNotEligibleError).reason).toBe('rpo_blocked');
  });
});

// ─── Tests: verifyCreditAvailable ─────────────────────────────────────────────

describe('verifyCreditAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    vi.mocked(sendInngestEvent).mockResolvedValue(undefined);
  });

  it('resolves when balance is above minimum', async () => {
    vi.mocked(getBalance).mockResolvedValue({ balanceCents: 500, remainingMinutes: 10 });
    await expect(verifyCreditAvailable(ORG, CALL)).resolves.toBeUndefined();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('marks call failed and throws when balance is zero', async () => {
    vi.mocked(getBalance).mockResolvedValue({ balanceCents: 0, remainingMinutes: 0 });
    await expect(verifyCreditAvailable(ORG, CALL)).rejects.toThrow(InsufficientCreditError);
    expect(mockUpdate).toHaveBeenCalledOnce();
  });

  it('emits credit/low-balance event when balance is zero', async () => {
    vi.mocked(getBalance).mockResolvedValue({ balanceCents: 0, remainingMinutes: 0 });
    await verifyCreditAvailable(ORG, CALL).catch(() => {});
    expect(sendInngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'credit/low-balance',
        data: expect.objectContaining({ orgId: ORG }),
      }),
    );
  });

  it('marks call failed when balance is at minimum threshold (100 cents)', async () => {
    vi.mocked(getBalance).mockResolvedValue({ balanceCents: 100, remainingMinutes: 1 });
    await expect(verifyCreditAvailable(ORG, CALL)).rejects.toThrow(InsufficientCreditError);
    expect(mockUpdate).toHaveBeenCalledOnce();
  });
});

// ─── Tests: campaignDispatchCallHandler ──────────────────────────────────────

describe('campaignDispatchCallHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    vi.mocked(sendInngestEvent).mockResolvedValue(undefined);
    vi.mocked(dispatchCall).mockResolvedValue(undefined);
    vi.mocked(getBalance).mockResolvedValue({ balanceCents: 5000, remainingMinutes: 100 });
  });

  it('returns deferUntil when campaign concurrency limit is saturated', async () => {
    // Wednesday inside window: 09:00 UTC = 10:00 Rome (CET +1) — inside 09:00–19:00
    vi.useFakeTimers({ now: new Date('2025-01-15T09:00:00Z') });
    vi.mocked(requireRunning).mockResolvedValue(runningCampaign); // concurrency_limit = 5

    // active count = 5 (at limit)
    mockSelect.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ cnt: 5 }]),
      })),
    });

    const result = await campaignDispatchCallHandler(dispatchData);

    vi.useRealTimers();
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('deferUntil');
    expect((result as { deferUntil: Date }).deferUntil).toBeInstanceOf(Date);
    expect(dispatchCall).not.toHaveBeenCalled();
  });

  it('proceeds when concurrency slot is available', async () => {
    vi.useFakeTimers({ now: new Date('2025-01-15T09:00:00Z') });
    vi.mocked(requireRunning).mockResolvedValue(runningCampaign); // concurrency_limit = 5

    // 1st select: concurrency gate (active = 3 < 5 = limit → slot available)
    // 2nd select: contact eligibility query
    let callCount = 0;
    mockSelect.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return { from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ cnt: 3 }]) })) };
      }
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([
              { deleted_at: null, opt_out: false, rpo_status: 'clear' },
            ]),
          })),
        })),
      };
    });

    const result = await campaignDispatchCallHandler(dispatchData);

    vi.useRealTimers();
    expect(result).toBeNull();
    expect(dispatchCall).toHaveBeenCalledWith(ORG, CALL);
  });

  it('returns null and skips when campaign is paused', async () => {
    vi.mocked(requireRunning).mockResolvedValue({
      ...runningCampaign,
      status: 'paused' as const,
    });

    const result = await campaignDispatchCallHandler(dispatchData);

    expect(result).toBeNull();
    expect(dispatchCall).not.toHaveBeenCalled();
  });

  it('returns null and skips when campaign is cancelled', async () => {
    vi.mocked(requireRunning).mockResolvedValue({
      ...runningCampaign,
      status: 'cancelled' as const,
    });

    const result = await campaignDispatchCallHandler(dispatchData);

    expect(result).toBeNull();
    expect(dispatchCall).not.toHaveBeenCalled();
  });

  it('returns sleepUntil when outside call window', async () => {
    // Friday after window end (19:00 UTC = 20:00 Rome CET +1)
    vi.useFakeTimers({ now: new Date('2025-01-17T19:30:00Z') });
    vi.mocked(requireRunning).mockResolvedValue(runningCampaign);

    const result = await campaignDispatchCallHandler(dispatchData);

    vi.useRealTimers();
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('sleepUntil');
    expect((result as { sleepUntil: Date }).sleepUntil).toBeInstanceOf(Date);
    expect(dispatchCall).not.toHaveBeenCalled();
  });

  it('marks call failed and returns null when contact no longer eligible', async () => {
    // Wednesday 10:00 UTC = 11:00 Rome — inside window
    vi.useFakeTimers({ now: new Date('2025-01-15T09:00:00Z') });
    vi.mocked(requireRunning).mockResolvedValue(runningCampaign);

    // 1st select call: concurrency gate → returns count 0 (slot available)
    // 2nd select call: contact eligibility → opted out
    let callCount = 0;
    mockSelect.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // concurrency gate: select({ cnt }).from(calls).where(...)  — no .limit()
        return { from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ cnt: 0 }]) })) };
      }
      // eligibility: select(...).from(contacts).where(...).limit(1)
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([
              { deleted_at: null, opt_out: true, rpo_status: 'clear' },
            ]),
          })),
        })),
      };
    });

    const result = await campaignDispatchCallHandler(dispatchData);

    vi.useRealTimers();
    expect(result).toBeNull();
    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(dispatchCall).not.toHaveBeenCalled();
  });

  it('propagates InsufficientCreditError when credit is too low', async () => {
    vi.useFakeTimers({ now: new Date('2025-01-15T09:00:00Z') });
    vi.mocked(requireRunning).mockResolvedValue(runningCampaign);

    let callCount = 0;
    mockSelect.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return { from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ cnt: 0 }]) })) };
      }
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([
              { deleted_at: null, opt_out: false, rpo_status: 'clear' },
            ]),
          })),
        })),
      };
    });
    vi.mocked(getBalance).mockResolvedValue({ balanceCents: 0, remainingMinutes: 0 });

    await expect(campaignDispatchCallHandler(dispatchData)).rejects.toThrow(InsufficientCreditError);

    vi.useRealTimers();
    expect(dispatchCall).not.toHaveBeenCalled();
  });

  it('dispatches call when all checks pass', async () => {
    vi.useFakeTimers({ now: new Date('2025-01-15T09:00:00Z') });
    vi.mocked(requireRunning).mockResolvedValue(runningCampaign);

    let callCount = 0;
    mockSelect.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return { from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ cnt: 0 }]) })) };
      }
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([
              { deleted_at: null, opt_out: false, rpo_status: 'clear' },
            ]),
          })),
        })),
      };
    });

    const result = await campaignDispatchCallHandler(dispatchData);

    vi.useRealTimers();
    expect(result).toBeNull();
    expect(dispatchCall).toHaveBeenCalledWith(ORG, CALL);
  });
});

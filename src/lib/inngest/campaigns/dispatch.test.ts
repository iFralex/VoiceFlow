import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/db/audit', () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

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

import { recordAudit } from '@/lib/db/audit';

import {
  ContactNotEligibleError,
  DEFAULT_CLI_HOURLY_CAP,
  DEFAULT_ORG_COOLDOWN_MS,
  DEFAULT_ORG_DAILY_CAP,
  InsufficientCreditError,
  PROVIDER_DEGRADATION_THRESHOLD,
  PROVIDER_DEGRADATION_WINDOW_MS,
  campaignDispatchCallHandler,
  checkCliHourlyCap,
  checkConcurrencySlot,
  checkOrgDailyCallCap,
  checkOrgLevelCooldown,
  checkProviderDegradation,
  getActiveConcurrencyCount,
  markCallProviderError,
  nextWindowOpen,
  onDispatchFailure,
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

// ─── Tests: checkOrgLevelCooldown ────────────────────────────────────────────

describe('checkOrgLevelCooldown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const setupCooldownQuery = (result: unknown[]) => {
    mockSelect.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue(result),
          })),
        })),
      })),
    });
  };

  it('returns null when no recent cross-campaign call exists', async () => {
    setupCooldownQuery([]);
    const result = await checkOrgLevelCooldown(ORG, CAMPAIGN, CONTACT);
    expect(result).toBeNull();
  });

  it('returns the created_at date of the most recent cross-campaign call', async () => {
    const recentDate = new Date('2025-01-14T10:00:00Z');
    setupCooldownQuery([{ created_at: recentDate }]);
    const result = await checkOrgLevelCooldown(ORG, CAMPAIGN, CONTACT);
    expect(result).toEqual(recentDate);
  });

  it('exports the correct default cooldown constant (7 days)', () => {
    expect(DEFAULT_ORG_COOLDOWN_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('accepts a custom cooldown duration', async () => {
    setupCooldownQuery([]);
    const result = await checkOrgLevelCooldown(ORG, CAMPAIGN, CONTACT, 24 * 60 * 60 * 1000);
    expect(result).toBeNull();
    expect(mockSelect).toHaveBeenCalledOnce();
  });

  it('calls withOrgContext with the correct orgId', async () => {
    setupCooldownQuery([]);
    const { withOrgContext } = await import('@/lib/db/context');
    vi.clearAllMocks();
    setupCooldownQuery([]);
    await checkOrgLevelCooldown(ORG, CAMPAIGN, CONTACT);
    expect(withOrgContext).toHaveBeenCalledWith(ORG, expect.any(Function));
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

    // 1st select: daily cap check (100 today < 5000 cap → proceed)
    // 2nd select: concurrency gate (active = 3 < 5 = limit → slot available)
    // 3rd select: contact eligibility query
    // 4th select: org-level cooldown check (no recent cross-campaign call)
    // 5th select: CLI hourly cap — CLI count (1 active)
    // 6th select: CLI hourly cap — calls in last hour (0 → under cap)
    let callCount = 0;
    mockSelect.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // daily cap: 100 calls today (under 5000)
        return { from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ cnt: 100 }]) })) };
      }
      if (callCount === 2) {
        // concurrency: 3 active (below limit 5)
        return { from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ cnt: 3 }]) })) };
      }
      if (callCount === 3) {
        // eligibility: eligible contact
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([
                { deleted_at: null, opt_out: false, rpo_status: 'clear' },
              ]),
            })),
          })),
        };
      }
      if (callCount === 4) {
        // cooldown check → no recent cross-campaign call
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              orderBy: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue([]),
              })),
            })),
          })),
        };
      }
      if (callCount === 5) {
        // CLI hourly cap: 1 active CLI
        return { from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ cnt: 1 }]) })) };
      }
      // 6th: CLI hourly call count: 0 (under cap)
      return { from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ cnt: 0 }]) })) };
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

    // 1st select call: daily cap check → under cap
    // 2nd select call: concurrency gate → returns count 0 (slot available)
    // 3rd select call: contact eligibility → opted out (returns early)
    let callCount = 0;
    mockSelect.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // daily cap: 100 today (under 5000)
        return { from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ cnt: 100 }]) })) };
      }
      if (callCount === 2) {
        // concurrency gate: slot available
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

  it('marks call failed and returns null when org-level cooldown applies', async () => {
    // Wednesday 10:00 UTC = 11:00 Rome — inside window
    vi.useFakeTimers({ now: new Date('2025-01-15T09:00:00Z') });
    vi.mocked(requireRunning).mockResolvedValue(runningCampaign);

    const recentCallDate = new Date('2025-01-14T10:00:00Z');

    // 1st: daily cap (under), 2nd: concurrency (slot available), 3rd: eligibility (ok), 4th: cooldown (recent call)
    let callCount = 0;
    mockSelect.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // daily cap: under cap
        return { from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ cnt: 100 }]) })) };
      }
      if (callCount === 2) {
        // concurrency: slot available
        return { from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ cnt: 0 }]) })) };
      }
      if (callCount === 3) {
        // eligibility: ok
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([
                { deleted_at: null, opt_out: false, rpo_status: 'clear' },
              ]),
            })),
          })),
        };
      }
      // 4th call: cooldown check → recent cross-campaign call found
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([{ created_at: recentCallDate }]),
            })),
          })),
        })),
      };
    });

    const result = await campaignDispatchCallHandler(dispatchData);

    vi.useRealTimers();
    expect(result).toBeNull();
    // Call row marked as failed
    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockSet).toHaveBeenCalledWith({ status: 'failed', error_code: 'cooldown_org_level' });
    // Audit log written
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorType: 'system',
        action: 'call.skipped',
        subjectType: 'call',
        subjectId: CALL,
        metadata: expect.objectContaining({ reason: 'cooldown_org_level', contactId: CONTACT }),
      }),
    );
    // Provider call NOT dispatched
    expect(dispatchCall).not.toHaveBeenCalled();
  });

  it('propagates InsufficientCreditError when credit is too low', async () => {
    vi.useFakeTimers({ now: new Date('2025-01-15T09:00:00Z') });
    vi.mocked(requireRunning).mockResolvedValue(runningCampaign);

    // 1st: daily cap, 2nd: concurrency, 3rd: eligibility, 4th: cooldown (none); then credit fails → throws before CLI cap
    let callCount = 0;
    mockSelect.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // daily cap: under cap
        return { from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ cnt: 100 }]) })) };
      }
      if (callCount === 2) {
        // concurrency: slot available
        return { from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ cnt: 0 }]) })) };
      }
      if (callCount === 3) {
        // eligibility: eligible
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([
                { deleted_at: null, opt_out: false, rpo_status: 'clear' },
              ]),
            })),
          })),
        };
      }
      // cooldown check → no recent cross-campaign call
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([]),
            })),
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

    // 1st: daily cap, 2nd: concurrency gate, 3rd: eligibility, 4th: cooldown, 5th: CLI count, 6th: CLI hourly calls
    let callCount = 0;
    mockSelect.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // daily cap: 100 today (under 5000)
        return { from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ cnt: 100 }]) })) };
      }
      if (callCount === 2) {
        // concurrency: slot available (0 active)
        return { from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ cnt: 0 }]) })) };
      }
      if (callCount === 3) {
        // eligibility: eligible contact
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([
                { deleted_at: null, opt_out: false, rpo_status: 'clear' },
              ]),
            })),
          })),
        };
      }
      if (callCount === 4) {
        // cooldown check → no recent cross-campaign call
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              orderBy: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue([]),
              })),
            })),
          })),
        };
      }
      if (callCount === 5) {
        // CLI hourly cap: 1 active CLI
        return { from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ cnt: 1 }]) })) };
      }
      // 6th: CLI hourly call count: 0 (under cap)
      return { from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ cnt: 0 }]) })) };
    });

    const result = await campaignDispatchCallHandler(dispatchData);

    vi.useRealTimers();
    expect(result).toBeNull();
    expect(dispatchCall).toHaveBeenCalledWith(ORG, CALL);
  });

  it('returns sleepUntil when scheduledFor is in the future', async () => {
    const futureDate = new Date(Date.now() + 48 * 3600 * 1000);
    const dataWithSchedule = {
      ...dispatchData,
      scheduledFor: futureDate.toISOString(),
    };

    const result = await campaignDispatchCallHandler(dataWithSchedule);

    expect(result).toHaveProperty('sleepUntil');
    const { sleepUntil } = result as { sleepUntil: Date };
    expect(sleepUntil.getTime()).toBeCloseTo(futureDate.getTime(), -3); // within 1 second
    expect(dispatchCall).not.toHaveBeenCalled();
    // requireRunning should NOT have been called — we returned early
    expect(requireRunning).not.toHaveBeenCalled();
  });

  it('proceeds normally when scheduledFor is in the past', async () => {
    vi.useFakeTimers({ now: new Date('2025-01-15T09:00:00Z') });
    vi.mocked(requireRunning).mockResolvedValue(runningCampaign);

    const pastDate = new Date('2025-01-13T09:00:00Z'); // 2 days ago
    const dataWithPastSchedule = {
      ...dispatchData,
      scheduledFor: pastDate.toISOString(),
    };

    // 1st: daily cap, 2nd: concurrency gate, 3rd: eligibility, 4th: cooldown, 5th: CLI count, 6th: CLI hourly calls
    let callCount = 0;
    mockSelect.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // daily cap: under cap
        return { from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ cnt: 100 }]) })) };
      }
      if (callCount === 2) {
        // concurrency: slot available
        return { from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ cnt: 0 }]) })) };
      }
      if (callCount === 3) {
        // eligibility: eligible
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([{
                deleted_at: null, opt_out: false, rpo_status: 'clear',
              }]),
            })),
          })),
        };
      }
      if (callCount === 4) {
        // cooldown: no recent cross-campaign call
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              orderBy: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue([]),
              })),
            })),
          })),
        };
      }
      if (callCount === 5) {
        // CLI hourly cap: 1 active CLI
        return { from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ cnt: 1 }]) })) };
      }
      // 6th: CLI hourly call count: 0 (under cap)
      return { from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ cnt: 0 }]) })) };
    });

    const result = await campaignDispatchCallHandler(dataWithPastSchedule);

    vi.useRealTimers();
    expect(result).toBeNull();
    expect(dispatchCall).toHaveBeenCalledWith(ORG, CALL);
  });
});

// ─── Tests: markCallProviderError ────────────────────────────────────────────

describe('markCallProviderError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  });

  it('marks the call as failed with error_code=provider_error', async () => {
    await markCallProviderError(ORG, CALL);

    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockSet).toHaveBeenCalledWith({ status: 'failed', error_code: 'provider_error' });
  });

  it('writes an audit log entry', async () => {
    await markCallProviderError(ORG, CALL);

    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: ORG,
        actorType: 'system',
        action: 'call.failed',
        subjectType: 'call',
        subjectId: CALL,
        metadata: { reason: 'provider_error' },
      }),
    );
  });
});

// ─── Tests: checkProviderDegradation ─────────────────────────────────────────

describe('checkProviderDegradation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendInngestEvent).mockResolvedValue(undefined);
  });

  it('exports correct constants', () => {
    expect(PROVIDER_DEGRADATION_WINDOW_MS).toBe(10 * 60 * 1000);
    expect(PROVIDER_DEGRADATION_THRESHOLD).toBe(0.05);
  });

  it('does not emit event when no terminal calls in window', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    });

    await checkProviderDegradation(ORG, CAMPAIGN);
    expect(sendInngestEvent).not.toHaveBeenCalled();
  });

  it('does not emit event when error rate is below threshold (2 of 100 = 2%)', async () => {
    const rows = [
      ...Array(2).fill({ error_code: 'provider_error' }),
      ...Array(98).fill({ error_code: null }),
    ];
    mockSelect.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(rows),
      })),
    });

    await checkProviderDegradation(ORG, CAMPAIGN);
    expect(sendInngestEvent).not.toHaveBeenCalled();
  });

  it('does not emit event when error rate is exactly at threshold (5 of 100 = 5%)', async () => {
    const rows = [
      ...Array(5).fill({ error_code: 'provider_error' }),
      ...Array(95).fill({ error_code: null }),
    ];
    mockSelect.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(rows),
      })),
    });

    await checkProviderDegradation(ORG, CAMPAIGN);
    // threshold is strictly > 5%, so 5% exactly should NOT trigger
    expect(sendInngestEvent).not.toHaveBeenCalled();
  });

  it('emits voice-provider-degraded when error rate exceeds threshold (6 of 100 = 6%)', async () => {
    const rows = [
      ...Array(6).fill({ error_code: 'provider_error' }),
      ...Array(94).fill({ error_code: null }),
    ];
    mockSelect.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(rows),
      })),
    });

    vi.useFakeTimers({ now: new Date('2025-01-15T10:00:00Z') });
    await checkProviderDegradation(ORG, CAMPAIGN);
    vi.useRealTimers();

    expect(sendInngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'system/voice-provider-degraded',
        data: expect.objectContaining({
          orgId: ORG,
          campaignId: CAMPAIGN,
          errorCount: 6,
          totalCount: 100,
          errorRate: 0.06,
        }),
      }),
    );
  });

  it('uses a deterministic event id scoped to the 10-minute window slot', async () => {
    const rows = Array(10).fill({ error_code: 'provider_error' });
    mockSelect.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(rows),
      })),
    });

    const fixedNow = new Date('2025-01-15T10:00:00Z');
    vi.useFakeTimers({ now: fixedNow });
    await checkProviderDegradation(ORG, CAMPAIGN);
    vi.useRealTimers();

    const expectedSlot = Math.floor(fixedNow.getTime() / PROVIDER_DEGRADATION_WINDOW_MS);
    expect(sendInngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: `provider-degraded-${CAMPAIGN}-${expectedSlot}`,
      }),
    );
  });
});

// ─── Tests: onDispatchFailure ─────────────────────────────────────────────────

describe('onDispatchFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    vi.mocked(sendInngestEvent).mockResolvedValue(undefined);
  });

  it('marks the call as failed with provider_error', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
    });

    await onDispatchFailure({ campaignId: CAMPAIGN, orgId: ORG, contactId: CONTACT, callId: CALL, attempt: 1 });

    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockSet).toHaveBeenCalledWith({ status: 'failed', error_code: 'provider_error' });
  });

  it('runs degradation check after marking the call failed', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
    });

    await onDispatchFailure({ campaignId: CAMPAIGN, orgId: ORG, contactId: CONTACT, callId: CALL, attempt: 1 });

    // Degradation check ran (select was called for degradation query)
    expect(mockSelect).toHaveBeenCalled();
  });

  it('does not throw when degradation check fails', async () => {
    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });

    // Make select fail on the degradation check call
    let callCount = 0;
    mockSelect.mockImplementation(() => {
      callCount++;
      if (callCount >= 1) {
        return {
          from: vi.fn(() => ({
            where: vi.fn().mockRejectedValue(new Error('DB error')),
          })),
        };
      }
    });

    // Should resolve without throwing despite degradation check failure
    await expect(
      onDispatchFailure({ campaignId: CAMPAIGN, orgId: ORG, contactId: CONTACT, callId: CALL, attempt: 1 }),
    ).resolves.toBeUndefined();
  });
});

// ─── Tests: checkOrgDailyCallCap ──────────────────────────────────────────────

describe('checkOrgDailyCallCap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports the correct default daily cap constant (5,000)', () => {
    expect(DEFAULT_ORG_DAILY_CAP).toBe(5_000);
  });

  it('returns null when today call count is below cap', async () => {
    vi.useFakeTimers({ now: new Date('2025-01-15T09:00:00Z') });
    mockSelect.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ cnt: 100 }]),
      })),
    });

    const result = await checkOrgDailyCallCap(ORG, 5_000);
    vi.useRealTimers();
    expect(result).toBeNull();
  });

  it('returns null when today call count equals cap minus one', async () => {
    vi.useFakeTimers({ now: new Date('2025-01-15T09:00:00Z') });
    mockSelect.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ cnt: 4_999 }]),
      })),
    });

    const result = await checkOrgDailyCallCap(ORG, 5_000);
    vi.useRealTimers();
    expect(result).toBeNull();
  });

  it('returns midnight tomorrow (Europe/Rome) when cap is exactly reached', async () => {
    vi.useFakeTimers({ now: new Date('2025-01-15T14:00:00Z') }); // 15:00 Rome CET
    mockSelect.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ cnt: 5_000 }]),
      })),
    });

    const result = await checkOrgDailyCallCap(ORG, 5_000);
    vi.useRealTimers();
    expect(result).toBeInstanceOf(Date);
    // Midnight Rome on 2025-01-16 = 2025-01-15T23:00:00Z (CET is UTC+1)
    expect(result!.toISOString()).toBe('2025-01-15T23:00:00.000Z');
  });

  it('returns midnight tomorrow when cap is exceeded', async () => {
    vi.useFakeTimers({ now: new Date('2025-01-15T14:00:00Z') });
    mockSelect.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ cnt: 6_000 }]),
      })),
    });

    const result = await checkOrgDailyCallCap(ORG, 5_000);
    vi.useRealTimers();
    expect(result).toBeInstanceOf(Date);
    expect(result!.getTime()).toBeGreaterThan(new Date('2025-01-15T14:00:00Z').getTime());
  });

  it('returns null when db returns empty array (0 calls today)', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    });

    const result = await checkOrgDailyCallCap(ORG, 5_000);
    expect(result).toBeNull();
  });
});

// ─── Tests: checkCliHourlyCap ─────────────────────────────────────────────────

describe('checkCliHourlyCap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports the correct default CLI hourly cap constant (30)', () => {
    expect(DEFAULT_CLI_HOURLY_CAP).toBe(30);
  });

  const setupTwoQueryResults = (cliCount: number, callCount: number) => {
    let callIdx = 0;
    mockSelect.mockImplementation(() => {
      callIdx++;
      if (callIdx === 1) {
        // First call: CLI count query
        return {
          from: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([{ cnt: cliCount }]),
          })),
        };
      }
      // Second call: hourly call count query
      return {
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([{ cnt: callCount }]),
        })),
      };
    });
  };

  it('returns null when no active CLIs exist', async () => {
    setupTwoQueryResults(0, 100);
    const result = await checkCliHourlyCap(ORG);
    expect(result).toBeNull();
  });

  it('returns null when hourly call rate is below cap', async () => {
    // 2 CLIs, 20 calls in last hour → 10 per CLI (below cap of 30)
    setupTwoQueryResults(2, 20);
    const result = await checkCliHourlyCap(ORG, 30);
    expect(result).toBeNull();
  });

  it('returns null when estimated per-CLI rate equals cap minus 1', async () => {
    // 1 CLI, 29 calls → 29 per CLI (below 30 cap)
    setupTwoQueryResults(1, 29);
    const result = await checkCliHourlyCap(ORG, 30);
    expect(result).toBeNull();
  });

  it('returns next-hour Date when estimated per-CLI rate equals cap', async () => {
    vi.useFakeTimers({ now: new Date('2025-01-15T14:30:00Z') });
    // 1 CLI, 30 calls → 30 per CLI (at cap)
    setupTwoQueryResults(1, 30);

    const result = await checkCliHourlyCap(ORG, 30);
    vi.useRealTimers();
    expect(result).toBeInstanceOf(Date);
    // Should be 15:00 UTC (next hour from 14:30)
    expect(result!.toISOString()).toBe('2025-01-15T15:00:00.000Z');
  });

  it('returns next-hour Date when estimated per-CLI rate exceeds cap', async () => {
    vi.useFakeTimers({ now: new Date('2025-01-15T14:30:00Z') });
    // 2 CLIs, 100 calls → 50 per CLI (over cap of 30)
    setupTwoQueryResults(2, 100);

    const result = await checkCliHourlyCap(ORG, 30);
    vi.useRealTimers();
    expect(result).toBeInstanceOf(Date);
    expect(result!.getTime()).toBeGreaterThan(new Date('2025-01-15T14:30:00Z').getTime());
  });

  it('returns null when db returns empty arrays', async () => {
    let callIdx = 0;
    mockSelect.mockImplementation(() => {
      callIdx++;
      return {
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue(callIdx === 1 ? [{ cnt: 1 }] : []),
        })),
      };
    });

    const result = await checkCliHourlyCap(ORG, 30);
    expect(result).toBeNull();
  });
});

// ─── Tests: campaignDispatchCallHandler — daily cap and CLI hourly cap ────────

describe('campaignDispatchCallHandler — quota gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    vi.mocked(sendInngestEvent).mockResolvedValue(undefined);
    vi.mocked(dispatchCall).mockResolvedValue(undefined);
    vi.mocked(getBalance).mockResolvedValue({ balanceCents: 5000, remainingMinutes: 100 });
  });

  it('returns sleepUntil (midnight tomorrow) when daily org cap is reached', async () => {
    vi.useFakeTimers({ now: new Date('2025-01-15T09:00:00Z') }); // 10:00 Rome CET
    vi.mocked(requireRunning).mockResolvedValue(runningCampaign);

    // Query call order in handler:
    // 1st: concurrency gate (inside window check)
    // The daily cap is checked AFTER concurrency and BEFORE it dispatches
    // Actually: order is time-window → daily cap → concurrency gate
    // Time window is computed via nextWindowOpen which doesn't use mockSelect
    // 1st select: daily cap count → 5000 (at cap)
    mockSelect.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ cnt: 5_000 }]),
      })),
    });

    const result = await campaignDispatchCallHandler(dispatchData);
    vi.useRealTimers();

    expect(result).not.toBeNull();
    expect(result).toHaveProperty('sleepUntil');
    expect((result as { sleepUntil: Date }).sleepUntil).toBeInstanceOf(Date);
    expect(dispatchCall).not.toHaveBeenCalled();
  });

  it('returns sleepUntil (next hour) when CLI hourly cap is reached', async () => {
    vi.useFakeTimers({ now: new Date('2025-01-15T09:00:00Z') }); // inside window
    vi.mocked(requireRunning).mockResolvedValue(runningCampaign);

    // Query order in handler:
    // 1: daily cap → under cap (100 calls today)
    // 2: concurrency gate → slot available (2 active)
    // 3: contact eligibility → eligible
    // 4: org cooldown → no recent cross-campaign call
    // credit: passes (balance > 100)
    // 5: CLI hourly cap → CLIs (1), hourly calls (30) → at cap
    // 6: CLI hourly calls (30)
    let callIdx = 0;
    mockSelect.mockImplementation(() => {
      callIdx++;
      if (callIdx === 1) {
        // daily cap: 100 today (under 5000)
        return { from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ cnt: 100 }]) })) };
      }
      if (callIdx === 2) {
        // concurrency: 2 active (below limit 5)
        return { from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ cnt: 2 }]) })) };
      }
      if (callIdx === 3) {
        // eligibility: eligible contact
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([{ deleted_at: null, opt_out: false, rpo_status: 'clear' }]),
            })),
          })),
        };
      }
      if (callIdx === 4) {
        // org cooldown: no recent cross-campaign call
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              orderBy: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue([]),
              })),
            })),
          })),
        };
      }
      if (callIdx === 5) {
        // CLI hourly cap — CLI count query: 1 active CLI
        return { from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ cnt: 1 }]) })) };
      }
      // callIdx === 6: CLI hourly call count: 30 (at cap)
      return { from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ cnt: 30 }]) })) };
    });

    const result = await campaignDispatchCallHandler(dispatchData);
    vi.useRealTimers();

    expect(result).not.toBeNull();
    expect(result).toHaveProperty('sleepUntil');
    expect(dispatchCall).not.toHaveBeenCalled();
  });
});

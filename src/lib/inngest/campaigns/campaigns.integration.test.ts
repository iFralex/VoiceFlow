/**
 * Integration tests for the campaign engine Inngest dispatch chain.
 *
 * Group A — service-level integration (mocked DB context):
 *   Exercises cross-service interactions (pause/cancel gates, time-window
 *   enforcement, credit checks, opt-out eligibility, retry scheduling, and
 *   the end-to-end happy path) without requiring a real database.
 *
 * Group B — database integration (require TEST_DATABASE_URL):
 *   Uses `withTestDb` (auto-rolled-back transaction) with an overridden
 *   `withOrgContext` mock to verify actual Postgres-level behaviour:
 *   pending-call row creation for large contact batches and the
 *   `verifyContactStillEligible` eligibility re-check.
 *
 * Prerequisites for Group B:
 *   docker compose -f infra/test/docker-compose.yml up -d
 *   DATABASE_DIRECT_URL=postgresql://postgres:postgres@localhost:5433/vox_auto_test \
 *     pnpm db:migrate
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/vox_auto_test
 */

// ─── Mocks (hoisted before any imports) ──────────────────────────────────────

vi.mock('@/lib/db/audit', () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/inngest/client', () => ({
  sendInngestEvent: vi.fn().mockResolvedValue(undefined),
  sendInngestEvents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/services/campaigns', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services/campaigns')>(
    '@/lib/services/campaigns',
  );
  return {
    ...actual,
    requireRunning: vi.fn(), // override only for dispatch handler tests
  };
});

vi.mock('@/lib/services/billing-rules', () => ({
  computePerMinuteCents: vi.fn().mockResolvedValue(50),
  estimateCampaignCost: vi.fn().mockReturnValue({ maxCents: 5_000 }),
  computeCallCost: vi.fn().mockReturnValue({ billableSeconds: 60, costCents: 50 }),
}));

// DPA gate (plan 11 task 16): launchCampaign now consults getDpaStatus, so we
// stub it to `current` for these dispatch / launch tests. The actual DPA
// blocking path is exercised in src/lib/services/campaigns.test.ts.
vi.mock('@/lib/compliance/dpa', () => ({
  getDpaStatus: vi.fn().mockResolvedValue({
    state: 'current',
    record: {
      acceptedAt: '2026-01-01T00:00:00.000Z',
      version: '2026-01-01',
      acceptedByUserId: 'user-1',
      ip: null,
      userAgent: null,
    },
  }),
}));

vi.mock('@/lib/services/eligibility', () => ({
  findEligibleContactsForCampaign: vi.fn(),
}));

vi.mock('@/lib/services/calls', () => ({
  dispatchCall: vi.fn().mockResolvedValue(undefined),
  classifyAndFinaliseCall: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/services/credit', () => ({
  getBalance: vi.fn(),
  reserveForCampaign: vi.fn().mockResolvedValue(undefined),
  releaseReservation: vi.fn().mockResolvedValue(undefined),
  chargeForCall: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/voice/persistence', () => ({
  persistCallArtifacts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/voice/factory', () => ({
  getVoiceProviderByName: vi.fn().mockReturnValue({
    cancelCall: vi.fn().mockResolvedValue(undefined),
  }),
}));

// DB context — overridden per test via useMockTx() or useTestDbTx()
vi.mock('@/lib/db/context', () => ({
  withOrgContext: vi.fn(),
  withSystemContext: vi.fn(),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withOrgContext, withSystemContext } from '@/lib/db/context';
import {
  calls,
  campaigns,
  contactLists,
  contacts,
  organizations,
  scriptTemplates,
  scripts,
} from '@/lib/db/schema';
import { scheduleRetryIfNeeded, MAX_RETRY_ATTEMPTS } from '@/lib/inngest/calls/completed';
import {
  campaignDispatchCallHandler,
  ContactNotEligibleError,
  verifyContactStillEligible,
} from '@/lib/inngest/campaigns/dispatch';
import { CAMPAIGN_DISPATCH_CALL_EVENT } from '@/lib/inngest/campaigns/events';
import { campaignLaunchedHandler } from '@/lib/inngest/campaigns/launched';
import { sendInngestEvent, sendInngestEvents } from '@/lib/inngest/client';
import { dispatchCall } from '@/lib/services/calls';
import { launchCampaign, requireRunning } from '@/lib/services/campaigns';
import { getBalance } from '@/lib/services/credit';
import { findEligibleContactsForCampaign } from '@/lib/services/eligibility';
import { withTestDb } from '@/test/db';

// ─── Constants ────────────────────────────────────────────────────────────────

// Using 9x UUIDs to avoid collisions with other integration test files.
const ORG = '90000000-0000-0000-0000-000000000001';
const CAMPAIGN = '90000000-0000-0000-0000-000000000010';
const CONTACT = '90000000-0000-0000-0000-000000000020';
const CALL = '90000000-0000-0000-0000-000000000030';
const LIST = '90000000-0000-0000-0000-000000000040';
const SCRIPT = '90000000-0000-0000-0000-000000000050';
const TEMPLATE = '90000000-0000-0000-0000-000000000060';

const skipWhenNoDb = !process.env['TEST_DATABASE_URL'];

// ─── Mock tx helpers ──────────────────────────────────────────────────────────

/**
 * A chainable select result that is ALSO awaitable (thenable).
 *
 * When awaited directly as `await tx.select().from().where()`, it resolves
 * to `data`.  When further chained with `.limit()`, `.orderBy()`, etc. it
 * still resolves to `data`.  This mirrors how drizzle-orm's query builder
 * is both chainable and directly await-able.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeSelectChain(data: any[]): any {
  const self: Record<string, unknown> = {};

  // Thenable — makes `await selectChain` work without .limit()
  self['then'] = (
    resolve: (val: unknown) => void,
    reject?: (err: unknown) => void,
  ) => Promise.resolve(data).then(resolve, reject);
  self['catch'] = (reject: (err: unknown) => void) =>
    Promise.resolve(data).catch(reject);

  // Chainable methods return self so additional chains work
  self['from'] = vi.fn(() => self);
  self['where'] = vi.fn(() => self);
  self['orderBy'] = vi.fn(() => self);
  self['for'] = vi.fn(() => self);

  // Terminal methods resolve immediately
  self['limit'] = vi.fn(() => Promise.resolve(data));
  self['groupBy'] = vi.fn(() => Promise.resolve(data));

  return self;
}

/**
 * Builds a minimal mock transaction whose `select()` method dequeues results
 * from `selectQueue` in FIFO order.  All writes are no-ops that succeed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildMockTx(selectQueue: any[][] = []) {
  let idx = 0;

  return {
    select: vi.fn(() => {
      const data = selectQueue[idx++] ?? [];
      return makeSelectChain(data);
    }),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ id: 'updated-id' }]),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((vals: unknown[]) => ({
        returning: vi.fn().mockResolvedValue(
          (Array.isArray(vals) ? vals : []).map((_, i) => ({
            id: `call-${i}`,
            contact_id: `contact-${i}`,
          })),
        ),
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([]),
        })),
      })),
    })),
    execute: vi.fn().mockResolvedValue([]),
  };
}

/**
 * Configures both `withOrgContext` and `withSystemContext` to use a fresh
 * mock tx built from the given select queue.  Returns the mock tx so tests
 * can inspect it if needed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function useMockTx(selectQueue: any[][] = []) {
  const tx = buildMockTx(selectQueue);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(withOrgContext).mockImplementation((_orgId: string, fn: any) =>
    Promise.resolve(fn(tx)),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(withSystemContext).mockImplementation((fn: any) =>
    Promise.resolve(fn(tx)),
  );
  return tx;
}

// ─── Shared running-campaign fixture ─────────────────────────────────────────

const RUNNING_CAMPAIGN = {
  id: CAMPAIGN,
  org_id: ORG,
  status: 'running' as const,
  concurrency_limit: 5,
  time_window_start: '09:00',
  time_window_end: '19:00',
  script_id: SCRIPT,
  contact_list_id: LIST,
  name: 'Test Campaign',
  scheduled_at: null,
  started_at: new Date(),
  completed_at: null,
  estimated_max_cents: null,
  actual_cents: 0,
  created_at: new Date(),
  updated_at: new Date(),
};

const DISPATCH_DATA = {
  campaignId: CAMPAIGN,
  orgId: ORG,
  contactId: CONTACT,
  callId: CALL,
  attempt: 1,
};

// ─── Group A: campaign state gates (pause / cancel) ──────────────────────────

describe('campaignDispatchCallHandler — campaign state gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null immediately when campaign is paused', async () => {
    vi.mocked(requireRunning).mockResolvedValue({
      ...RUNNING_CAMPAIGN,
      status: 'paused' as const,
    });

    const result = await campaignDispatchCallHandler(DISPATCH_DATA);
    expect(result).toBeNull();

    // Must not attempt any further gates after the status check
    expect(dispatchCall).not.toHaveBeenCalled();
  });

  it('returns null immediately when campaign is cancelled', async () => {
    vi.mocked(requireRunning).mockResolvedValue({
      ...RUNNING_CAMPAIGN,
      status: 'cancelled' as const,
    });

    const result = await campaignDispatchCallHandler(DISPATCH_DATA);
    expect(result).toBeNull();
    expect(dispatchCall).not.toHaveBeenCalled();
  });

  it('pause → dispatch skips; resume → dispatch proceeds to provider', async () => {
    // Pause: dispatch returns null
    vi.mocked(requireRunning).mockResolvedValue({
      ...RUNNING_CAMPAIGN,
      status: 'paused' as const,
    });
    const pauseResult = await campaignDispatchCallHandler(DISPATCH_DATA);
    expect(pauseResult).toBeNull();
    expect(dispatchCall).not.toHaveBeenCalled();

    vi.clearAllMocks();

    // Resume: dispatch proceeds through all gates
    vi.mocked(requireRunning).mockResolvedValue(RUNNING_CAMPAIGN);
    vi.mocked(getBalance).mockResolvedValue({
      balanceCents: 50_000,
      remainingMinutes: 100,
    });

    // Mock time to 10:00 Rome (inside window)
    vi.setSystemTime(new Date('2024-06-10T08:00:00Z')); // 10:00 Rome (UTC+2 in June)

    // Select queue: daily-cap count, concurrency count, contact eligibility,
    // cooldown check, CLI count, CLI call count
    useMockTx([
      [{ cnt: 100 }], // daily cap: 100 calls today < 5000
      [{ cnt: 1 }], // concurrency: 1 active < 5
      [{ deleted_at: null, opt_out: false, rpo_status: 'clear' }], // contact eligible
      [], // no cross-campaign cooldown
      [{ cnt: 2 }], // 2 active CLIs
      [{ cnt: 10 }], // 10 calls in last hour; 10/2 = 5 < 30
    ]);

    vi.mocked(dispatchCall).mockResolvedValue(undefined);

    const resumeResult = await campaignDispatchCallHandler(DISPATCH_DATA);
    expect(resumeResult).toBeNull();
    expect(dispatchCall).toHaveBeenCalledOnce();

    vi.useRealTimers();
  });
});

// ─── Group B: time-window enforcement ────────────────────────────────────────

describe('campaignDispatchCallHandler — time-window enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRunning).mockResolvedValue(RUNNING_CAMPAIGN);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns sleepUntil when dispatching at 22:30 Rome time', async () => {
    // Monday 2024-06-10 at 22:30 Rome (UTC+2 in June) = 20:30 UTC
    vi.setSystemTime(new Date('2024-06-10T20:30:00Z'));

    // Before reaching time-window check we only need requireRunning to have been called.
    // The daily-cap check runs AFTER time-window and won't be reached.
    useMockTx(); // no select calls needed

    const result = await campaignDispatchCallHandler(DISPATCH_DATA);

    expect(result).not.toBeNull();
    expect(result).toHaveProperty('sleepUntil');
    expect('sleepUntil' in result!).toBe(true);

    const { sleepUntil } = result as { sleepUntil: Date };
    // sleepUntil should be AFTER the current time (still in the future)
    expect(sleepUntil.getTime()).toBeGreaterThan(Date.now());
    // sleepUntil should be within 24 h (next day 09:00)
    expect(sleepUntil.getTime()).toBeLessThan(Date.now() + 24 * 60 * 60 * 1000);
  });

  it('proceeds (does not return sleepUntil) when dispatching at 10:00 on a weekday', async () => {
    // Monday 2024-06-10 at 10:00 Rome (UTC+2) = 08:00 UTC
    vi.setSystemTime(new Date('2024-06-10T08:00:00Z'));
    vi.mocked(getBalance).mockResolvedValue({ balanceCents: 50_000, remainingMinutes: 100 });

    useMockTx([
      [{ cnt: 100 }], // daily cap
      [{ cnt: 1 }], // concurrency
      [{ deleted_at: null, opt_out: false, rpo_status: 'clear' }], // eligible
      [], // no cooldown
      [{ cnt: 2 }], // 2 CLIs
      [{ cnt: 10 }], // hourly call count
    ]);

    const result = await campaignDispatchCallHandler(DISPATCH_DATA);
    // Should complete dispatch (return null) without sleeping
    expect(result).toBeNull();
    expect(dispatchCall).toHaveBeenCalledOnce();
  });
});

// ─── Group C: credit gate ─────────────────────────────────────────────────────

describe('campaignDispatchCallHandler — credit gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRunning).mockResolvedValue(RUNNING_CAMPAIGN);
    // Mock to an inside-window time
    vi.setSystemTime(new Date('2024-06-10T08:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks call failed and throws when balance ≤ MIN_BALANCE_CENTS', async () => {
    vi.mocked(getBalance).mockResolvedValue({ balanceCents: 50, remainingMinutes: 0 });

    // Need mock tx for daily cap, concurrency, eligibility, cooldown checks
    // (credit check runs after cooldown but getBalance is mocked)
    useMockTx([
      [{ cnt: 100 }], // daily cap
      [{ cnt: 1 }], // concurrency
      [{ deleted_at: null, opt_out: false, rpo_status: 'clear' }], // eligible
      [], // no cooldown
    ]);

    await expect(campaignDispatchCallHandler(DISPATCH_DATA)).rejects.toThrow();
    expect(dispatchCall).not.toHaveBeenCalled();
  });

  it('launches calls when balance > MIN_BALANCE_CENTS', async () => {
    vi.mocked(getBalance).mockResolvedValue({ balanceCents: 50_000, remainingMinutes: 1000 });

    useMockTx([
      [{ cnt: 100 }], // daily cap
      [{ cnt: 1 }], // concurrency
      [{ deleted_at: null, opt_out: false, rpo_status: 'clear' }], // eligible
      [], // no cooldown
      [{ cnt: 2 }], // CLIs
      [{ cnt: 10 }], // hourly calls
    ]);

    const result = await campaignDispatchCallHandler(DISPATCH_DATA);
    expect(result).toBeNull();
    expect(dispatchCall).toHaveBeenCalledOnce();
  });
});

// ─── Group D: contact opt-out between planning and dispatch ───────────────────

describe('campaignDispatchCallHandler — opt-out between planning and dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRunning).mockResolvedValue(RUNNING_CAMPAIGN);
    vi.setSystemTime(new Date('2024-06-10T08:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks call failed and returns null when contact has opted out', async () => {
    useMockTx([
      [{ cnt: 100 }], // daily cap
      [{ cnt: 1 }], // concurrency
      [{ deleted_at: null, opt_out: true, rpo_status: 'clear' }], // opted out!
    ]);

    const result = await campaignDispatchCallHandler(DISPATCH_DATA);
    expect(result).toBeNull();
    expect(dispatchCall).not.toHaveBeenCalled();
  });

  it('marks call failed and returns null when contact has been deleted', async () => {
    useMockTx([
      [{ cnt: 100 }], // daily cap
      [{ cnt: 1 }], // concurrency
      [{ deleted_at: new Date(), opt_out: false, rpo_status: 'clear' }], // deleted!
    ]);

    const result = await campaignDispatchCallHandler(DISPATCH_DATA);
    expect(result).toBeNull();
    expect(dispatchCall).not.toHaveBeenCalled();
  });
});

// ─── Group E: retry policy ────────────────────────────────────────────────────

describe('scheduleRetryIfNeeded — retry policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('schedules a retry event with scheduledFor ≥ 48h out for no_answer (attempt 1)', async () => {
    const callRow = {
      org_id: ORG,
      campaign_id: CAMPAIGN,
      contact_id: CONTACT,
      status: 'no_answer' as const,
      attempt_number: 1,
      started_at: new Date('2024-06-10T10:00:00Z'),
    };

    // withSystemContext: system-level call lookup
    // withOrgContext: insert new pending call row
    vi.mocked(withSystemContext).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fn: any) => Promise.resolve(fn({ select: vi.fn(() => makeSelectChain([callRow])) })),
    );

    const mockInsertReturning = vi.fn().mockResolvedValue([{ id: 'retry-call-id' }]);
    vi.mocked(withOrgContext).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (_: string, fn: any) =>
        Promise.resolve(
          fn({
            insert: vi.fn(() => ({
              values: vi.fn(() => ({ returning: mockInsertReturning })),
            })),
          }),
        ),
    );

    await scheduleRetryIfNeeded(CALL);

    expect(sendInngestEvent).toHaveBeenCalledOnce();
    const [eventArg] = vi.mocked(sendInngestEvent).mock.calls[0]!;
    const event = eventArg as {
      name: string;
      data: { scheduledFor?: string; attempt: number };
    };

    expect(event.name).toBe(CAMPAIGN_DISPATCH_CALL_EVENT);
    expect(event.data.attempt).toBe(2);
    expect(event.data.scheduledFor).toBeDefined();

    // scheduledFor must be at least 48 hours from call start
    const scheduledFor = new Date(event.data.scheduledFor!);
    const minRetryTime = new Date('2024-06-10T10:00:00Z').getTime() + 48 * 3600 * 1000;
    expect(scheduledFor.getTime()).toBeGreaterThanOrEqual(minRetryTime);

    // And it should also have a time-of-day offset (≥3h extra)
    const minWithOffset = minRetryTime + 3 * 3600 * 1000;
    expect(scheduledFor.getTime()).toBeGreaterThanOrEqual(minWithOffset);
  });

  it('marks call failed/max_attempts_reached when attempt equals MAX_RETRY_ATTEMPTS', async () => {
    const callRow = {
      org_id: ORG,
      campaign_id: CAMPAIGN,
      contact_id: CONTACT,
      status: 'no_answer' as const,
      attempt_number: MAX_RETRY_ATTEMPTS, // max attempts reached
      started_at: new Date(),
    };

    vi.mocked(withSystemContext).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fn: any) => Promise.resolve(fn({ select: vi.fn(() => makeSelectChain([callRow])) })),
    );

    const mockUpdateWhere = vi.fn().mockResolvedValue([{ id: CALL }]);
    const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
    vi.mocked(withOrgContext).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (_: string, fn: any) =>
        Promise.resolve(fn({ update: vi.fn(() => ({ set: mockUpdateSet })) })),
    );

    await scheduleRetryIfNeeded(CALL);

    // No retry event must be emitted
    expect(sendInngestEvent).not.toHaveBeenCalled();

    // The call row must be updated to failed/max_attempts_reached
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error_code: 'max_attempts_reached',
      }),
    );
  });

  it('does not schedule a retry for a completed call', async () => {
    const callRow = {
      org_id: ORG,
      campaign_id: CAMPAIGN,
      contact_id: CONTACT,
      status: 'completed' as const,
      attempt_number: 1,
      started_at: new Date(),
    };

    vi.mocked(withSystemContext).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fn: any) => Promise.resolve(fn({ select: vi.fn(() => makeSelectChain([callRow])) })),
    );

    await scheduleRetryIfNeeded(CALL);

    expect(sendInngestEvent).not.toHaveBeenCalled();
    expect(withOrgContext).not.toHaveBeenCalled();
  });

  it('does not schedule a retry for a busy call at attempt 3', async () => {
    const callRow = {
      org_id: ORG,
      campaign_id: CAMPAIGN,
      contact_id: CONTACT,
      status: 'busy' as const,
      attempt_number: MAX_RETRY_ATTEMPTS,
      started_at: new Date(),
    };

    vi.mocked(withSystemContext).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fn: any) => Promise.resolve(fn({ select: vi.fn(() => makeSelectChain([callRow])) })),
    );

    const mockUpdateSet = vi.fn(() => ({
      where: vi.fn().mockResolvedValue([{ id: CALL }]),
    }));
    vi.mocked(withOrgContext).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (_: string, fn: any) =>
        Promise.resolve(fn({ update: vi.fn(() => ({ set: mockUpdateSet })) })),
    );

    await scheduleRetryIfNeeded(CALL);

    expect(sendInngestEvent).not.toHaveBeenCalled();
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', error_code: 'max_attempts_reached' }),
    );
  });
});

// ─── Group F: insufficient credit aborts launch ───────────────────────────────

const DRAFT_CAMPAIGN_ROW = {
  id: CAMPAIGN,
  org_id: ORG,
  status: 'draft' as const,
  contact_list_id: LIST,
  script_id: SCRIPT,
  name: 'Test Campaign',
  concurrency_limit: 5,
  time_window_start: '09:00',
  time_window_end: '19:00',
  scheduled_at: null,
  started_at: null,
  completed_at: null,
  estimated_max_cents: null,
  actual_cents: 0,
  created_at: new Date(),
  updated_at: new Date(),
};

describe('launchCampaign — insufficient credit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not emit Inngest event when reserveForCampaign throws', async () => {
    // Configure credit mock to throw
    const { reserveForCampaign } = await import('@/lib/services/credit');
    vi.mocked(reserveForCampaign).mockRejectedValueOnce(
      new Error('insufficient_credit'),
    );

    // Select queue:
    // 1. getCampaign → campaign row (status=draft)
    // 2. attachStats (inside getCampaign) → no calls
    // 3. countEligibleContacts → campaign lookup → contact_list_id
    // 4. countEligibleContacts → recent calls → none
    // 5. countEligibleContacts → eligible contacts count → 5
    useMockTx([
      [DRAFT_CAMPAIGN_ROW],
      [], // attachStats — no calls yet
      [{ contact_list_id: LIST }], // countEligibleContacts: campaign lookup
      [], // countEligibleContacts: recent calls
      [{ total: 5 }], // countEligibleContacts: eligible count
    ]);

    await expect(launchCampaign(ORG, 'user-1', CAMPAIGN)).rejects.toThrow(
      'insufficient_credit',
    );

    // Inngest event must NOT be sent when credit reservation fails
    expect(sendInngestEvent).not.toHaveBeenCalled();
  });

  it('does not emit Inngest event when zero eligible contacts found', async () => {
    useMockTx([
      [DRAFT_CAMPAIGN_ROW],
      [], // attachStats
      [{ contact_list_id: LIST }], // countEligibleContacts: campaign
      [], // recent calls
      [{ total: 0 }], // eligible count → zero!
    ]);

    await expect(launchCampaign(ORG, 'user-1', CAMPAIGN)).rejects.toThrow(
      'no_eligible_contacts',
    );

    expect(sendInngestEvent).not.toHaveBeenCalled();
  });
});

// ─── Group G: end-to-end happy path ──────────────────────────────────────────

describe('campaignDispatchCallHandler — end-to-end happy path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRunning).mockResolvedValue(RUNNING_CAMPAIGN);
    vi.mocked(getBalance).mockResolvedValue({ balanceCents: 50_000, remainingMinutes: 1000 });
    vi.setSystemTime(new Date('2024-06-10T08:00:00Z')); // 10:00 Rome
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls the voice provider exactly once on success', async () => {
    useMockTx([
      [{ cnt: 100 }], // daily cap
      [{ cnt: 1 }], // concurrency
      [{ deleted_at: null, opt_out: false, rpo_status: 'clear' }], // eligible
      [], // no cooldown
      [{ cnt: 2 }], // CLIs
      [{ cnt: 10 }], // hourly calls
    ]);

    const result = await campaignDispatchCallHandler(DISPATCH_DATA);

    expect(result).toBeNull();
    expect(dispatchCall).toHaveBeenCalledOnce();
    expect(dispatchCall).toHaveBeenCalledWith(ORG, CALL);
  });

  it('does not call provider when scheduledFor is in the future', async () => {
    const futureTime = new Date(Date.now() + 2 * 3600 * 1000).toISOString();

    const result = await campaignDispatchCallHandler({
      ...DISPATCH_DATA,
      scheduledFor: futureTime,
    });

    expect(result).toMatchObject({ sleepUntil: expect.any(Date) });
    expect(dispatchCall).not.toHaveBeenCalled();
  });
});

// ─── Group H: DB integration — 50 contacts create 50 pending call rows ────────

describe('DB: campaignLaunchedHandler — 50 contacts create 50 pending calls', () => {
  it.skipIf(skipWhenNoDb)(
    'creates one pending calls row per eligible contact and sends 50 dispatch events',
    async () => {
      await withTestDb(async (tx) => {
        // Override withOrgContext to use the rolled-back test transaction
        vi.mocked(withOrgContext).mockImplementation(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (_: string, fn: any) => Promise.resolve(fn(tx)),
        );

        // Seed org, template, script, list, campaign
        await tx.insert(organizations).values({
          id: ORG,
          name: 'Integration Test Org',
          country: 'IT',
          timezone: 'Europe/Rome',
        });

        await tx.insert(scriptTemplates).values({
          id: TEMPLATE,
          slug: 'lead-reactivation',
          version: 91, // unique version to avoid seed-data collision
          name: 'Integration Test Template',
          system_prompt: 'Test prompt.',
        });

        await tx.insert(scripts).values({
          id: SCRIPT,
          org_id: ORG,
          template_id: TEMPLATE,
          name: 'Integration Test Script',
        });

        await tx.insert(contactLists).values({
          id: LIST,
          org_id: ORG,
          name: 'Integration Test List',
          source: 'csv-upload',
          total_count: 50,
          valid_count: 50,
        });

        await tx.insert(campaigns).values({
          id: CAMPAIGN,
          org_id: ORG,
          script_id: SCRIPT,
          contact_list_id: LIST,
          name: 'Integration Test Campaign',
          status: 'running',
        });

        // Build 50 distinct contacts in the list
        const CONTACT_COUNT = 50;
        const contactRows = Array.from({ length: CONTACT_COUNT }, (_, i) => ({
          id: `90000000-0000-0000-0001-${String(i).padStart(12, '0')}`,
          org_id: ORG,
          contact_list_id: LIST,
          phone_e164: `+3933300${String(i).padStart(5, '0')}`,
          consent_basis: 'existing_customer' as const,
        }));
        await tx.insert(contacts).values(contactRows);

        // Mock findEligibleContactsForCampaign to return our 50 contacts
        vi.mocked(findEligibleContactsForCampaign).mockResolvedValue(
          contactRows.map((c, i) => ({
            contactId: c.id,
            phoneE164: c.phone_e164,
            attemptNumber: 1 + i * 0, // always 1
          })),
        );

        vi.mocked(sendInngestEvents).mockResolvedValue(undefined);

        // Run the handler
        await campaignLaunchedHandler({ campaignId: CAMPAIGN, orgId: ORG });

        // Verify exactly 50 pending call rows in the DB
        const callRows = await tx
          .select({ id: calls.id, status: calls.status })
          .from(calls)
          .where(and(eq(calls.campaign_id, CAMPAIGN), eq(calls.org_id, ORG)));

        expect(callRows).toHaveLength(CONTACT_COUNT);
        expect(callRows.every((r) => r.status === 'pending')).toBe(true);

        // Verify exactly 50 dispatch events were sent
        expect(sendInngestEvents).toHaveBeenCalledOnce();
        const [sentEvents] = vi.mocked(sendInngestEvents).mock.calls[0]!;
        expect((sentEvents as unknown[]).length).toBe(CONTACT_COUNT);
        expect(
          (sentEvents as { name: string }[]).every(
            (e) => e.name === CAMPAIGN_DISPATCH_CALL_EVENT,
          ),
        ).toBe(true);
      });
    },
  );
});

// ─── Group I: DB integration — verifyContactStillEligible ────────────────────

describe('DB: verifyContactStillEligible — real DB eligibility re-check', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  it.skipIf(skipWhenNoDb)(
    'throws ContactNotEligibleError when contact has opted out',
    async () => {
      await withTestDb(async (tx) => {
        vi.mocked(withOrgContext).mockImplementation(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (_: string, fn: any) => Promise.resolve(fn(tx)),
        );

        // Seed org + contact
        await tx.insert(organizations).values({
          id: ORG,
          name: 'Eligibility Test Org',
          country: 'IT',
          timezone: 'Europe/Rome',
        });

        await tx.insert(scriptTemplates).values({
          id: TEMPLATE,
          slug: 'lead-reactivation',
          version: 92,
          name: 'Eligibility Test Template',
          system_prompt: 'Test.',
        });
        await tx.insert(scripts).values({
          id: SCRIPT,
          org_id: ORG,
          template_id: TEMPLATE,
          name: 'Eligibility Script',
        });
        await tx.insert(contactLists).values({
          id: LIST,
          org_id: ORG,
          name: 'Eligibility List',
          source: 'csv-upload',
          total_count: 1,
          valid_count: 1,
        });
        await tx.insert(contacts).values({
          id: CONTACT,
          org_id: ORG,
          contact_list_id: LIST,
          phone_e164: '+393331234567',
          consent_basis: 'existing_customer',
          opt_out: true, // opted out!
        });

        await expect(
          verifyContactStillEligible(ORG, CONTACT),
        ).rejects.toThrow(ContactNotEligibleError);
      });
    },
  );

  it.skipIf(skipWhenNoDb)(
    'throws ContactNotEligibleError when contact has been soft-deleted',
    async () => {
      await withTestDb(async (tx) => {
        vi.mocked(withOrgContext).mockImplementation(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (_: string, fn: any) => Promise.resolve(fn(tx)),
        );

        await tx.insert(organizations).values({
          id: ORG,
          name: 'Delete Test Org',
          country: 'IT',
          timezone: 'Europe/Rome',
        });
        await tx.insert(scriptTemplates).values({
          id: TEMPLATE,
          slug: 'lead-reactivation',
          version: 93,
          name: 'Delete Test Template',
          system_prompt: 'Test.',
        });
        await tx.insert(scripts).values({
          id: SCRIPT,
          org_id: ORG,
          template_id: TEMPLATE,
          name: 'Delete Script',
        });
        await tx.insert(contactLists).values({
          id: LIST,
          org_id: ORG,
          name: 'Delete List',
          source: 'csv-upload',
          total_count: 1,
          valid_count: 1,
        });
        await tx.insert(contacts).values({
          id: CONTACT,
          org_id: ORG,
          contact_list_id: LIST,
          phone_e164: '+393339876543',
          consent_basis: 'existing_customer',
          deleted_at: new Date(), // soft-deleted!
        });

        await expect(
          verifyContactStillEligible(ORG, CONTACT),
        ).rejects.toThrow(ContactNotEligibleError);
      });
    },
  );

  it.skipIf(skipWhenNoDb)(
    'passes without error for an active, eligible contact',
    async () => {
      await withTestDb(async (tx) => {
        vi.mocked(withOrgContext).mockImplementation(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (_: string, fn: any) => Promise.resolve(fn(tx)),
        );

        await tx.insert(organizations).values({
          id: ORG,
          name: 'Active Test Org',
          country: 'IT',
          timezone: 'Europe/Rome',
        });
        await tx.insert(scriptTemplates).values({
          id: TEMPLATE,
          slug: 'lead-reactivation',
          version: 94,
          name: 'Active Test Template',
          system_prompt: 'Test.',
        });
        await tx.insert(scripts).values({
          id: SCRIPT,
          org_id: ORG,
          template_id: TEMPLATE,
          name: 'Active Script',
        });
        await tx.insert(contactLists).values({
          id: LIST,
          org_id: ORG,
          name: 'Active List',
          source: 'csv-upload',
          total_count: 1,
          valid_count: 1,
        });
        await tx.insert(contacts).values({
          id: CONTACT,
          org_id: ORG,
          contact_list_id: LIST,
          phone_e164: '+393331111111',
          consent_basis: 'existing_customer',
          opt_out: false,
          deleted_at: null,
          rpo_status: 'clear',
        });

        // Must NOT throw
        await expect(
          verifyContactStillEligible(ORG, CONTACT),
        ).resolves.toBeUndefined();
      });
    },
  );
});

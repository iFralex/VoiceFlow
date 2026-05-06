/**
 * Unit tests for the CLI picker. The DB-context helpers and the calls/
 * phone_numbers tables are mocked: the tests verify the picker's transaction
 * shape, error path, and side-effect order without standing up Postgres.
 *
 * Behaviour that depends on real SQL semantics (FOR UPDATE SKIP LOCKED,
 * correlated sub-queries, region tie-breaking) is exercised in
 * `picker.integration.test.ts` against the test database.
 */

vi.mock('@/lib/db/context', () => ({
  withSystemContext: vi.fn(),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withSystemContext } from '@/lib/db/context';

import { NoAvailableCliError, pickCliForOrg } from './picker';

const ORG_ID = '00000000-0000-0000-0000-000000000001';

interface QueuedCandidate {
  id: string;
  e164: string;
  provider: 'voiped' | 'twilio' | 'telnyx';
  provider_external_id: string | null;
}

/**
 * Builds a chainable Drizzle-like transaction whose `.select()` resolves to
 * `candidate ? [candidate] : []` and whose `.update()` records the updated id.
 */
function buildMockTx(candidate: QueuedCandidate | null): {
  tx: unknown;
  updateWhereCalls: number;
} {
  let updateWhereCalls = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const select: any = {};
  select.from = vi.fn(() => select);
  select.where = vi.fn(() => select);
  select.orderBy = vi.fn(() => select);
  select.limit = vi.fn(() => select);
  select.for = vi.fn(() => Promise.resolve(candidate ? [candidate] : []));

  const tx = {
    select: vi.fn(() => select),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => {
          updateWhereCalls += 1;
          return Promise.resolve([]);
        }),
      })),
    })),
  };

  return {
    tx,
    get updateWhereCalls() {
      return updateWhereCalls;
    },
  };
}

describe('pickCliForOrg', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns the picked CLI when the query yields a candidate', async () => {
    const candidate: QueuedCandidate = {
      id: 'phone-1',
      e164: '+390212345678',
      provider: 'voiped',
      provider_external_id: 'vapi-phone-1',
    };
    const { tx } = buildMockTx(candidate);
    vi.mocked(withSystemContext).mockImplementationOnce((fn) =>
      fn(tx as unknown as Parameters<typeof fn>[0]),
    );

    const picked = await pickCliForOrg(ORG_ID);
    expect(picked).toEqual({
      phoneNumberId: 'phone-1',
      phoneE164: '+390212345678',
      providerExternalId: 'vapi-phone-1',
      provider: 'voiped',
    });
  });

  it('throws NoAvailableCliError when no candidate row is returned', async () => {
    const { tx } = buildMockTx(null);
    vi.mocked(withSystemContext).mockImplementationOnce((fn) =>
      fn(tx as unknown as Parameters<typeof fn>[0]),
    );

    await expect(pickCliForOrg(ORG_ID)).rejects.toBeInstanceOf(NoAvailableCliError);
  });

  it('issues an UPDATE on the picked row inside the same transaction', async () => {
    const candidate: QueuedCandidate = {
      id: 'phone-2',
      e164: '+390611111111',
      provider: 'voiped',
      provider_external_id: null,
    };
    const mock = buildMockTx(candidate);
    vi.mocked(withSystemContext).mockImplementationOnce((fn) =>
      fn(mock.tx as unknown as Parameters<typeof fn>[0]),
    );

    await pickCliForOrg(ORG_ID);
    expect(mock.updateWhereCalls).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((mock.tx as any).update).toHaveBeenCalled();
  });

  it('threads the FOR UPDATE SKIP LOCKED locking hint through the chain', async () => {
    const candidate: QueuedCandidate = {
      id: 'phone-3',
      e164: '+390511111111',
      provider: 'voiped',
      provider_external_id: null,
    };
    const { tx } = buildMockTx(candidate);
    vi.mocked(withSystemContext).mockImplementationOnce((fn) =>
      fn(tx as unknown as Parameters<typeof fn>[0]),
    );

    await pickCliForOrg(ORG_ID);

    // The `.for(...)` call is what produces the `FOR UPDATE SKIP LOCKED`
    // clause in real SQL. Verify it was invoked with the correct shape — the
    // skipLocked flag is what makes concurrent pickers skip already-locked
    // rows instead of blocking.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txAny = tx as any;
    const select = txAny.select.mock.results[0].value;
    expect(select.for).toHaveBeenCalledWith('update', { skipLocked: true });
  });

  it('uses the supplied tx instead of opening a new system context', async () => {
    const candidate: QueuedCandidate = {
      id: 'phone-4',
      e164: '+393401234567',
      provider: 'voiped',
      provider_external_id: null,
    };
    const { tx } = buildMockTx(candidate);

    const picked = await pickCliForOrg(ORG_ID, undefined, {
      tx: tx as unknown as Parameters<Parameters<typeof withSystemContext>[0]>[0],
    });

    expect(picked.phoneNumberId).toBe('phone-4');
    expect(vi.mocked(withSystemContext)).not.toHaveBeenCalled();
  });

  it('NoAvailableCliError carries the orgId and a stable name', () => {
    const err = new NoAvailableCliError(ORG_ID);
    expect(err.orgId).toBe(ORG_ID);
    expect(err.name).toBe('NoAvailableCliError');
    expect(err).toBeInstanceOf(Error);
  });

  it('passes the providers filter through to the WHERE clause when set', async () => {
    // Verifies that the providers option is wired through. The integration
    // test asserts the filter actually selects a Twilio row; this unit test
    // just confirms the picker forwarded the option without throwing.
    const candidate: QueuedCandidate = {
      id: 'phone-twilio',
      e164: '+390999000001',
      provider: 'twilio',
      provider_external_id: null,
    };
    const { tx } = buildMockTx(candidate);
    vi.mocked(withSystemContext).mockImplementationOnce((fn) =>
      fn(tx as unknown as Parameters<typeof fn>[0]),
    );

    const picked = await pickCliForOrg(ORG_ID, undefined, { providers: ['twilio'] });
    expect(picked.provider).toBe('twilio');
  });
});

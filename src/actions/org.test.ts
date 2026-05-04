import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockGetUser,
  mockTransaction,
  mockSelect,
  mockFrom,
  mockWhere,
  mockCookiesSet,
  mockCookies,
} = vi.hoisted(() => {
  const mockWhere = vi.fn();
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
  const mockTransaction = vi.fn();
  const mockGetUser = vi.fn();
  const mockCookiesSet = vi.fn();
  const mockCookies = vi.fn().mockResolvedValue({ set: mockCookiesSet });
  return {
    mockGetUser,
    mockTransaction,
    mockSelect,
    mockFrom,
    mockWhere,
    mockCookiesSet,
    mockCookies,
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
  }),
}));

vi.mock('@/lib/db/client', () => ({
  db: { transaction: mockTransaction },
}));

vi.mock('@/lib/db/schema', () => ({
  memberships: { id: 'id', org_id: 'org_id', user_id: 'user_id', accepted_at: 'accepted_at' },
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const VALID_USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';

/** Wire mockTransaction to run the callback with a select-capable tx stub. */
function setupTransaction(memberRow: { id: string } | null) {
  mockWhere.mockResolvedValue(memberRow ? [memberRow] : []);
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    return fn({ select: mockSelect });
  });
}

import { setActiveOrg } from './org';

// ---------------------------------------------------------------------------
// setActiveOrg
// ---------------------------------------------------------------------------
describe('setActiveOrg', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWhere.mockResolvedValue([{ id: 'mem-uuid-1' }]);
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  describe('input validation', () => {
    it('returns invalid_org_id for empty string', async () => {
      const result = await setActiveOrg('');
      expect(result).toEqual({ ok: false, message: 'invalid_org_id' });
    });

    it('returns invalid_org_id for a non-UUID string', async () => {
      const result = await setActiveOrg('not-a-uuid');
      expect(result).toEqual({ ok: false, message: 'invalid_org_id' });
    });
  });

  describe('authentication', () => {
    it('returns auth.unauthenticated when no user session', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
      const result = await setActiveOrg(VALID_ORG_ID);
      expect(result).toEqual({ ok: false, message: 'auth.unauthenticated' });
    });

    it('returns auth.unauthenticated when getUser returns an error', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'expired' } });
      const result = await setActiveOrg(VALID_ORG_ID);
      expect(result).toEqual({ ok: false, message: 'auth.unauthenticated' });
    });
  });

  describe('membership check', () => {
    it('returns not_a_member when user has no accepted membership', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: VALID_USER_ID } }, error: null });
      setupTransaction(null);
      const result = await setActiveOrg(VALID_ORG_ID);
      expect(result).toEqual({ ok: false, message: 'not_a_member' });
    });

    it('does not set cookie when user is not a member', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: VALID_USER_ID } }, error: null });
      setupTransaction(null);
      await setActiveOrg(VALID_ORG_ID);
      expect(mockCookiesSet).not.toHaveBeenCalled();
    });
  });

  describe('success', () => {
    beforeEach(() => {
      mockGetUser.mockResolvedValue({ data: { user: { id: VALID_USER_ID } }, error: null });
      setupTransaction({ id: 'mem-uuid-1' });
    });

    it('returns { ok: true } when membership is valid', async () => {
      const result = await setActiveOrg(VALID_ORG_ID);
      expect(result).toEqual({ ok: true });
    });

    it('sets the active_org_id cookie with the validated org id', async () => {
      await setActiveOrg(VALID_ORG_ID);
      expect(mockCookiesSet).toHaveBeenCalledWith(
        'active_org_id',
        VALID_ORG_ID,
        expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
      );
    });

    it('sets cookie with maxAge of 1 year', async () => {
      await setActiveOrg(VALID_ORG_ID);
      const [, , opts] = mockCookiesSet.mock.calls[0] as [string, string, { maxAge: number }];
      expect(opts.maxAge).toBe(60 * 60 * 24 * 365);
    });
  });

});

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockGetUser,
  mockCreateOrganization,
  mockTransaction,
  mockInsert,
  mockValues,
  mockRedirect,
  mockCookiesSet,
  mockCookies,
} = vi.hoisted(() => {
  const mockValues = vi.fn().mockResolvedValue(undefined);
  const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
  const mockTransaction = vi.fn();
  const mockGetUser = vi.fn();
  const mockRedirect = vi.fn();
  const mockCookiesSet = vi.fn();
  const mockCookies = vi.fn().mockResolvedValue({ set: mockCookiesSet });
  const mockCreateOrganization = vi.fn();
  return {
    mockGetUser,
    mockCreateOrganization,
    mockTransaction,
    mockInsert,
    mockValues,
    mockRedirect,
    mockCookiesSet,
    mockCookies,
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: mockGetUser,
    },
  }),
}));

vi.mock('@/lib/services/organizations', () => ({
  createOrganization: mockCreateOrganization,
}));

vi.mock('@/lib/db/client', () => ({
  db: { transaction: mockTransaction },
}));

vi.mock('@/lib/db/schema', () => ({
  auditLog: { _: { name: 'audit_log' } },
}));

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupTransaction() {
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    return fn({ insert: mockInsert });
  });
}

const userId = 'user-uuid-1';
const orgId = 'org-uuid-1';

import { createOrganizationAndOnboard } from './onboarding';

// ---------------------------------------------------------------------------
// createOrganizationAndOnboard
// ---------------------------------------------------------------------------
describe('createOrganizationAndOnboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupTransaction();
    mockGetUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
    mockCreateOrganization.mockResolvedValue({ id: orgId, name: 'Test Org' });
  });

  it('returns name_required for empty name', async () => {
    const result = await createOrganizationAndOnboard({ name: '' });
    expect(result).toEqual({ ok: false, message: 'name_required' });
  });

  it('returns name_too_long for name over 100 characters', async () => {
    const result = await createOrganizationAndOnboard({ name: 'a'.repeat(101) });
    expect(result).toEqual({ ok: false, message: 'name_too_long' });
  });

  it('returns auth.unauthenticated when no session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const result = await createOrganizationAndOnboard({ name: 'My Org' });
    expect(result).toEqual({ ok: false, message: 'auth.unauthenticated' });
  });

  it('returns auth.unauthenticated when getUser errors', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'token expired' } });
    const result = await createOrganizationAndOnboard({ name: 'My Org' });
    expect(result).toEqual({ ok: false, message: 'auth.unauthenticated' });
  });

  it('calls createOrganization with name and ownerId', async () => {
    await createOrganizationAndOnboard({ name: 'My Org' });
    expect(mockCreateOrganization).toHaveBeenCalledWith({
      ownerId: userId,
      name: 'My Org',
      legalName: undefined,
      vatNumber: undefined,
    });
  });

  it('passes legalName and vatNumber when provided', async () => {
    await createOrganizationAndOnboard({
      name: 'My Org',
      legalName: 'My Org S.r.l.',
      vatNumber: '12345678901',
    });
    expect(mockCreateOrganization).toHaveBeenCalledWith({
      ownerId: userId,
      name: 'My Org',
      legalName: 'My Org S.r.l.',
      vatNumber: '12345678901',
    });
  });

  it('records org.dpa_accepted audit log entry', async () => {
    await createOrganizationAndOnboard({ name: 'My Org' });
    expect(mockInsert).toHaveBeenCalledOnce();
    const [row] = mockValues.mock.calls[0] as [Record<string, unknown>];
    expect(row['action']).toBe('org.dpa_accepted');
    expect(row['org_id']).toBe(orgId);
    expect(row['actor_user_id']).toBe(userId);
    expect(row['subject_id']).toBe(orgId);
    expect((row['metadata'] as Record<string, string>)['dpa_accepted_at']).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );
  });

  it('sets active_org_id cookie with the new org id', async () => {
    await createOrganizationAndOnboard({ name: 'My Org' });
    expect(mockCookiesSet).toHaveBeenCalledWith(
      'active_org_id',
      orgId,
      expect.objectContaining({ httpOnly: true, path: '/' }),
    );
  });

  it('redirects to /dashboard on success', async () => {
    await createOrganizationAndOnboard({ name: 'My Org' });
    expect(mockRedirect).toHaveBeenCalledWith('/dashboard');
  });

  it('returns vat_invalid when createOrganization throws invalid_vat_number', async () => {
    mockCreateOrganization.mockRejectedValue(new Error('invalid_vat_number'));
    const result = await createOrganizationAndOnboard({ name: 'My Org', vatNumber: '00000000000' });
    expect(result).toEqual({ ok: false, message: 'vat_invalid' });
  });

  it('returns error_generic when createOrganization throws unexpected error', async () => {
    mockCreateOrganization.mockRejectedValue(new Error('database connection lost'));
    const result = await createOrganizationAndOnboard({ name: 'My Org' });
    expect(result).toEqual({ ok: false, message: 'error_generic' });
  });

  it('does not set cookie or redirect when createOrganization fails', async () => {
    mockCreateOrganization.mockRejectedValue(new Error('fail'));
    await createOrganizationAndOnboard({ name: 'My Org' });
    expect(mockCookiesSet).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});

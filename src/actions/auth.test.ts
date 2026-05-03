import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockSignInWithOtp,
  mockGetUser,
  mockSignOut,
  mockUpdateUser,
  mockTransaction,
  mockInsert,
  mockValues,
  mockRedirect,
  mockCookiesDelete,
  mockCookies,
} = vi.hoisted(() => {
  const mockValues = vi.fn().mockResolvedValue(undefined);
  const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
  const mockTransaction = vi.fn();
  const mockSignInWithOtp = vi.fn();
  const mockGetUser = vi.fn();
  const mockSignOut = vi.fn().mockResolvedValue({});
  const mockUpdateUser = vi.fn();
  const mockRedirect = vi.fn();
  const mockCookiesDelete = vi.fn();
  const mockCookies = vi.fn().mockResolvedValue({ delete: mockCookiesDelete });
  return {
    mockSignInWithOtp,
    mockGetUser,
    mockSignOut,
    mockUpdateUser,
    mockTransaction,
    mockInsert,
    mockValues,
    mockRedirect,
    mockCookiesDelete,
    mockCookies,
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({
    auth: {
      signInWithOtp: mockSignInWithOtp,
      getUser: mockGetUser,
      signOut: mockSignOut,
      updateUser: mockUpdateUser,
    },
  }),
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

/** Make mockTransaction run the callback synchronously with a minimal tx stub. */
function setupTransaction() {
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    return fn({ insert: mockInsert });
  });
}

import { requestEmailChange, signInWithMagicLink, signOut } from './auth';

// ---------------------------------------------------------------------------
// signInWithMagicLink
// ---------------------------------------------------------------------------
describe('signInWithMagicLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupTransaction();
  });

  it('returns email_required for empty string', async () => {
    const result = await signInWithMagicLink('');
    expect(result).toEqual({ ok: false, message: 'email_required' });
  });

  it('returns email_invalid for malformed email', async () => {
    const result = await signInWithMagicLink('not-an-email');
    expect(result).toEqual({ ok: false, message: 'email_invalid' });
  });

  it('logs audit entry for invalid email', async () => {
    await signInWithMagicLink('bad');
    expect(mockTransaction).toHaveBeenCalledOnce();
    expect(mockInsert).toHaveBeenCalledOnce();
    const [row] = mockValues.mock.calls[0] as [Record<string, unknown>];
    expect(row['action']).toBe('auth.signin_requested');
    expect(row['subject_id']).toBe('invalid_email');
  });

  it('returns ok: true for valid email', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null });
    const result = await signInWithMagicLink('user@example.com');
    expect(result).toEqual({ ok: true });
  });

  it('calls Supabase signInWithOtp with shouldCreateUser: true', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null });
    await signInWithMagicLink('user@example.com');
    expect(mockSignInWithOtp).toHaveBeenCalledWith({
      email: 'user@example.com',
      options: { shouldCreateUser: true },
    });
  });

  it('logs audit entry with hashed email on success', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null });
    await signInWithMagicLink('User@Example.COM');
    const [row] = mockValues.mock.calls[0] as [Record<string, unknown>];
    expect(row['action']).toBe('auth.signin_requested');
    // subject_id must be a hex sha256 (64 chars), not the raw email
    expect(row['subject_id']).toMatch(/^[0-9a-f]{64}$/);
    expect(row['subject_id']).not.toContain('@');
  });

  it('returns ok: false with Supabase error message', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: { message: 'rate limited' } });
    const result = await signInWithMagicLink('user@example.com');
    expect(result).toEqual({ ok: false, message: 'rate limited' });
  });

  it('logs audit entry with success: false on Supabase error', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: { message: 'rate limited' } });
    await signInWithMagicLink('user@example.com');
    const [row] = mockValues.mock.calls[0] as [Record<string, unknown>];
    expect(row['metadata']).toMatchObject({ success: false, error: 'rate limited' });
  });
});

// ---------------------------------------------------------------------------
// signOut
// ---------------------------------------------------------------------------
describe('signOut', () => {
  const userId = 'usr-uuid-1';

  beforeEach(() => {
    vi.clearAllMocks();
    setupTransaction();
    mockGetUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  });

  it('calls supabase.auth.signOut()', async () => {
    await signOut();
    expect(mockSignOut).toHaveBeenCalledOnce();
  });

  it('deletes the active_org_id cookie', async () => {
    await signOut();
    expect(mockCookiesDelete).toHaveBeenCalledWith('active_org_id');
  });

  it('redirects to /', async () => {
    await signOut();
    expect(mockRedirect).toHaveBeenCalledWith('/');
  });

  it('logs audit entry with auth.signed_out action', async () => {
    await signOut();
    expect(mockInsert).toHaveBeenCalledOnce();
    const [row] = mockValues.mock.calls[0] as [Record<string, unknown>];
    expect(row['action']).toBe('auth.signed_out');
    expect(row['subject_id']).toBe(userId);
    expect(row['actor_user_id']).toBe(userId);
  });

  it('logs audit entry with unknown subject_id when session is absent', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    await signOut();
    const [row] = mockValues.mock.calls[0] as [Record<string, unknown>];
    expect(row['subject_id']).toBe('unknown');
    // recordAudit maps undefined actorUserId → null in the inserted row
    expect(row['actor_user_id']).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// requestEmailChange
// ---------------------------------------------------------------------------
describe('requestEmailChange', () => {
  const userId = 'usr-uuid-2';

  beforeEach(() => {
    vi.clearAllMocks();
    setupTransaction();
    mockGetUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
    mockUpdateUser.mockResolvedValue({ error: null });
  });

  it('returns email_required for empty string', async () => {
    const result = await requestEmailChange('');
    expect(result).toEqual({ ok: false, message: 'email_required' });
  });

  it('returns email_invalid for malformed email', async () => {
    const result = await requestEmailChange('not-valid');
    expect(result).toEqual({ ok: false, message: 'email_invalid' });
  });

  it('returns auth.unauthenticated when no session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const result = await requestEmailChange('new@example.com');
    expect(result).toEqual({ ok: false, message: 'auth.unauthenticated' });
  });

  it('returns auth.unauthenticated when getUser returns an error', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'expired' } });
    const result = await requestEmailChange('new@example.com');
    expect(result).toEqual({ ok: false, message: 'auth.unauthenticated' });
  });

  it('calls supabase.auth.updateUser with the new email', async () => {
    await requestEmailChange('new@example.com');
    expect(mockUpdateUser).toHaveBeenCalledWith({ email: 'new@example.com' });
  });

  it('returns ok: true on success', async () => {
    const result = await requestEmailChange('new@example.com');
    expect(result).toEqual({ ok: true });
  });

  it('logs audit entry with auth.email_change_requested action', async () => {
    await requestEmailChange('new@example.com');
    const [row] = mockValues.mock.calls[0] as [Record<string, unknown>];
    expect(row['action']).toBe('auth.email_change_requested');
    expect(row['subject_id']).toBe(userId);
    expect(row['actor_user_id']).toBe(userId);
    expect(row['metadata']).toMatchObject({ success: true });
  });

  it('returns ok: false with error message on Supabase error', async () => {
    mockUpdateUser.mockResolvedValue({ error: { message: 'email already in use' } });
    const result = await requestEmailChange('taken@example.com');
    expect(result).toEqual({ ok: false, message: 'email already in use' });
  });

  it('logs audit entry with success: false on Supabase error', async () => {
    mockUpdateUser.mockResolvedValue({ error: { message: 'email already in use' } });
    await requestEmailChange('taken@example.com');
    const [row] = mockValues.mock.calls[0] as [Record<string, unknown>];
    expect(row['metadata']).toMatchObject({ success: false, error: 'email already in use' });
  });
});

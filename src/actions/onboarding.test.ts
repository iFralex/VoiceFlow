import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockGetUser,
  mockCreateOrganization,
  mockRecordDpaAcceptance,
  mockRedirect,
  mockCookiesSet,
  mockCookies,
  mockHeaders,
} = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockCreateOrganization = vi.fn();
  const mockRecordDpaAcceptance = vi.fn().mockResolvedValue({
    version: '2026-01-01',
    accepted_at: '2026-05-08T00:00:00.000Z',
    ip: null,
    user_agent: null,
  });
  const mockRedirect = vi.fn();
  const mockCookiesSet = vi.fn();
  const mockCookies = vi.fn().mockResolvedValue({ set: mockCookiesSet });
  const headersMap = new Map<string, string>();
  const mockHeaders = vi.fn().mockResolvedValue({
    get: (k: string) => headersMap.get(k.toLowerCase()) ?? null,
  });
  return {
    mockGetUser,
    mockCreateOrganization,
    mockRecordDpaAcceptance,
    mockRedirect,
    mockCookiesSet,
    mockCookies,
    mockHeaders,
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

vi.mock('@/lib/compliance/dpa', () => ({
  recordDpaAcceptance: mockRecordDpaAcceptance,
  CURRENT_DPA_VERSION: '2026-01-01',
}));

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
  headers: mockHeaders,
}));

const userId = 'user-uuid-1';
const orgId = 'org-uuid-1';

import { createOrganizationAndOnboard } from './onboarding';

// ---------------------------------------------------------------------------
// createOrganizationAndOnboard
// ---------------------------------------------------------------------------
describe('createOrganizationAndOnboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
    mockCreateOrganization.mockResolvedValue({ id: orgId, name: 'Test Org' });
    mockRecordDpaAcceptance.mockResolvedValue({
      version: '2026-01-01',
      accepted_at: '2026-05-08T00:00:00.000Z',
      ip: null,
      user_agent: null,
    });
  });

  it('returns name_required for empty name', async () => {
    const result = await createOrganizationAndOnboard({ name: '', dpaAccepted: true });
    expect(result).toEqual({ ok: false, message: 'name_required' });
  });

  it('returns name_too_long for name over 100 characters', async () => {
    const result = await createOrganizationAndOnboard({ name: 'a'.repeat(101), dpaAccepted: true });
    expect(result).toEqual({ ok: false, message: 'name_too_long' });
  });

  it('returns auth.unauthenticated when no session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const result = await createOrganizationAndOnboard({ name: 'My Org', dpaAccepted: true });
    expect(result).toEqual({ ok: false, message: 'auth.unauthenticated' });
  });

  it('returns auth.unauthenticated when getUser errors', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'token expired' } });
    const result = await createOrganizationAndOnboard({ name: 'My Org', dpaAccepted: true });
    expect(result).toEqual({ ok: false, message: 'auth.unauthenticated' });
  });

  it('rejects when dpaAccepted is missing or false', async () => {
    const missing = await createOrganizationAndOnboard({
      name: 'My Org',
    } as unknown as { name: string; dpaAccepted: true });
    expect(missing).toEqual({ ok: false, message: 'dpa_required' });
    expect(mockCreateOrganization).not.toHaveBeenCalled();
    expect(mockRecordDpaAcceptance).not.toHaveBeenCalled();

    const explicitFalse = await createOrganizationAndOnboard({
      name: 'My Org',
      dpaAccepted: false,
    } as unknown as { name: string; dpaAccepted: true });
    expect(explicitFalse).toEqual({ ok: false, message: 'dpa_required' });
  });

  it('calls createOrganization with name and ownerId', async () => {
    await createOrganizationAndOnboard({ name: 'My Org', dpaAccepted: true });
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
      dpaAccepted: true,
    });
    expect(mockCreateOrganization).toHaveBeenCalledWith({
      ownerId: userId,
      name: 'My Org',
      legalName: 'My Org S.r.l.',
      vatNumber: '12345678901',
    });
  });

  it('records DPA acceptance with orgId, userId, ip and user-agent', async () => {
    const headersMap = new Map<string, string>([
      ['x-forwarded-for', '203.0.113.1, 10.0.0.1'],
      ['user-agent', 'Mozilla/5.0 (Test)'],
    ]);
    mockHeaders.mockResolvedValueOnce({
      get: (k: string) => headersMap.get(k.toLowerCase()) ?? null,
    });

    await createOrganizationAndOnboard({ name: 'My Org', dpaAccepted: true });

    expect(mockRecordDpaAcceptance).toHaveBeenCalledOnce();
    expect(mockRecordDpaAcceptance).toHaveBeenCalledWith({
      orgId,
      userId,
      ip: '203.0.113.1',
      userAgent: 'Mozilla/5.0 (Test)',
    });
  });

  it('records DPA acceptance with null ip / ua when headers absent', async () => {
    const headersMap = new Map<string, string>();
    mockHeaders.mockResolvedValueOnce({
      get: (k: string) => headersMap.get(k.toLowerCase()) ?? null,
    });

    await createOrganizationAndOnboard({ name: 'My Org', dpaAccepted: true });

    expect(mockRecordDpaAcceptance).toHaveBeenCalledWith({
      orgId,
      userId,
      ip: null,
      userAgent: null,
    });
  });

  it('falls back to x-real-ip when x-forwarded-for is absent', async () => {
    const headersMap = new Map<string, string>([
      ['x-real-ip', '198.51.100.7'],
      ['user-agent', 'Test/1'],
    ]);
    mockHeaders.mockResolvedValueOnce({
      get: (k: string) => headersMap.get(k.toLowerCase()) ?? null,
    });

    await createOrganizationAndOnboard({ name: 'My Org', dpaAccepted: true });

    expect(mockRecordDpaAcceptance).toHaveBeenCalledWith({
      orgId,
      userId,
      ip: '198.51.100.7',
      userAgent: 'Test/1',
    });
  });

  it('sets active_org_id cookie with the new org id', async () => {
    await createOrganizationAndOnboard({ name: 'My Org', dpaAccepted: true });
    expect(mockCookiesSet).toHaveBeenCalledWith(
      'active_org_id',
      orgId,
      expect.objectContaining({ httpOnly: true, path: '/' }),
    );
  });

  it('redirects to /dashboard on success', async () => {
    await createOrganizationAndOnboard({ name: 'My Org', dpaAccepted: true });
    expect(mockRedirect).toHaveBeenCalledWith('/dashboard');
  });

  it('returns vat_invalid when createOrganization throws invalid_vat_number', async () => {
    mockCreateOrganization.mockRejectedValue(new Error('invalid_vat_number'));
    const result = await createOrganizationAndOnboard({ name: 'My Org', vatNumber: '00000000000', dpaAccepted: true });
    expect(result).toEqual({ ok: false, message: 'vat_invalid' });
  });

  it('returns error_generic when createOrganization throws unexpected error', async () => {
    mockCreateOrganization.mockRejectedValue(new Error('database connection lost'));
    const result = await createOrganizationAndOnboard({ name: 'My Org', dpaAccepted: true });
    expect(result).toEqual({ ok: false, message: 'error_generic' });
  });

  it('does not set cookie or redirect when createOrganization fails', async () => {
    mockCreateOrganization.mockRejectedValue(new Error('fail'));
    await createOrganizationAndOnboard({ name: 'My Org', dpaAccepted: true });
    expect(mockCookiesSet).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});

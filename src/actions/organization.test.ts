import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockGetAuthContext,
  mockRequireCapability,
  mockGetOrganization,
  mockUpdateOrganization,
  mockSoftDeleteOrganization,
  mockRevalidatePath,
  mockRedirect,
} = vi.hoisted(() => {
  return {
    mockGetAuthContext: vi.fn(),
    mockRequireCapability: vi.fn(),
    mockGetOrganization: vi.fn(),
    mockUpdateOrganization: vi.fn(),
    mockSoftDeleteOrganization: vi.fn(),
    mockRevalidatePath: vi.fn(),
    mockRedirect: vi.fn(),
  };
});

vi.mock('@/lib/auth/context', () => ({
  getAuthContext: mockGetAuthContext,
  requireCapability: mockRequireCapability,
}));

vi.mock('@/lib/services/organizations', () => ({
  getOrganization: mockGetOrganization,
  updateOrganization: mockUpdateOrganization,
  softDeleteOrganization: mockSoftDeleteOrganization,
}));

vi.mock('next/cache', () => ({
  revalidatePath: mockRevalidatePath,
}));

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const orgId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';

const mockOrg = {
  id: orgId,
  name: 'Acme Corp',
  legal_name: null,
  vat_number: null,
  country: 'IT',
  timezone: 'Europe/Rome',
  created_at: new Date('2026-01-01'),
  deleted_at: null,
};

import { deleteOrganizationAction, updateOrganizationAction } from './organization';

// ---------------------------------------------------------------------------
// updateOrganizationAction
// ---------------------------------------------------------------------------
describe('updateOrganizationAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthContext.mockResolvedValue({ userId, orgId, role: 'owner' });
    mockRequireCapability.mockResolvedValue(undefined);
    mockUpdateOrganization.mockResolvedValue(mockOrg);
  });

  it('returns name_required for empty name', async () => {
    const result = await updateOrganizationAction({ name: '' });
    expect(result).toEqual({ ok: false, message: 'name_required' });
  });

  it('returns name_too_long for name over 100 characters', async () => {
    const result = await updateOrganizationAction({ name: 'a'.repeat(101) });
    expect(result).toEqual({ ok: false, message: 'name_too_long' });
  });

  it('calls requireCapability with org.manage', async () => {
    await updateOrganizationAction({ name: 'Acme Corp' });
    expect(mockRequireCapability).toHaveBeenCalledWith('org.manage');
  });

  it('calls updateOrganization with correct fields', async () => {
    await updateOrganizationAction({
      name: 'New Name',
      legalName: 'New Name S.r.l.',
      vatNumber: '12345678903',
    });
    expect(mockUpdateOrganization).toHaveBeenCalledWith(orgId, {
      name: 'New Name',
      legal_name: 'New Name S.r.l.',
      vat_number: '12345678903',
    });
  });

  it('passes null legal_name when legalName is not provided', async () => {
    await updateOrganizationAction({ name: 'Acme Corp' });
    expect(mockUpdateOrganization).toHaveBeenCalledWith(
      orgId,
      expect.objectContaining({ legal_name: null }),
    );
  });

  it('returns ok: true on success', async () => {
    const result = await updateOrganizationAction({ name: 'Acme Corp' });
    expect(result).toEqual({ ok: true });
  });

  it('calls revalidatePath on success', async () => {
    await updateOrganizationAction({ name: 'Acme Corp' });
    expect(mockRevalidatePath).toHaveBeenCalledWith('/settings/organization');
  });

  it('returns vat_invalid when updateOrganization throws invalid_vat_number', async () => {
    mockUpdateOrganization.mockRejectedValue(new Error('invalid_vat_number'));
    const result = await updateOrganizationAction({
      name: 'Acme Corp',
      vatNumber: '00000000000',
    });
    expect(result).toEqual({ ok: false, message: 'vat_invalid' });
  });

  it('returns error message when updateOrganization throws', async () => {
    mockUpdateOrganization.mockRejectedValue(new Error('organization_not_found'));
    const result = await updateOrganizationAction({ name: 'Acme Corp' });
    expect(result).toEqual({ ok: false, message: 'organization_not_found' });
  });

  it('does not revalidate on failure', async () => {
    mockUpdateOrganization.mockRejectedValue(new Error('fail'));
    await updateOrganizationAction({ name: 'Acme Corp' });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// deleteOrganizationAction
// ---------------------------------------------------------------------------
describe('deleteOrganizationAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthContext.mockResolvedValue({ userId, orgId, role: 'owner' });
    mockRequireCapability.mockResolvedValue(undefined);
    mockGetOrganization.mockResolvedValue(mockOrg);
    mockSoftDeleteOrganization.mockResolvedValue(undefined);
  });

  it('returns validation_error for empty confirmedName', async () => {
    const result = await deleteOrganizationAction({ confirmedName: '' });
    expect(result).toEqual({ ok: false, message: 'validation_error' });
  });

  it('calls requireCapability with org.manage', async () => {
    await deleteOrganizationAction({ confirmedName: 'Acme Corp' });
    expect(mockRequireCapability).toHaveBeenCalledWith('org.manage');
  });

  it('returns organization_not_found when org does not exist', async () => {
    mockGetOrganization.mockResolvedValue(null);
    const result = await deleteOrganizationAction({ confirmedName: 'Acme Corp' });
    expect(result).toEqual({ ok: false, message: 'organization_not_found' });
  });

  it('returns delete_name_mismatch when confirmed name does not match', async () => {
    const result = await deleteOrganizationAction({ confirmedName: 'Wrong Name' });
    expect(result).toEqual({ ok: false, message: 'delete_name_mismatch' });
  });

  it('calls softDeleteOrganization with orgId and userId on name match', async () => {
    await deleteOrganizationAction({ confirmedName: 'Acme Corp' });
    expect(mockSoftDeleteOrganization).toHaveBeenCalledWith(orgId, userId);
  });

  it('redirects to /onboarding on success', async () => {
    await deleteOrganizationAction({ confirmedName: 'Acme Corp' });
    expect(mockRedirect).toHaveBeenCalledWith('/onboarding');
  });

  it('returns error message when softDeleteOrganization throws', async () => {
    mockSoftDeleteOrganization.mockRejectedValue(new Error('organization_not_found'));
    const result = await deleteOrganizationAction({ confirmedName: 'Acme Corp' });
    expect(result).toEqual({ ok: false, message: 'organization_not_found' });
  });

  it('does not redirect on softDelete failure', async () => {
    mockSoftDeleteOrganization.mockRejectedValue(new Error('fail'));
    await deleteOrganizationAction({ confirmedName: 'Acme Corp' });
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});

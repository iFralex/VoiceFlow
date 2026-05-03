import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockGetAuthContext,
  mockInviteMember,
  mockUpdateMemberRole,
  mockRemoveMember,
  mockRevalidatePath,
} = vi.hoisted(() => {
  return {
    mockGetAuthContext: vi.fn(),
    mockInviteMember: vi.fn(),
    mockUpdateMemberRole: vi.fn(),
    mockRemoveMember: vi.fn(),
    mockRevalidatePath: vi.fn(),
  };
});

vi.mock('@/lib/auth/context', () => ({
  getAuthContext: mockGetAuthContext,
}));

vi.mock('@/lib/services/memberships', () => ({
  inviteMember: mockInviteMember,
  listMembers: vi.fn(),
  updateMemberRole: mockUpdateMemberRole,
  removeMember: mockRemoveMember,
}));

vi.mock('next/cache', () => ({
  revalidatePath: mockRevalidatePath,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const orgId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';
const membershipId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003';

const mockMembership = {
  id: membershipId,
  org_id: orgId,
  user_id: 'user-uuid-2',
  role: 'operator' as const,
  invited_at: new Date('2026-01-01'),
  accepted_at: null,
};

import {
  inviteMemberAction,
  removeMemberAction,
  updateMemberRoleAction,
} from './membership';

// ---------------------------------------------------------------------------
// inviteMemberAction
// ---------------------------------------------------------------------------
describe('inviteMemberAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthContext.mockResolvedValue({ userId, orgId, role: 'admin' });
    mockInviteMember.mockResolvedValue(mockMembership);
  });

  it('returns email_invalid for invalid email', async () => {
    const result = await inviteMemberAction({ email: 'not-an-email', role: 'operator' });
    expect(result).toEqual({ ok: false, message: 'email_invalid' });
  });

  it('returns validation error for invalid role', async () => {
    // @ts-expect-error intentionally invalid role
    const result = await inviteMemberAction({ email: 'user@example.com', role: 'superadmin' });
    expect(result).toEqual({ ok: false, message: expect.any(String) });
  });

  it('calls inviteMember with org context', async () => {
    await inviteMemberAction({ email: 'user@example.com', role: 'operator' });
    expect(mockInviteMember).toHaveBeenCalledWith(orgId, userId, {
      email: 'user@example.com',
      role: 'operator',
    });
  });

  it('returns ok: true on success', async () => {
    const result = await inviteMemberAction({ email: 'user@example.com', role: 'operator' });
    expect(result).toEqual({ ok: true });
  });

  it('calls revalidatePath on success', async () => {
    await inviteMemberAction({ email: 'user@example.com', role: 'operator' });
    expect(mockRevalidatePath).toHaveBeenCalledWith('/settings/members');
  });

  it('returns error message when inviteMember throws', async () => {
    mockInviteMember.mockRejectedValue(new Error('insufficient_permissions'));
    const result = await inviteMemberAction({ email: 'user@example.com', role: 'operator' });
    expect(result).toEqual({ ok: false, message: 'insufficient_permissions' });
  });

  it('returns error_generic for non-Error throws', async () => {
    mockInviteMember.mockRejectedValue('unexpected');
    const result = await inviteMemberAction({ email: 'user@example.com', role: 'operator' });
    expect(result).toEqual({ ok: false, message: 'error_generic' });
  });

  it('does not call revalidatePath on failure', async () => {
    mockInviteMember.mockRejectedValue(new Error('fail'));
    await inviteMemberAction({ email: 'user@example.com', role: 'operator' });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// updateMemberRoleAction
// ---------------------------------------------------------------------------
describe('updateMemberRoleAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthContext.mockResolvedValue({ userId, orgId, role: 'owner' });
    mockUpdateMemberRole.mockResolvedValue(undefined);
  });

  it('returns validation error for invalid uuid membershipId', async () => {
    const result = await updateMemberRoleAction({ membershipId: 'not-a-uuid', role: 'admin' });
    expect(result).toEqual({ ok: false, message: expect.any(String) });
  });

  it('returns validation error for invalid role', async () => {
    // @ts-expect-error intentionally invalid role
    const result = await updateMemberRoleAction({ membershipId, role: 'superadmin' });
    expect(result).toEqual({ ok: false, message: expect.any(String) });
  });

  it('calls updateMemberRole with org context', async () => {
    await updateMemberRoleAction({ membershipId, role: 'admin' });
    expect(mockUpdateMemberRole).toHaveBeenCalledWith(orgId, userId, membershipId, 'admin');
  });

  it('returns ok: true on success', async () => {
    const result = await updateMemberRoleAction({ membershipId, role: 'admin' });
    expect(result).toEqual({ ok: true });
  });

  it('calls revalidatePath on success', async () => {
    await updateMemberRoleAction({ membershipId, role: 'admin' });
    expect(mockRevalidatePath).toHaveBeenCalledWith('/settings/members');
  });

  it('returns error when updateMemberRole throws', async () => {
    mockUpdateMemberRole.mockRejectedValue(new Error('cannot_change_owner_role'));
    const result = await updateMemberRoleAction({ membershipId, role: 'admin' });
    expect(result).toEqual({ ok: false, message: 'cannot_change_owner_role' });
  });
});

// ---------------------------------------------------------------------------
// removeMemberAction
// ---------------------------------------------------------------------------
describe('removeMemberAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthContext.mockResolvedValue({ userId, orgId, role: 'owner' });
    mockRemoveMember.mockResolvedValue(undefined);
  });

  it('returns validation error for invalid uuid membershipId', async () => {
    const result = await removeMemberAction({ membershipId: 'not-a-uuid' });
    expect(result).toEqual({ ok: false, message: expect.any(String) });
  });

  it('calls removeMember with org context', async () => {
    await removeMemberAction({ membershipId });
    expect(mockRemoveMember).toHaveBeenCalledWith(orgId, userId, membershipId);
  });

  it('returns ok: true on success', async () => {
    const result = await removeMemberAction({ membershipId });
    expect(result).toEqual({ ok: true });
  });

  it('calls revalidatePath on success', async () => {
    await removeMemberAction({ membershipId });
    expect(mockRevalidatePath).toHaveBeenCalledWith('/settings/members');
  });

  it('returns error when removeMember throws', async () => {
    mockRemoveMember.mockRejectedValue(new Error('sole_owner_cannot_be_removed'));
    const result = await removeMemberAction({ membershipId });
    expect(result).toEqual({ ok: false, message: 'sole_owner_cannot_be_removed' });
  });

  it('does not call revalidatePath on failure', async () => {
    mockRemoveMember.mockRejectedValue(new Error('fail'));
    await removeMemberAction({ membershipId });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});

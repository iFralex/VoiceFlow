import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRecordAudit = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/db/audit', () => ({
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

const mockCreateUser = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    auth: {
      admin: {
        createUser: (...args: unknown[]) => mockCreateUser(...args),
      },
    },
  },
}));

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/email/templates/member-invite', () => ({
  renderMemberInviteEmail: vi.fn().mockResolvedValue({
    subject: 'invite subject',
    html: '<p>invite</p>',
    text: 'invite',
  }),
}));

// Variable-based result queues — reset each test, no mockReturnValueOnce accumulation
let selectResults: unknown[][] = [];
let insertResults: unknown[][] = [];

const mockTx = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

function resetMockTx() {
  mockTx.select.mockImplementation(() => {
    const result = selectResults.shift() ?? [];
    return {
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(result),
        innerJoin: vi.fn(() => ({
          where: vi.fn().mockResolvedValue(result),
        })),
      })),
    };
  });

  mockTx.insert.mockImplementation(() => {
    const result = insertResults.shift() ?? [];
    return {
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue(result),
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue(result),
        })),
      })),
    };
  });

  mockTx.update.mockImplementation(() => ({
    set: vi.fn(() => ({
      where: vi.fn().mockResolvedValue([]),
    })),
  }));

  mockTx.delete.mockImplementation(() => ({
    where: vi.fn().mockResolvedValue([]),
  }));
}

vi.mock('@/lib/db/context', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
  withSystemContext: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
}));

const { withOrgContext, withSystemContext } = await import('@/lib/db/context');

beforeEach(() => {
  vi.clearAllMocks();
  selectResults = [];
  insertResults = [];
  resetMockTx();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const fakeUser = {
  id: 'u-1',
  email: 'owner@example.com',
  full_name: 'Owner',
  locale: 'it' as const,
  created_at: new Date(),
};

const fakeInvitee = {
  id: 'u-2',
  email: 'member@example.com',
  full_name: null,
  locale: 'it' as const,
  created_at: new Date(),
};

const fakeOwnerMembership = {
  id: 'm-1',
  org_id: 'org-1',
  user_id: 'u-1',
  role: 'owner' as const,
  invited_at: new Date(),
  accepted_at: new Date() as Date | null,
};

const fakePendingMembership = {
  id: 'm-2',
  org_id: 'org-1',
  user_id: 'u-2',
  role: 'operator' as const,
  invited_at: new Date(),
  accepted_at: null as Date | null,
};

// Non-owner target for removeMember/updateMemberRole tests
const fakeOperatorMembership = {
  id: 'm-2',
  org_id: 'org-1',
  user_id: 'u-2',
  role: 'operator' as const,
  invited_at: new Date(),
  accepted_at: new Date() as Date | null,
};

// ─── inviteMember ─────────────────────────────────────────────────────────────

describe('inviteMember', () => {
  it('invites an existing user via withSystemContext then withOrgContext', async () => {
    selectResults.push([{ role: 'owner' }]); // preflight permission check (in withSystemContext)
    selectResults.push([{ id: fakeInvitee.id }]); // findByEmail → found
    selectResults.push([{ name: 'Test Org' }]); // org lookup for email
    selectResults.push([{ full_name: 'Owner', locale: 'it' }]); // inviter lookup for email
    selectResults.push([{ role: 'owner' }]); // defense-in-depth role check (in withOrgContext)
    insertResults.push([fakePendingMembership]); // membership insert

    const { inviteMember } = await import('./memberships');
    const result = await inviteMember('org-1', 'u-1', {
      email: 'member@example.com',
      role: 'operator',
    });

    expect(withSystemContext).toHaveBeenCalledOnce();
    expect(withOrgContext).toHaveBeenCalledWith('org-1', expect.any(Function));
    expect(result).toEqual(fakePendingMembership);
  });

  it('records member.invited audit entry', async () => {
    selectResults.push([{ role: 'owner' }]); // preflight
    selectResults.push([{ id: fakeInvitee.id }]); // findByEmail
    selectResults.push([{ name: 'Test Org' }]); // org lookup for email
    selectResults.push([{ full_name: 'Owner', locale: 'it' }]); // inviter lookup for email
    selectResults.push([{ role: 'owner' }]); // withOrgContext check
    insertResults.push([fakePendingMembership]);

    const { inviteMember } = await import('./memberships');
    await inviteMember('org-1', 'u-1', { email: 'member@example.com', role: 'operator' });

    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ action: 'member.invited', orgId: 'org-1' }),
    );
  });

  it('creates a Supabase user and mirrors to public.users when email not found', async () => {
    mockCreateUser.mockResolvedValue({ data: { user: { id: 'new-u-id' } }, error: null });

    selectResults.push([{ role: 'owner' }]); // preflight permission check
    selectResults.push([]); // findByEmail → not found
    selectResults.push([{ name: 'Test Org' }]); // org lookup for email
    selectResults.push([{ full_name: 'Owner', locale: 'it' }]); // inviter lookup for email
    selectResults.push([{ role: 'owner' }]); // withOrgContext check
    insertResults.push([]); // users.onConflictDoNothing
    insertResults.push([{ ...fakePendingMembership, user_id: 'new-u-id' }]); // membership

    const { inviteMember } = await import('./memberships');
    await inviteMember('org-1', 'u-1', { email: 'new@example.com', role: 'viewer' });

    expect(mockCreateUser).toHaveBeenCalledWith({
      email: 'new@example.com',
      email_confirm: false,
    });
    // withSystemContext called twice: permission+findByEmail+emailData + mirror insert
    expect(withSystemContext).toHaveBeenCalledTimes(2);
  });

  it('throws failed_to_create_user when Supabase returns an error', async () => {
    mockCreateUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'email already exists' },
    });

    selectResults.push([{ role: 'owner' }]); // preflight permission check
    selectResults.push([]); // findByEmail → not found

    const { inviteMember } = await import('./memberships');
    await expect(
      inviteMember('org-1', 'u-1', { email: 'new@example.com', role: 'viewer' }),
    ).rejects.toThrow('failed_to_create_user');
  });

  it('throws insufficient_permissions when caller is viewer', async () => {
    // Preflight check fires immediately; no findByEmail needed
    selectResults.push([{ role: 'viewer' }]); // preflight → insufficient_permissions

    const { inviteMember } = await import('./memberships');
    await expect(
      inviteMember('org-1', 'u-1', { email: 'member@example.com', role: 'viewer' }),
    ).rejects.toThrow('insufficient_permissions');
  });

  it('throws not_a_member when caller has no accepted membership', async () => {
    // Preflight check fires immediately; no findByEmail needed
    selectResults.push([]); // preflight → not_a_member

    const { inviteMember } = await import('./memberships');
    await expect(
      inviteMember('org-1', 'u-1', { email: 'member@example.com', role: 'viewer' }),
    ).rejects.toThrow('not_a_member');
  });

  it('allows admin to invite with non-owner role', async () => {
    selectResults.push([{ role: 'admin' }]); // preflight
    selectResults.push([{ id: fakeInvitee.id }]); // findByEmail
    selectResults.push([{ name: 'Test Org' }]); // org lookup for email
    selectResults.push([{ full_name: 'Admin', locale: 'it' }]); // inviter lookup for email
    selectResults.push([{ role: 'admin' }]); // withOrgContext check
    insertResults.push([fakePendingMembership]);

    const { inviteMember } = await import('./memberships');
    await expect(
      inviteMember('org-1', 'u-1', { email: 'member@example.com', role: 'viewer' }),
    ).resolves.toBeDefined();
  });

  it('throws insufficient_permissions when admin tries to invite with owner role', async () => {
    selectResults.push([{ role: 'admin' }]); // preflight → insufficient_permissions (owner role)

    const { inviteMember } = await import('./memberships');
    await expect(
      inviteMember('org-1', 'u-1', { email: 'member@example.com', role: 'owner' }),
    ).rejects.toThrow('insufficient_permissions');
  });
});

// ─── acceptInvite ─────────────────────────────────────────────────────────────

describe('acceptInvite', () => {
  it('uses withSystemContext and sets accepted_at', async () => {
    selectResults.push([fakePendingMembership]); // membership lookup

    const { acceptInvite } = await import('./memberships');
    await acceptInvite('m-2', 'u-2');

    expect(withSystemContext).toHaveBeenCalledOnce();
    const setCall = mockTx.update.mock.results[0]?.value.set;
    expect(setCall).toHaveBeenCalledWith(
      expect.objectContaining({ accepted_at: expect.any(Date) }),
    );
  });

  it('records member.accepted audit entry', async () => {
    selectResults.push([fakePendingMembership]);

    const { acceptInvite } = await import('./memberships');
    await acceptInvite('m-2', 'u-2');

    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ action: 'member.accepted', subjectId: 'm-2' }),
    );
  });

  it('throws membership_not_found when membership does not exist', async () => {
    selectResults.push([]); // not found

    const { acceptInvite } = await import('./memberships');
    await expect(acceptInvite('m-missing', 'u-2')).rejects.toThrow('membership_not_found');
  });

  it('throws membership_user_mismatch when userId does not match', async () => {
    selectResults.push([fakePendingMembership]); // user_id = 'u-2'

    const { acceptInvite } = await import('./memberships');
    await expect(acceptInvite('m-2', 'u-999')).rejects.toThrow('membership_user_mismatch');
  });
});

// ─── listMembers ──────────────────────────────────────────────────────────────

describe('listMembers', () => {
  it('uses withOrgContext', async () => {
    selectResults.push([{ memberships: fakeOwnerMembership, users: fakeUser }]);

    const { listMembers } = await import('./memberships');
    await listMembers('org-1');
    expect(withOrgContext).toHaveBeenCalledWith('org-1', expect.any(Function));
  });

  it('maps join rows to Membership & { user }', async () => {
    selectResults.push([{ memberships: fakeOwnerMembership, users: fakeUser }]);

    const { listMembers } = await import('./memberships');
    const result = await listMembers('org-1');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'm-1', user: fakeUser });
  });

  it('returns empty array when no members', async () => {
    selectResults.push([]);

    const { listMembers } = await import('./memberships');
    const result = await listMembers('org-1');
    expect(result).toEqual([]);
  });
});

// ─── updateMemberRole ─────────────────────────────────────────────────────────

describe('updateMemberRole', () => {
  it('uses withOrgContext and updates the role', async () => {
    selectResults.push([{ role: 'owner' }]); // caller role
    selectResults.push([fakeOperatorMembership]); // target

    const { updateMemberRole } = await import('./memberships');
    await updateMemberRole('org-1', 'u-1', 'm-2', 'admin');

    expect(withOrgContext).toHaveBeenCalledWith('org-1', expect.any(Function));
    const setCall = mockTx.update.mock.results[0]?.value.set;
    expect(setCall).toHaveBeenCalledWith({ role: 'admin' });
  });

  it('records member.role_updated audit entry', async () => {
    selectResults.push([{ role: 'owner' }]);
    selectResults.push([fakeOperatorMembership]);

    const { updateMemberRole } = await import('./memberships');
    await updateMemberRole('org-1', 'u-1', 'm-2', 'admin');

    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        action: 'member.role_updated',
        metadata: { from: 'operator', to: 'admin' },
      }),
    );
  });

  it('throws insufficient_permissions when caller is operator', async () => {
    selectResults.push([{ role: 'operator' }]);
    selectResults.push([fakeOperatorMembership]);

    const { updateMemberRole } = await import('./memberships');
    await expect(updateMemberRole('org-1', 'u-1', 'm-2', 'admin')).rejects.toThrow(
      'insufficient_permissions',
    );
  });

  it('throws not_a_member when caller has no accepted membership', async () => {
    selectResults.push([]); // no membership found

    const { updateMemberRole } = await import('./memberships');
    await expect(updateMemberRole('org-1', 'u-999', 'm-2', 'admin')).rejects.toThrow(
      'not_a_member',
    );
  });

  it('throws membership_not_found when target does not exist', async () => {
    selectResults.push([{ role: 'owner' }]); // caller role
    selectResults.push([]); // target not found

    const { updateMemberRole } = await import('./memberships');
    await expect(updateMemberRole('org-1', 'u-1', 'm-missing', 'admin')).rejects.toThrow(
      'membership_not_found',
    );
  });

  it('throws cannot_change_owner_role when admin tries to change owner', async () => {
    const ownerTarget = { ...fakeOperatorMembership, role: 'owner' as const, user_id: 'u-99' };
    selectResults.push([{ role: 'admin' }]); // caller is admin
    selectResults.push([ownerTarget]); // target is owner

    const { updateMemberRole } = await import('./memberships');
    await expect(updateMemberRole('org-1', 'u-1', 'm-2', 'admin')).rejects.toThrow(
      'cannot_change_owner_role',
    );
  });

  it('throws insufficient_permissions when admin tries to promote non-owner to owner', async () => {
    selectResults.push([{ role: 'admin' }]); // caller is admin
    selectResults.push([fakeOperatorMembership]); // target is operator (not owner)

    const { updateMemberRole } = await import('./memberships');
    await expect(updateMemberRole('org-1', 'u-1', 'm-2', 'owner')).rejects.toThrow(
      'insufficient_permissions',
    );
  });

  it('throws sole_owner_cannot_be_demoted when last owner demotes self', async () => {
    const selfOwner = { ...fakeOwnerMembership };
    selectResults.push([{ role: 'owner' }]); // caller role
    selectResults.push([selfOwner]); // target (self, owner)
    selectResults.push([{ total: 1 }]); // countAcceptedOwners → 1

    const { updateMemberRole } = await import('./memberships');
    await expect(updateMemberRole('org-1', 'u-1', 'm-1', 'admin')).rejects.toThrow(
      'sole_owner_cannot_be_demoted',
    );
  });

  it('allows owner to demote self when another owner exists', async () => {
    const selfOwner = { ...fakeOwnerMembership };
    selectResults.push([{ role: 'owner' }]); // caller role
    selectResults.push([selfOwner]); // target (self, owner)
    selectResults.push([{ total: 2 }]); // countAcceptedOwners → 2

    const { updateMemberRole } = await import('./memberships');
    await expect(updateMemberRole('org-1', 'u-1', 'm-1', 'admin')).resolves.toBeUndefined();
  });

  it('owner can change a non-owner role without countAcceptedOwners check', async () => {
    selectResults.push([{ role: 'owner' }]); // caller role
    selectResults.push([fakeOperatorMembership]); // target is operator

    const { updateMemberRole } = await import('./memberships');
    await updateMemberRole('org-1', 'u-1', 'm-2', 'viewer');

    // Only 2 select calls: caller role + target (no countAcceptedOwners)
    expect(mockTx.select).toHaveBeenCalledTimes(2);
  });
});

// ─── removeMember ─────────────────────────────────────────────────────────────

describe('removeMember', () => {
  it('uses withOrgContext and deletes the membership', async () => {
    selectResults.push([{ role: 'owner' }]); // caller role
    selectResults.push([fakeOperatorMembership]); // target

    const { removeMember } = await import('./memberships');
    await removeMember('org-1', 'u-1', 'm-2');

    expect(withOrgContext).toHaveBeenCalledWith('org-1', expect.any(Function));
    expect(mockTx.delete).toHaveBeenCalledOnce();
  });

  it('records member.removed audit entry', async () => {
    selectResults.push([{ role: 'owner' }]);
    selectResults.push([fakeOperatorMembership]);

    const { removeMember } = await import('./memberships');
    await removeMember('org-1', 'u-1', 'm-2');

    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ action: 'member.removed', subjectId: 'm-2' }),
    );
  });

  it('throws insufficient_permissions when caller is viewer', async () => {
    selectResults.push([{ role: 'viewer' }]);
    selectResults.push([fakeOperatorMembership]);

    const { removeMember } = await import('./memberships');
    await expect(removeMember('org-1', 'u-1', 'm-2')).rejects.toThrow('insufficient_permissions');
  });

  it('throws not_a_member when caller has no accepted membership', async () => {
    selectResults.push([]); // no membership found

    const { removeMember } = await import('./memberships');
    await expect(removeMember('org-1', 'u-999', 'm-2')).rejects.toThrow('not_a_member');
  });

  it('throws membership_not_found when target does not exist', async () => {
    selectResults.push([{ role: 'owner' }]);
    selectResults.push([]); // target not found

    const { removeMember } = await import('./memberships');
    await expect(removeMember('org-1', 'u-1', 'm-missing')).rejects.toThrow('membership_not_found');
  });

  it('throws cannot_remove_owner when admin tries to remove an owner', async () => {
    const ownerTarget = { ...fakeOperatorMembership, role: 'owner' as const, user_id: 'u-99' };
    selectResults.push([{ role: 'admin' }]); // caller is admin
    selectResults.push([ownerTarget]); // target is owner

    const { removeMember } = await import('./memberships');
    await expect(removeMember('org-1', 'u-1', 'm-2')).rejects.toThrow('cannot_remove_owner');
  });

  it('throws sole_owner_cannot_be_removed when last owner removes self', async () => {
    selectResults.push([{ role: 'owner' }]); // caller role
    selectResults.push([fakeOwnerMembership]); // target (self, owner)
    selectResults.push([{ total: 1 }]); // countAcceptedOwners → 1

    const { removeMember } = await import('./memberships');
    await expect(removeMember('org-1', 'u-1', 'm-1')).rejects.toThrow(
      'sole_owner_cannot_be_removed',
    );
  });

  it('allows owner to remove self when another owner exists', async () => {
    selectResults.push([{ role: 'owner' }]); // caller role
    selectResults.push([fakeOwnerMembership]); // target (self, owner)
    selectResults.push([{ total: 2 }]); // countAcceptedOwners → 2

    const { removeMember } = await import('./memberships');
    await expect(removeMember('org-1', 'u-1', 'm-1')).resolves.toBeUndefined();
  });

  it('allows admin to remove a non-owner', async () => {
    const viewerTarget = { ...fakeOperatorMembership, role: 'viewer' as const };
    selectResults.push([{ role: 'admin' }]);
    selectResults.push([viewerTarget]);

    const { removeMember } = await import('./memberships');
    await expect(removeMember('org-1', 'u-1', 'm-2')).resolves.toBeUndefined();
  });

  it('does not call countAcceptedOwners when removing a non-owner', async () => {
    selectResults.push([{ role: 'owner' }]); // caller role
    selectResults.push([fakeOperatorMembership]); // target is operator (not owner)

    const { removeMember } = await import('./memberships');
    await removeMember('org-1', 'u-1', 'm-2');

    // Only 2 select calls: caller role + target (no countAcceptedOwners)
    expect(mockTx.select).toHaveBeenCalledTimes(2);
  });
});

import { and, eq, isNotNull } from 'drizzle-orm';

import { recordAudit } from '@/lib/db/audit';
import type { DbTx } from '@/lib/db/context';
import { withOrgContext, withSystemContext } from '@/lib/db/context';
import { memberships, users } from '@/lib/db/schema';
import type { Membership, User } from '@/lib/db/schema';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { MemberRole } from '@/types';

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function getMemberRole(
  tx: DbTx,
  orgId: string,
  userId: string,
): Promise<MemberRole | null> {
  const [m] = await tx
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.org_id, orgId),
        eq(memberships.user_id, userId),
        isNotNull(memberships.accepted_at),
      ),
    );
  return m?.role ?? null;
}

async function requireCallerRole(
  tx: DbTx,
  orgId: string,
  byUserId: string,
  ...allowed: MemberRole[]
): Promise<MemberRole> {
  const role = await getMemberRole(tx, orgId, byUserId);
  if (!role) throw new Error('not_a_member');
  if (!allowed.includes(role)) throw new Error('insufficient_permissions');
  return role;
}

async function countAcceptedOwners(tx: DbTx, orgId: string): Promise<number> {
  const owners = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.org_id, orgId),
        eq(memberships.role, 'owner'),
        isNotNull(memberships.accepted_at),
      ),
    );
  return owners.length;
}

// ─── Email stub ───────────────────────────────────────────────────────────────

async function sendInviteEmail(_email: string, _orgId: string): Promise<void> {
  // TODO: full email template implementation in plan 13 (Resend)
}

// ─── Service functions ────────────────────────────────────────────────────────

export async function inviteMember(
  orgId: string,
  byUserId: string,
  input: { email: string; role: MemberRole },
): Promise<Membership> {
  // Look up or create the invitee outside the org-scoped transaction
  // (supabaseAdmin HTTP call cannot participate in a DB transaction)
  let inviteeId: string | null = null;

  await withSystemContext(async (tx) => {
    const [existingUser] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, input.email));
    if (existingUser) {
      inviteeId = existingUser.id;
    }
  });

  if (!inviteeId) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: input.email,
      email_confirm: false,
    });
    if (error ?? !data.user) {
      throw new Error(`failed_to_create_user: ${error?.message ?? 'unknown'}`);
    }
    inviteeId = data.user.id;

    // Mirror into public.users in case the trigger hasn't fired yet
    await withSystemContext(async (tx) => {
      await tx
        .insert(users)
        .values({ id: inviteeId!, email: input.email })
        .onConflictDoNothing();
    });
  }

  const userId = inviteeId;

  return withOrgContext(orgId, async (tx) => {
    await requireCallerRole(tx, orgId, byUserId, 'owner', 'admin');

    const [membership] = await tx
      .insert(memberships)
      .values({
        org_id: orgId,
        user_id: userId,
        role: input.role,
        // accepted_at intentionally null until invitee logs in
      })
      .returning();

    await recordAudit(tx, {
      orgId,
      actorUserId: byUserId,
      actorType: 'user',
      action: 'member.invited',
      subjectType: 'membership',
      subjectId: membership!.id,
      metadata: { email: input.email, role: input.role },
    });

    // Non-fatal: send invite email (stub; full implementation in plan 13)
    void sendInviteEmail(input.email, orgId);

    return membership!;
  });
}

export async function acceptInvite(membershipId: string, userId: string): Promise<void> {
  await withSystemContext(async (tx) => {
    const [m] = await tx
      .select()
      .from(memberships)
      .where(eq(memberships.id, membershipId));

    if (!m) throw new Error('membership_not_found');
    if (m.user_id !== userId) throw new Error('membership_user_mismatch');

    await tx
      .update(memberships)
      .set({ accepted_at: new Date() })
      .where(eq(memberships.id, membershipId));

    await recordAudit(tx, {
      orgId: m.org_id,
      actorUserId: userId,
      actorType: 'user',
      action: 'member.accepted',
      subjectType: 'membership',
      subjectId: membershipId,
    });
  });
}

export async function listMembers(
  orgId: string,
): Promise<Array<Membership & { user: User }>> {
  return withOrgContext(orgId, async (tx) => {
    const rows = await tx
      .select()
      .from(memberships)
      .innerJoin(users, eq(memberships.user_id, users.id))
      .where(eq(memberships.org_id, orgId));

    return rows.map((r) => ({ ...r.memberships, user: r.users }));
  });
}

export async function updateMemberRole(
  orgId: string,
  byUserId: string,
  membershipId: string,
  newRole: MemberRole,
): Promise<void> {
  await withOrgContext(orgId, async (tx) => {
    const callerRole = await requireCallerRole(tx, orgId, byUserId, 'owner', 'admin');

    const [target] = await tx
      .select()
      .from(memberships)
      .where(and(eq(memberships.id, membershipId), eq(memberships.org_id, orgId)));

    if (!target) throw new Error('membership_not_found');

    // Only owner can change another owner's role
    if (target.role === 'owner' && callerRole !== 'owner') {
      throw new Error('cannot_change_owner_role');
    }

    // Cannot demote yourself if you are the sole accepted owner
    if (target.user_id === byUserId && target.role === 'owner' && newRole !== 'owner') {
      const ownerCount = await countAcceptedOwners(tx, orgId);
      if (ownerCount <= 1) throw new Error('sole_owner_cannot_be_demoted');
    }

    await tx
      .update(memberships)
      .set({ role: newRole })
      .where(eq(memberships.id, membershipId));

    await recordAudit(tx, {
      orgId,
      actorUserId: byUserId,
      actorType: 'user',
      action: 'member.role_updated',
      subjectType: 'membership',
      subjectId: membershipId,
      metadata: { from: target.role, to: newRole },
    });
  });
}

export async function removeMember(
  orgId: string,
  byUserId: string,
  membershipId: string,
): Promise<void> {
  await withOrgContext(orgId, async (tx) => {
    const callerRole = await requireCallerRole(tx, orgId, byUserId, 'owner', 'admin');

    const [target] = await tx
      .select()
      .from(memberships)
      .where(and(eq(memberships.id, membershipId), eq(memberships.org_id, orgId)));

    if (!target) throw new Error('membership_not_found');

    // Only owner can remove another owner
    if (target.role === 'owner' && callerRole !== 'owner') {
      throw new Error('cannot_remove_owner');
    }

    // Cannot remove yourself if you are the sole accepted owner
    if (target.user_id === byUserId && target.role === 'owner') {
      const ownerCount = await countAcceptedOwners(tx, orgId);
      if (ownerCount <= 1) throw new Error('sole_owner_cannot_be_removed');
    }

    await tx.delete(memberships).where(eq(memberships.id, membershipId));

    await recordAudit(tx, {
      orgId,
      actorUserId: byUserId,
      actorType: 'user',
      action: 'member.removed',
      subjectType: 'membership',
      subjectId: membershipId,
      metadata: { removed_user_id: target.user_id, role: target.role },
    });
  });
}

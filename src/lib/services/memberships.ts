import { and, count, eq, isNotNull, isNull } from 'drizzle-orm';

import { recordAudit } from '@/lib/db/audit';
import type { DbTx } from '@/lib/db/context';
import { withOrgContext, withSystemContext } from '@/lib/db/context';
import { memberships, organizations, users } from '@/lib/db/schema';
import type { Membership, User } from '@/lib/db/schema';
import { sendEmail } from '@/lib/email';
import { renderMemberInviteEmail } from '@/lib/email/templates/member-invite';
import { env } from '@/lib/env';
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
  const [result] = await tx
    .select({ total: count() })
    .from(memberships)
    .where(
      and(
        eq(memberships.org_id, orgId),
        eq(memberships.role, 'owner'),
        isNotNull(memberships.accepted_at),
      ),
    );
  return result?.total ?? 0;
}

// ─── Email helper ─────────────────────────────────────────────────────────────

interface InviteEmailData {
  toEmail: string;
  orgName: string;
  inviterName: string;
  locale: 'it' | 'en';
  role: MemberRole;
  inviteeName: string | null;
  orgId: string;
  membershipId: string;
}

async function sendInviteEmail(data: InviteEmailData): Promise<void> {
  const base = env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') ?? '';
  const acceptUrl = `${base}/login`;

  const { subject, html, text } = await renderMemberInviteEmail({
    locale: data.locale,
    orgName: data.orgName,
    inviterName: data.inviterName,
    role: data.role,
    acceptUrl,
    ...(data.inviteeName && { recipientName: data.inviteeName }),
    ...(base && { appUrl: base }),
  });

  await sendEmail({
    to: data.toEmail,
    subject,
    html,
    text,
    tags: [
      { name: 'template', value: 'member-invite' },
      { name: 'org_id', value: data.orgId },
      { name: 'ref_id', value: data.membershipId },
    ],
  });
}

// ─── Service functions ────────────────────────────────────────────────────────

export async function inviteMember(
  orgId: string,
  byUserId: string,
  input: { email: string; role: MemberRole },
): Promise<Membership> {
  // Look up or create the invitee outside the org-scoped transaction
  // (supabaseAdmin HTTP call cannot participate in a DB transaction).
  // Permission check is performed first, before any side effects.
  let inviteeId: string | null = null;
  let emailData: InviteEmailData | null = null;

  await withSystemContext(async (tx) => {
    // Check caller permission before any side effects to avoid creating orphaned users
    const [caller] = await tx
      .select({ role: memberships.role })
      .from(memberships)
      .where(
        and(
          eq(memberships.org_id, orgId),
          eq(memberships.user_id, byUserId),
          isNotNull(memberships.accepted_at),
        ),
      );
    if (!caller) throw new Error('not_a_member');
    if (!(['owner', 'admin'] as MemberRole[]).includes(caller.role)) {
      throw new Error('insufficient_permissions');
    }
    // Only owners may invite new owners
    if (caller.role !== 'owner' && input.role === 'owner') {
      throw new Error('insufficient_permissions');
    }

    const [existingUser] = await tx
      .select({ id: users.id, full_name: users.full_name, locale: users.locale })
      .from(users)
      .where(eq(users.email, input.email));
    if (existingUser) {
      inviteeId = existingUser.id;
    }

    // Collect email data while we have a system-context transaction open
    const [orgRow] = await tx
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, orgId));
    const [inviterRow] = await tx
      .select({ full_name: users.full_name, locale: users.locale })
      .from(users)
      .where(eq(users.id, byUserId));

    if (orgRow) {
      emailData = {
        toEmail: input.email,
        orgName: orgRow.name,
        inviterName: inviterRow?.full_name?.trim() || 'Un membro del team',
        locale: existingUser?.locale ?? 'it',
        role: input.role,
        inviteeName: existingUser?.full_name ?? null,
        orgId,
        membershipId: '', // filled in after membership row is created
      };
    }
  });

  if (!inviteeId) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: input.email,
      email_confirm: false,
    });
    if (error ?? !data.user) {
      throw new Error('failed_to_create_user');
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
    const callerRole = await requireCallerRole(tx, orgId, byUserId, 'owner', 'admin');
    // Defense-in-depth: repeat the owner-escalation guard inside the transaction
    if (callerRole !== 'owner' && input.role === 'owner') {
      throw new Error('insufficient_permissions');
    }

    const [membership] = await tx
      .insert(memberships)
      .values({
        org_id: orgId,
        user_id: userId,
        role: input.role,
        // accepted_at intentionally null until invitee logs in
      })
      .onConflictDoNothing()
      .returning();

    if (!membership) {
      throw new Error('already_a_member');
    }

    await recordAudit(tx, {
      orgId,
      actorUserId: byUserId,
      actorType: 'user',
      action: 'member.invited',
      subjectType: 'membership',
      subjectId: membership.id,
      metadata: { email: input.email, role: input.role },
    });

    // Non-fatal: send invite email with data collected in the preflight context
    if (emailData) {
      emailData.membershipId = membership.id;
      void sendInviteEmail(emailData).catch((e: unknown) =>
        console.error('[memberships] sendInviteEmail failed:', e),
      );
    }

    return membership;
  });
}

/**
 * Accepts all pending membership invitations for a user.
 * Called on SIGNED_IN webhook events so that invited users gain org access on first login.
 */
export async function acceptPendingInvites(userId: string): Promise<void> {
  await withSystemContext(async (tx) => {
    const pending = await tx
      .select({ id: memberships.id, org_id: memberships.org_id })
      .from(memberships)
      .where(and(eq(memberships.user_id, userId), isNull(memberships.accepted_at)));

    for (const m of pending) {
      await tx
        .update(memberships)
        .set({ accepted_at: new Date() })
        .where(and(eq(memberships.id, m.id), isNull(memberships.accepted_at)));

      await recordAudit(tx, {
        orgId: m.org_id,
        actorUserId: userId,
        actorType: 'user',
        action: 'member.accepted',
        subjectType: 'membership',
        subjectId: m.id,
      });
    }
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
    if (m.accepted_at !== null) throw new Error('already_accepted');

    await tx
      .update(memberships)
      .set({ accepted_at: new Date() })
      .where(and(eq(memberships.id, membershipId), isNull(memberships.accepted_at)));

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

    // Only owner can assign the owner role
    if (newRole === 'owner' && callerRole !== 'owner') {
      throw new Error('insufficient_permissions');
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

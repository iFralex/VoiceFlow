import { getAuthContext, hasCapability } from '@/lib/auth/context';
import { listMembers } from '@/lib/services/memberships';
import { supabaseAdmin } from '@/lib/supabase/admin';

import type { SerializedMember } from './_components/members-page-client';
import { MembersPageClient } from './_components/members-page-client';

export default async function MembersPage() {
  const { orgId, role } = await getAuthContext();

  const members = await listMembers(orgId);

  // Best-effort: fetch last_sign_in_at from auth.users via admin API
  const lastSignInMap: Record<string, string | null> = {};
  try {
    const { data } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    for (const user of data.users) {
      lastSignInMap[user.id] = user.last_sign_in_at ?? null;
    }
  } catch {
    // Non-fatal: last login column will show "Mai" / "Never"
  }

  const serialized: SerializedMember[] = members.map((m) => ({
    id: m.id,
    user_id: m.user_id,
    role: m.role,
    invited_at: m.invited_at.toISOString(),
    accepted_at: m.accepted_at?.toISOString() ?? null,
    user: {
      id: m.user.id,
      email: m.user.email,
      full_name: m.user.full_name,
    },
    lastSignInAt: lastSignInMap[m.user_id] ?? null,
  }));

  const canInvite = hasCapability(role, 'members.invite');
  const canManage = hasCapability(role, 'members.update_role');

  return (
    <MembersPageClient
      members={serialized}
      canInvite={canInvite}
      canManage={canManage}
    />
  );
}

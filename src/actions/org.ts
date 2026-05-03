'use server';

import { cookies } from 'next/headers';

/**
 * Sets the active_org_id cookie so subsequent server renders resolve to the
 * selected organisation. The caller is responsible for calling router.refresh()
 * after this action to re-render the page with the new org context.
 *
 * TODO (plan 04): Verify the authenticated user is a member of `orgId` before
 * setting the cookie. Without this check any authenticated user can switch into
 * an arbitrary organisation's context.
 * Example guard:
 *   const { userId } = await getAuthUser();
 *   const member = await db.query.memberships.findFirst({
 *     where: and(eq(memberships.org_id, orgId), eq(memberships.user_id, userId)),
 *   });
 *   if (!member) throw new Error('Unauthorized');
 */
export async function switchOrg(orgId: string): Promise<void> {
  const store = await cookies();
  store.set('active_org_id', orgId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });
}

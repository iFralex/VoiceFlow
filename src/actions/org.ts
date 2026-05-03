'use server';

import { cookies } from 'next/headers';

/**
 * Sets the active_org_id cookie so subsequent server renders resolve to the
 * selected organisation. The caller is responsible for calling router.refresh()
 * after this action to re-render the page with the new org context.
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

/**
 * Auth context helpers for Server Components and Server Actions.
 *
 * The middleware (src/middleware.ts) injects x-user-id, x-org-id and
 * x-member-role as request headers on every protected route. These helpers
 * read those headers and expose typed capability checks.
 */

import { headers } from 'next/headers';

import type { MemberRole } from '@/types';

// ─── Capability list ──────────────────────────────────────────────────────────

export type Capability =
  | 'org.manage'
  | 'org.update'
  | 'members.invite'
  | 'members.update_role'
  | 'billing.topup'
  | 'billing.view'
  | 'campaigns.launch'
  | 'campaigns.view'
  | 'contacts.upload'
  | 'contacts.delete'
  | 'scripts.edit'
  | 'compliance.export'
  | 'compliance.erase'
  | 'audit.view';

// ─── Role → capability map ────────────────────────────────────────────────────

const ALL_CAPABILITIES: Capability[] = [
  'org.manage',
  'org.update',
  'members.invite',
  'members.update_role',
  'billing.topup',
  'billing.view',
  'campaigns.launch',
  'campaigns.view',
  'contacts.upload',
  'contacts.delete',
  'scripts.edit',
  'compliance.export',
  'compliance.erase',
  'audit.view',
];

const ROLE_CAPABILITIES: Record<MemberRole, ReadonlySet<Capability>> = {
  // owner: everything
  owner: new Set(ALL_CAPABILITIES),

  // admin: everything except org lifecycle management (delete, transfer)
  admin: new Set(ALL_CAPABILITIES.filter((c) => c !== 'org.manage')),

  // operator: campaign and contact work, script editing, billing read-only
  operator: new Set<Capability>([
    'campaigns.launch',
    'campaigns.view',
    'contacts.upload',
    'scripts.edit',
    'billing.view',
  ]),

  // viewer: read-only across all domains
  viewer: new Set<Capability>([
    'billing.view',
    'campaigns.view',
    'audit.view',
  ]),
};

// ─── Public API ───────────────────────────────────────────────────────────────

export interface AuthContext {
  userId: string;
  orgId: string;
  role: MemberRole;
}

/**
 * Returns the current user's identity and role from the middleware-injected
 * request headers. Must be called from a Server Component or Server Action
 * running inside a protected route.
 */
export async function getAuthContext(): Promise<AuthContext> {
  const h = await headers();
  const userId = h.get('x-user-id');
  const orgId = h.get('x-org-id');
  const role = h.get('x-member-role') as MemberRole | null;

  if (!userId || !orgId || !role) {
    throw new Error(
      'Auth context headers are missing — ensure this is called from a protected route handled by middleware.',
    );
  }

  return { userId, orgId, role };
}

/**
 * Returns true if `role` has the given `capability`.
 */
export function hasCapability(role: MemberRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role]?.has(capability) ?? false;
}

/**
 * Throws a 403-style error if the current user does not hold `capability`.
 * Use in Server Actions to gate destructive or privileged operations.
 */
export async function requireCapability(capability: Capability): Promise<void> {
  const { role } = await getAuthContext();
  if (!hasCapability(role, capability)) {
    throw new Error(`Forbidden: role '${role}' does not have capability '${capability}'`);
  }
}

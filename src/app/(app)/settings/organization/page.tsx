import { count, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';

import { getAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/context';
import { memberships } from '@/lib/db/schema';
import { getOrganization } from '@/lib/services/organizations';

import type { SerializedOrg } from './_components/organization-settings-client';
import { OrganizationSettingsClient } from './_components/organization-settings-client';

export default async function OrganizationSettingsPage() {
  const { orgId, role } = await getAuthContext();

  const org = await getOrganization(orgId);
  if (!org) notFound();

  const memberCount = await withOrgContext(orgId, async (tx) => {
    const [row] = await tx
      .select({ count: count() })
      .from(memberships)
      .where(eq(memberships.org_id, orgId));
    return row?.count ?? 0;
  });

  const serialized: SerializedOrg = {
    id: org.id,
    name: org.name,
    legal_name: org.legal_name,
    vat_number: org.vat_number,
    created_at: org.created_at.toISOString(),
    memberCount,
  };

  return <OrganizationSettingsClient org={serialized} isOwner={role === 'owner'} />;
}

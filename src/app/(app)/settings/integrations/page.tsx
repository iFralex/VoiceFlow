import { getAuthContext } from '@/lib/auth/context';
import { listPats } from '@/lib/services/pat';

import type { SerializedPat } from './_components/integrations-page-client';
import { IntegrationsPageClient } from './_components/integrations-page-client';

export default async function IntegrationsPage() {
  const { userId, orgId } = await getAuthContext();
  const pats = await listPats(userId, orgId);

  const serialized: SerializedPat[] = pats.map((p) => ({
    id: p.id,
    name: p.name,
    prefix: p.prefix,
    scopes: p.scopes,
    last_used_at: p.last_used_at?.toISOString() ?? null,
    expires_at: p.expires_at?.toISOString() ?? null,
    created_at: p.created_at.toISOString(),
  }));

  return <IntegrationsPageClient pats={serialized} />;
}

import { getAuthContext } from '@/lib/auth/context';
import { listPats } from '@/lib/services/pat';
import { listWebhooks } from '@/lib/services/webhooks_outgoing';

import type { SerializedPat } from './_components/integrations-page-client';
import { IntegrationsPageClient } from './_components/integrations-page-client';
import type { SerializedWebhook } from './_components/webhooks-section';

export default async function IntegrationsPage() {
  const { userId, orgId } = await getAuthContext();
  const [pats, webhooks] = await Promise.all([listPats(userId, orgId), listWebhooks(orgId)]);

  const serializedPats: SerializedPat[] = pats.map((p) => ({
    id: p.id,
    name: p.name,
    prefix: p.prefix,
    scopes: p.scopes,
    last_used_at: p.last_used_at?.toISOString() ?? null,
    expires_at: p.expires_at?.toISOString() ?? null,
    created_at: p.created_at.toISOString(),
  }));

  const serializedWebhooks: SerializedWebhook[] = webhooks.map((w) => ({
    id: w.id,
    url: w.url,
    event_types: w.event_types,
    active: w.active,
    failure_count: w.failure_count,
    last_delivery_at: w.last_delivery_at?.toISOString() ?? null,
    created_at: w.created_at.toISOString(),
  }));

  return <IntegrationsPageClient pats={serializedPats} webhooks={serializedWebhooks} />;
}

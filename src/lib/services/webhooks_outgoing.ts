import crypto from 'node:crypto';

import { and, desc, eq, lt } from 'drizzle-orm';

import { recordAudit } from '@/lib/db/audit';
import { withOrgContext } from '@/lib/db/context';
import { webhookDeliveries, webhooksOutgoing } from '@/lib/db/schema';
import type { WebhookDelivery, WebhookOutgoing } from '@/lib/db/schema';
import { sendInngestEvent } from '@/lib/inngest/client';

import { ALLOWED_EVENT_TYPES } from './webhooks_outgoing/events';

export { ALLOWED_EVENT_TYPES } from './webhooks_outgoing/events';
export type { WebhookEventType } from './webhooks_outgoing/events';

function generateSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString('hex')}`;
}

export async function createWebhook(
  orgId: string,
  byUserId: string,
  input: { url: string; eventTypes: string[] },
): Promise<{ webhook: WebhookOutgoing; secretRevealed: string }> {
  const invalid = input.eventTypes.filter(
    (et) => !(ALLOWED_EVENT_TYPES as readonly string[]).includes(et),
  );
  if (invalid.length > 0) {
    throw new Error(`invalid_event_types: ${invalid.join(', ')}`);
  }

  const secretRevealed = generateSecret();

  const webhook = await withOrgContext(orgId, async (tx) => {
    const [created] = await tx
      .insert(webhooksOutgoing)
      .values({
        org_id: orgId,
        url: input.url,
        secret: secretRevealed,
        event_types: input.eventTypes,
      })
      .returning();

    await recordAudit(tx, {
      orgId,
      actorUserId: byUserId,
      actorType: 'user',
      action: 'webhook.created',
      subjectType: 'webhook_outgoing',
      subjectId: created!.id,
      metadata: { url: input.url, eventTypes: input.eventTypes },
    });

    return created!;
  });

  return { webhook, secretRevealed };
}

export async function listWebhooks(orgId: string): Promise<WebhookOutgoing[]> {
  return withOrgContext(orgId, async (tx) => {
    return tx
      .select()
      .from(webhooksOutgoing)
      .where(eq(webhooksOutgoing.org_id, orgId))
      .orderBy(desc(webhooksOutgoing.created_at));
  });
}

export async function rotateSecret(
  orgId: string,
  byUserId: string,
  webhookId: string,
): Promise<{ secretRevealed: string }> {
  const secretRevealed = generateSecret();

  await withOrgContext(orgId, async (tx) => {
    const [updated] = await tx
      .update(webhooksOutgoing)
      .set({ secret: secretRevealed })
      .where(and(eq(webhooksOutgoing.id, webhookId), eq(webhooksOutgoing.org_id, orgId)))
      .returning({ id: webhooksOutgoing.id });

    if (!updated) throw new Error('webhook_not_found');

    await recordAudit(tx, {
      orgId,
      actorUserId: byUserId,
      actorType: 'user',
      action: 'webhook.secret_rotated',
      subjectType: 'webhook_outgoing',
      subjectId: webhookId,
    });
  });

  return { secretRevealed };
}

export async function deleteWebhook(
  orgId: string,
  byUserId: string,
  webhookId: string,
): Promise<void> {
  await withOrgContext(orgId, async (tx) => {
    const [deleted] = await tx
      .delete(webhooksOutgoing)
      .where(and(eq(webhooksOutgoing.id, webhookId), eq(webhooksOutgoing.org_id, orgId)))
      .returning({ id: webhooksOutgoing.id });

    if (!deleted) throw new Error('webhook_not_found');

    await recordAudit(tx, {
      orgId,
      actorUserId: byUserId,
      actorType: 'user',
      action: 'webhook.deleted',
      subjectType: 'webhook_outgoing',
      subjectId: webhookId,
    });
  });
}

export async function listDeliveries(
  orgId: string,
  webhookId: string,
  page: { limit: number; cursor?: string },
): Promise<{ items: WebhookDelivery[]; nextCursor?: string }> {
  const limit = Math.min(Math.max(page.limit, 1), 100);

  return withOrgContext(orgId, async (tx) => {
    const [webhook] = await tx
      .select({ id: webhooksOutgoing.id })
      .from(webhooksOutgoing)
      .where(and(eq(webhooksOutgoing.id, webhookId), eq(webhooksOutgoing.org_id, orgId)));

    if (!webhook) throw new Error('webhook_not_found');

    const conditions: ReturnType<typeof eq>[] = [eq(webhookDeliveries.webhook_id, webhookId)];
    if (page.cursor) {
      conditions.push(lt(webhookDeliveries.delivered_at, new Date(page.cursor)));
    }

    const rows = await tx
      .select()
      .from(webhookDeliveries)
      .where(and(...conditions))
      .orderBy(desc(webhookDeliveries.delivered_at), desc(webhookDeliveries.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    const out: { items: WebhookDelivery[]; nextCursor?: string } = { items };
    if (hasMore && items.length > 0) {
      const lastDeliveredAt = items[items.length - 1]!.delivered_at;
      if (lastDeliveredAt) out.nextCursor = lastDeliveredAt.toISOString();
    }
    return out;
  });
}

export async function replayDelivery(
  orgId: string,
  byUserId: string,
  deliveryId: string,
): Promise<void> {
  const delivery = await withOrgContext(orgId, async (tx) => {
    const [row] = await tx
      .select({
        id: webhookDeliveries.id,
        webhookId: webhookDeliveries.webhook_id,
        eventType: webhookDeliveries.event_type,
        payload: webhookDeliveries.payload,
      })
      .from(webhookDeliveries)
      .innerJoin(webhooksOutgoing, eq(webhookDeliveries.webhook_id, webhooksOutgoing.id))
      .where(
        and(eq(webhookDeliveries.id, deliveryId), eq(webhooksOutgoing.org_id, orgId)),
      );

    if (!row) throw new Error('delivery_not_found');

    await recordAudit(tx, {
      orgId,
      actorUserId: byUserId,
      actorType: 'user',
      action: 'webhook.delivery.replayed',
      subjectType: 'webhook_delivery',
      subjectId: deliveryId,
      metadata: { webhookId: row.webhookId, eventType: row.eventType },
    });

    return row;
  });

  await sendInngestEvent({
    name: 'webhook/deliver',
    data: {
      webhookId: delivery.webhookId,
      eventType: delivery.eventType,
      payload: delivery.payload,
    },
  });
}

/**
 * Inngest handler: webhook-emit-fanout
 *
 * Triggered by `webhook/emit` events emitted by domain services when a
 * business event occurs (call completed, appointment booked, etc.).
 *
 * Resolves all active outbound webhook subscriptions for the org that
 * include the emitted event type, then fans out one `webhook/deliver`
 * event per matching subscription.
 *
 * Delivery events are given deterministic IDs when a `dedupKey` is provided
 * by the caller, preventing double-delivery if the fanout runs more than once
 * for the same business event.
 */

import { and, eq, sql } from 'drizzle-orm';

import { withSystemContext } from '@/lib/db/context';
import { webhooksOutgoing } from '@/lib/db/schema';
import type { InngestEventPayload } from '@/lib/inngest/client';
import { sendInngestEvents } from '@/lib/inngest/client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WebhookEmitData {
  orgId: string;
  eventType: string;
  payload: Record<string, unknown>;
  /**
   * Optional stable key for deterministic delivery event IDs.
   * Callers should pass a value derived from the triggering entity
   * (e.g. callId, campaignId) to prevent duplicate deliveries on replay.
   */
  dedupKey?: string;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

/**
 * Handles the `webhook/emit` event.
 *
 * Queries active subscriptions for the org that subscribe to `eventType`
 * and fans out a `webhook/deliver` event per matching webhook.
 */
export async function webhookEmitFanoutHandler(data: WebhookEmitData): Promise<void> {
  const { orgId, eventType, payload, dedupKey } = data;

  const matchingWebhooks = await withSystemContext((tx) =>
    tx
      .select({ id: webhooksOutgoing.id })
      .from(webhooksOutgoing)
      .where(
        and(
          eq(webhooksOutgoing.org_id, orgId),
          eq(webhooksOutgoing.active, true),
          sql`${eventType} = ANY(${webhooksOutgoing.event_types})`,
        ),
      ),
  );

  if (matchingWebhooks.length === 0) return;

  const deliverEvents: InngestEventPayload[] = matchingWebhooks.map((webhook) => ({
    name: 'webhook/deliver',
    data: {
      webhookId: webhook.id,
      eventType,
      payload,
      ...(dedupKey !== undefined ? { dedupKey } : {}),
    },
    ...(dedupKey !== undefined
      ? { id: `webhook-deliver-${webhook.id}-${eventType}-${dedupKey}` }
      : {}),
  }));

  await sendInngestEvents(deliverEvents);
}

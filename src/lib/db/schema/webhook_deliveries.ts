import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { webhooksOutgoing } from './webhooks_outgoing';

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    webhook_id: uuid('webhook_id')
      .notNull()
      .references(() => webhooksOutgoing.id, { onDelete: 'cascade' }),
    event_type: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    status_code: integer('status_code'),
    attempt: integer('attempt').notNull().default(1),
    delivered_at: timestamp('delivered_at', { withTimezone: true }),
    error: text('error'),
  },
  (t) => [
    index('webhook_deliveries_webhook_id_idx').on(t.webhook_id),
    index('webhook_deliveries_delivered_at_idx').on(t.delivered_at),
  ],
);

export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;

import { sql } from 'drizzle-orm';
import { jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

// System-owned table — no RLS. Stores inbound webhook payloads for idempotent processing.
export const webhookProviderEnum = pgEnum('webhook_provider', [
  'stripe',
  'vapi',
  'retell',
  'twilio',
  'supabase_auth',
]);

export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    provider: webhookProviderEnum('provider').notNull(),
    provider_event_id: text('provider_event_id').notNull(),
    event_type: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    received_at: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processed_at: timestamp('processed_at', { withTimezone: true }),
    error: text('error'),
  },
  (t) => [
    unique('webhook_events_provider_event_id_key').on(t.provider, t.provider_event_id),
  ],
);

export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;

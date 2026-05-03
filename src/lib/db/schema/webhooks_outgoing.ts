import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { organizations } from './organizations';

export const webhooksOutgoing = pgTable(
  'webhooks_outgoing',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    org_id: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    secret: text('secret').notNull(),
    event_types: text('event_types').array().notNull().default(sql`'{}'::text[]`),
    active: boolean('active').notNull().default(true),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    last_delivery_at: timestamp('last_delivery_at', { withTimezone: true }),
    last_failure_at: timestamp('last_failure_at', { withTimezone: true }),
    failure_count: integer('failure_count').notNull().default(0),
  },
  (t) => [index('webhooks_outgoing_org_id_idx').on(t.org_id)],
);

export type WebhookOutgoing = typeof webhooksOutgoing.$inferSelect;
export type NewWebhookOutgoing = typeof webhooksOutgoing.$inferInsert;

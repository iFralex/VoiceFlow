import { index, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { organizations } from './organizations';

export const optOutSourceEnum = pgEnum('opt_out_source', [
  'call_outcome',
  'dealer_input',
  'gdpr_request',
  'inbound_ivr',
]);

export const optOutRegistry = pgTable(
  'opt_out_registry',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    org_id: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    phone_e164: text('phone_e164').notNull(),
    source: optOutSourceEnum('source').notNull(),
    recorded_at: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('opt_out_registry_org_phone_key').on(t.org_id, t.phone_e164),
    index('opt_out_registry_org_id_idx').on(t.org_id),
  ],
);

export type OptOutRegistryEntry = typeof optOutRegistry.$inferSelect;
export type NewOptOutRegistryEntry = typeof optOutRegistry.$inferInsert;

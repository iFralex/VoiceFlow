import { index, integer, numeric, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { organizations } from './organizations';

export const phoneProviderEnum = pgEnum('phone_provider', ['voiped', 'twilio', 'telnyx']);

export const phoneStatusEnum = pgEnum('phone_status', ['active', 'cooling_down', 'retired']);

export const phoneNumbers = pgTable(
  'phone_numbers',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    e164: text('e164').notNull(),
    org_id: uuid('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    provider: phoneProviderEnum('provider').notNull(),
    status: phoneStatusEnum('status').notNull().default('active'),
    last_used_at: timestamp('last_used_at', { withTimezone: true }),
    daily_call_count: integer('daily_call_count').notNull().default(0),
    spam_score: numeric('spam_score').notNull().default('0'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('phone_numbers_e164_unique').on(t.e164),
    index('phone_numbers_org_status_active_idx')
      .on(t.org_id, t.status)
      .where(sql`${t.status} = 'active'`),
  ],
);

export type PhoneNumber = typeof phoneNumbers.$inferSelect;
export type NewPhoneNumber = typeof phoneNumbers.$inferInsert;

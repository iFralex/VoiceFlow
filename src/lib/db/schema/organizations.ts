import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const organizations = pgTable('organizations', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  legal_name: text('legal_name'),
  vat_number: text('vat_number'),
  country: text('country').notNull().default('IT'),
  timezone: text('timezone').notNull().default('Europe/Rome'),
  stripe_customer_id: text('stripe_customer_id'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
});

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;

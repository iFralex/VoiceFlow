import { boolean, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const creditPackages = pgTable('credit_packages', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  slug: text('slug').notNull().unique(),
  display_name: text('display_name').notNull(),
  price_cents: integer('price_cents').notNull(),
  included_minutes: integer('included_minutes').notNull(),
  stripe_price_id: text('stripe_price_id'),
  active: boolean('active').notNull().default(true),
});

export type CreditPackage = typeof creditPackages.$inferSelect;
export type NewCreditPackage = typeof creditPackages.$inferInsert;

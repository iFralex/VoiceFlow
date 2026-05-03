import { integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { organizations } from './organizations';
import { creditPackages } from './credit_packages';

export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'succeeded',
  'failed',
  'refunded',
]);

export const payments = pgTable('payments', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  org_id: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  package_id: uuid('package_id')
    .notNull()
    .references(() => creditPackages.id, { onDelete: 'restrict' }),
  stripe_session_id: text('stripe_session_id').notNull().unique(),
  stripe_payment_intent_id: text('stripe_payment_intent_id'),
  amount_cents: integer('amount_cents').notNull(),
  currency: text('currency').notNull().default('eur'),
  status: paymentStatusEnum('status').notNull().default('pending'),
  invoice_url: text('invoice_url'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completed_at: timestamp('completed_at', { withTimezone: true }),
});

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;

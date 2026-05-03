import { sql } from 'drizzle-orm';
import { index, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { organizations } from './organizations';

export const creditEntryTypeEnum = pgEnum('credit_entry_type', [
  'topup',
  'reservation',
  'release',
  'charge',
  'refund',
  'adjustment',
]);

export const creditLedger = pgTable(
  'credit_ledger',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    org_id: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    entry_type: creditEntryTypeEnum('entry_type').notNull(),
    delta_cents: integer('delta_cents').notNull(),
    balance_after_cents: integer('balance_after_cents').notNull(),
    reference_type: text('reference_type'),
    reference_id: text('reference_id'),
    description: text('description'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('credit_ledger_idempotency_key').on(
      t.org_id,
      t.reference_type,
      t.reference_id,
      t.entry_type,
    ),
    index('credit_ledger_org_created_at_idx').on(t.org_id, t.created_at),
  ],
);

export type CreditLedgerEntry = typeof creditLedger.$inferSelect;
export type NewCreditLedgerEntry = typeof creditLedger.$inferInsert;

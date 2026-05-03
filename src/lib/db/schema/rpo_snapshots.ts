import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// System-owned table — no org_id, no RLS. Queried via service role.
export const rpoSnapshots = pgTable('rpo_snapshots', {
  phone_e164: text('phone_e164').primaryKey(),
  is_blocked: boolean('is_blocked').notNull(),
  last_checked_at: timestamp('last_checked_at', { withTimezone: true }).notNull().defaultNow(),
});

export type RpoSnapshot = typeof rpoSnapshots.$inferSelect;
export type NewRpoSnapshot = typeof rpoSnapshots.$inferInsert;

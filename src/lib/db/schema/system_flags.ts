import { sql } from 'drizzle-orm';
import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Cross-cutting key/value flags consumed by the dispatcher and the crons.
 * No RLS — read and written via `withSystemContext` only. See
 * `src/lib/services/system_flags.ts` for the typed accessor and the SBC
 * health-tracking helpers used by plan 10 task 13.
 */
export const systemFlags = pgTable('system_flags', {
  key: text('key').primaryKey(),
  value: jsonb('value')
    .notNull()
    .default(sql`'{}'::jsonb`),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SystemFlag = typeof systemFlags.$inferSelect;
export type NewSystemFlag = typeof systemFlags.$inferInsert;

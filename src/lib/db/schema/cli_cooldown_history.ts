import { sql } from 'drizzle-orm';
import { index, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { phoneNumbers } from './phone_numbers';

/**
 * One row per cooldown transition for a CLI. The CLI watchdog (plan 10 task 7,
 * `src/app/api/cron/cli-watchdog/route.ts`) inserts here whenever it moves a
 * CLI to `status='cooling_down'`, and queries this table on subsequent runs
 * to count cooldowns in the last 30 days — three or more triggers retirement.
 */
export const cliCooldownHistory = pgTable(
  'cli_cooldown_history',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    phone_number_id: uuid('phone_number_id')
      .notNull()
      .references(() => phoneNumbers.id, { onDelete: 'cascade' }),
    started_at: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    spam_score: numeric('spam_score').notNull(),
    reason: text('reason').notNull().default('spam_score_exceeded'),
  },
  (t) => [
    index('cli_cooldown_history_phone_started_idx').on(t.phone_number_id, t.started_at),
  ],
);

export type CliCooldownHistoryEntry = typeof cliCooldownHistory.$inferSelect;
export type NewCliCooldownHistoryEntry = typeof cliCooldownHistory.$inferInsert;

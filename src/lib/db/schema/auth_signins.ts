import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

/** IP + user-agent fingerprints recorded on every signin for suspicious-login detection. */
export const authSignins = pgTable(
  'auth_signins',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ip: text('ip').notNull(),
    user_agent: text('user_agent').notNull().default(''),
    signed_in_at: timestamp('signed_in_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('auth_signins_user_id_signed_in_at_idx').on(t.user_id, t.signed_in_at)],
);

export type AuthSignin = typeof authSignins.$inferSelect;
export type NewAuthSignin = typeof authSignins.$inferInsert;

import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { organizations } from './organizations';
import { users } from './users';

export const personalAccessTokens = pgTable(
  'personal_access_tokens',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    org_id: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** SHA-256 hex digest of the raw bearer token — never store the raw token */
    token_hash: text('token_hash').notNull().unique(),
    /** First 8 characters of the raw token for display purposes */
    prefix: text('prefix').notNull(),
    scopes: text('scopes').array().notNull().default(sql`'{}'`),
    last_used_at: timestamp('last_used_at', { withTimezone: true }),
    expires_at: timestamp('expires_at', { withTimezone: true }),
    revoked_at: timestamp('revoked_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('personal_access_tokens_hash_idx').on(t.token_hash),
    index('personal_access_tokens_user_org_idx').on(t.user_id, t.org_id),
  ],
);

export type PersonalAccessToken = typeof personalAccessTokens.$inferSelect;
export type NewPersonalAccessToken = typeof personalAccessTokens.$inferInsert;

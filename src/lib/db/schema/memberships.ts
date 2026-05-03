import { sql } from 'drizzle-orm';
import { index, pgEnum, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { organizations } from './organizations';
import { users } from './users';

export const memberRoleEnum = pgEnum('member_role', ['owner', 'admin', 'operator', 'viewer']);

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    org_id: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRoleEnum('role').notNull(),
    invited_at: timestamp('invited_at', { withTimezone: true }).notNull().defaultNow(),
    accepted_at: timestamp('accepted_at', { withTimezone: true }),
  },
  (t) => [
    unique('memberships_org_user_unique').on(t.org_id, t.user_id),
    index('memberships_user_id_idx').on(t.user_id),
    index('memberships_org_id_idx').on(t.org_id),
  ],
);

export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;

import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';

import { organizations } from './organizations';
import { users } from './users';

export const userNotificationPreferences = pgTable(
  'user_notification_preferences',
  {
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    org_id: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    daily_report: boolean('daily_report').notNull().default(true),
    appointment_booked: boolean('appointment_booked').notNull().default(true),
    qualified_lead: boolean('qualified_lead').notNull().default(true),
    low_credit: boolean('low_credit').notNull().default(true),
    campaign_completed: boolean('campaign_completed').notNull().default(true),
    weekly_summary: boolean('weekly_summary').notNull().default(false),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    primaryKey({ columns: [t.user_id, t.org_id] }),
    index('user_notification_preferences_org_id_idx').on(t.org_id),
  ],
);

export type UserNotificationPreference = typeof userNotificationPreferences.$inferSelect;
export type NewUserNotificationPreference = typeof userNotificationPreferences.$inferInsert;

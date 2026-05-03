import { index, integer, pgEnum, pgTable, text, time, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { organizations } from './organizations';
import { scripts } from './scripts';
import { contactLists } from './contact_lists';

export const campaignStatusEnum = pgEnum('campaign_status', [
  'draft',
  'scheduled',
  'running',
  'paused',
  'completed',
  'cancelled',
]);

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    org_id: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    script_id: uuid('script_id')
      .notNull()
      .references(() => scripts.id, { onDelete: 'restrict' }),
    contact_list_id: uuid('contact_list_id')
      .notNull()
      .references(() => contactLists.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    status: campaignStatusEnum('status').notNull().default('draft'),
    concurrency_limit: integer('concurrency_limit').notNull().default(5),
    time_window_start: time('time_window_start').notNull().default('09:00'),
    time_window_end: time('time_window_end').notNull().default('19:00'),
    scheduled_at: timestamp('scheduled_at', { withTimezone: true }),
    started_at: timestamp('started_at', { withTimezone: true }),
    completed_at: timestamp('completed_at', { withTimezone: true }),
    estimated_max_cents: integer('estimated_max_cents'),
    actual_cents: integer('actual_cents').notNull().default(0),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('campaigns_org_id_idx').on(t.org_id),
    index('campaigns_org_status_idx').on(t.org_id, t.status),
  ],
);

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;

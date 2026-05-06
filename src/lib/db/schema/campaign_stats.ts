import { index, integer, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

import { campaigns } from './campaigns';
import { organizations } from './organizations';

export const campaignStats = pgTable(
  'campaign_stats',
  {
    campaign_id: uuid('campaign_id')
      .primaryKey()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    org_id: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    total_calls: integer('total_calls').notNull().default(0),
    pending_calls: integer('pending_calls').notNull().default(0),
    dialing_calls: integer('dialing_calls').notNull().default(0),
    in_progress_calls: integer('in_progress_calls').notNull().default(0),
    completed_calls: integer('completed_calls').notNull().default(0),
    failed_calls: integer('failed_calls').notNull().default(0),
    outcome_appointment_booked: integer('outcome_appointment_booked').notNull().default(0),
    outcome_interested: integer('outcome_interested').notNull().default(0),
    outcome_not_interested: integer('outcome_not_interested').notNull().default(0),
    outcome_wrong_number: integer('outcome_wrong_number').notNull().default(0),
    outcome_callback: integer('outcome_callback').notNull().default(0),
    outcome_voicemail: integer('outcome_voicemail').notNull().default(0),
    outcome_do_not_call: integer('outcome_do_not_call').notNull().default(0),
    total_billed_seconds: integer('total_billed_seconds').notNull().default(0),
    total_cost_cents: integer('total_cost_cents').notNull().default(0),
    last_aggregated_at: timestamp('last_aggregated_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    orgIdIdx: index('campaign_stats_org_id_idx').on(t.org_id),
  }),
);

export type CampaignStats = typeof campaignStats.$inferSelect;
export type NewCampaignStats = typeof campaignStats.$inferInsert;

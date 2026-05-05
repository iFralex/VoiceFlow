import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { campaigns } from './campaigns';
import { contacts } from './contacts';
import { organizations } from './organizations';

export const callProviderEnum = pgEnum('call_provider', ['vapi', 'retell', 'proprietary']);

export const callStatusEnum = pgEnum('call_status', [
  'pending',
  'dialing',
  'in_progress',
  'completed',
  'failed',
  'no_answer',
  'voicemail',
  'busy',
]);

export const callOutcomeEnum = pgEnum('call_outcome', [
  'interested',
  'not_interested',
  'appointment_booked',
  'wrong_number',
  'callback_requested',
  'voicemail_left',
  'voicemail_no_message',
  'do_not_call',
]);

export const calls = pgTable(
  'calls',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    org_id: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    campaign_id: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    contact_id: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    provider: callProviderEnum('provider').notNull(),
    provider_call_id: text('provider_call_id'),
    status: callStatusEnum('status').notNull().default('pending'),
    outcome: callOutcomeEnum('outcome'),
    outcome_confidence: numeric('outcome_confidence', { precision: 3, scale: 2 }),
    billable_seconds: integer('billable_seconds'),
    cost_cents: integer('cost_cents'),
    recording_path: text('recording_path'),
    transcript_path: text('transcript_path'),
    transferred_to_agent: boolean('transferred_to_agent').notNull().default(false),
    metadata: jsonb('metadata'),
    error_code: text('error_code'),
    started_at: timestamp('started_at', { withTimezone: true }),
    ended_at: timestamp('ended_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('calls_org_campaign_status_idx').on(t.org_id, t.campaign_id, t.status),
    index('calls_org_contact_idx').on(t.org_id, t.contact_id),
    index('calls_provider_call_id_idx')
      .on(t.provider_call_id)
      .where(sql`${t.provider_call_id} IS NOT NULL`),
  ],
);

export type Call = typeof calls.$inferSelect;
export type NewCall = typeof calls.$inferInsert;

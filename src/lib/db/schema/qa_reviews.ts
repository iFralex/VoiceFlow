import { bigserial, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { calls } from './calls';

export const QA_REVIEW_STATUSES = ['pending_review', 'ok', 'needs_improvement'] as const;
export type QaReviewStatus = (typeof QA_REVIEW_STATUSES)[number];

export function isQaReviewStatus(val: unknown): val is QaReviewStatus {
  return QA_REVIEW_STATUSES.includes(val as QaReviewStatus);
}

export interface QaChecklist {
  disclosure_verified: boolean | null;
  transcript_readable: boolean | null;
  outcome_correct: boolean | null;
  no_offensive: boolean | null;
  no_privacy_leak: boolean | null;
}

// System-owned table — no RLS. Written by the /admin/quality page sampling
// logic and updated by the founder via the review form.
export const qaReviews = pgTable(
  'qa_reviews',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    call_id: uuid('call_id')
      .notNull()
      .references(() => calls.id, { onDelete: 'cascade' }),
    org_id: uuid('org_id').notNull(),
    campaign_id: uuid('campaign_id'),
    status: text('status').notNull().default('pending_review'),
    checklist: jsonb('checklist').$type<QaChecklist>(),
    note: text('note'),
    reviewed_at: timestamp('reviewed_at', { withTimezone: true }),
    reviewed_by: text('reviewed_by'),
    sampled_at: timestamp('sampled_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('qa_reviews_call_id_idx').on(t.call_id),
    index('qa_reviews_status_idx').on(t.status),
    index('qa_reviews_sampled_at_idx').on(t.sampled_at),
    index('qa_reviews_org_id_idx').on(t.org_id),
  ],
);

export type QaReview = typeof qaReviews.$inferSelect;
export type NewQaReview = typeof qaReviews.$inferInsert;

import { bigserial, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// System-owned table — no RLS. Written by the email adapter after each send attempt.
export const emailLog = pgTable(
  'email_log',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    to_address: text('to_address').notNull(),
    subject: text('subject').notNull(),
    resend_id: text('resend_id'),
    tags: jsonb('tags').$type<{ name: string; value: string }[]>(),
    sent_at: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    error: text('error'),
  },
  (t) => [index('email_log_sent_at_idx').on(t.sent_at)],
);

export type EmailLogEntry = typeof emailLog.$inferSelect;

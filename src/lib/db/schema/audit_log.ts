import { sql } from 'drizzle-orm';
import { bigserial, index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// System-owned table — no RLS. Queried via service role with explicit org filter.
export const actorTypeEnum = pgEnum('actor_type', ['user', 'system', 'webhook']);

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    org_id: uuid('org_id'),
    actor_user_id: uuid('actor_user_id'),
    actor_type: actorTypeEnum('actor_type').notNull(),
    action: text('action').notNull(),
    subject_type: text('subject_type').notNull(),
    subject_id: text('subject_id').notNull(),
    metadata: jsonb('metadata'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_org_created_at_idx').on(t.org_id, t.created_at),
    index('audit_log_action_idx').on(t.action).where(sql`${t.action} IN ('call.completed', 'payment.succeeded', 'contact.opted_out', 'member.invited', 'member.removed')`),
  ],
);

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;

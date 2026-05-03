import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { contactLists } from './contact_lists';
import { organizations } from './organizations';

export const consentBasisEnum = pgEnum('consent_basis', [
  'consent',
  'legitimate_interest',
  'existing_customer',
]);

export const contactTypeEnum = pgEnum('contact_type', ['b2c', 'b2b']);

export const rpoStatusEnum = pgEnum('rpo_status', ['clear', 'blocked', 'unchecked']);

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    org_id: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    contact_list_id: uuid('contact_list_id')
      .notNull()
      .references(() => contactLists.id, { onDelete: 'cascade' }),
    phone_e164: text('phone_e164').notNull(),
    first_name: text('first_name'),
    last_name: text('last_name'),
    email: text('email'),
    consent_basis: consentBasisEnum('consent_basis').notNull(),
    consent_evidence: text('consent_evidence'),
    contact_type: contactTypeEnum('contact_type').notNull().default('b2c'),
    rpo_status: rpoStatusEnum('rpo_status').notNull().default('unchecked'),
    rpo_checked_at: timestamp('rpo_checked_at', { withTimezone: true }),
    opt_out: boolean('opt_out').notNull().default(false),
    opt_out_reason: text('opt_out_reason'),
    metadata: jsonb('metadata'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('contacts_org_phone_unique_idx')
      .on(t.org_id, t.phone_e164)
      .where(sql`${t.deleted_at} IS NULL`),
    index('contacts_contact_list_id_idx').on(t.contact_list_id),
    index('contacts_org_opt_out_rpo_idx').on(t.org_id, t.opt_out, t.rpo_status),
  ],
);

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;

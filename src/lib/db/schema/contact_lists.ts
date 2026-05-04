import { sql } from 'drizzle-orm';
import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { organizations } from './organizations';

export const listSourceEnum = pgEnum('list_source', ['csv-upload', 'zapier', 'api']);
export const importStatusEnum = pgEnum('import_status', [
  'pending',
  'parsing',
  'completed',
  'failed',
]);

export const contactLists = pgTable(
  'contact_lists',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    org_id: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    source: listSourceEnum('source').notNull(),
    source_file_path: text('source_file_path'),
    total_count: integer('total_count').notNull().default(0),
    valid_count: integer('valid_count').notNull().default(0),
    import_status: importStatusEnum('import_status').notNull().default('pending'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('contact_lists_org_id_idx').on(t.org_id),
  ],
);

export type ContactList = typeof contactLists.$inferSelect;
export type NewContactList = typeof contactLists.$inferInsert;

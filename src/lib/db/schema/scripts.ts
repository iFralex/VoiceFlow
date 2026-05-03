import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { organizations } from './organizations';
import { scriptTemplates } from './script_templates';

export const scripts = pgTable(
  'scripts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    org_id: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    template_id: uuid('template_id')
      .notNull()
      .references(() => scriptTemplates.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    variables: jsonb('variables').notNull().default(sql`'{}'::jsonb`),
    voice_id: text('voice_id'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('scripts_org_id_idx').on(t.org_id),
  ],
);

export type Script = typeof scripts.$inferSelect;
export type NewScript = typeof scripts.$inferInsert;

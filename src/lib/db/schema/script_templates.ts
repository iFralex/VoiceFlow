import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const scriptTemplates = pgTable(
  'script_templates',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    version: integer('version').notNull().default(1),
    system_prompt: text('system_prompt').notNull(),
    variable_schema: jsonb('variable_schema').notNull().default(sql`'{}'::jsonb`),
    default_voice_id: text('default_voice_id'),
    default_language: text('default_language').notNull().default('it-IT'),
    published_at: timestamp('published_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('script_templates_slug_version_unique').on(t.slug, t.version),
    index('script_templates_slug_idx').on(t.slug),
  ],
);

export type ScriptTemplate = typeof scriptTemplates.$inferSelect;
export type NewScriptTemplate = typeof scriptTemplates.$inferInsert;

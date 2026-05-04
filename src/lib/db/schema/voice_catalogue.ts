import { sql } from 'drizzle-orm';
import { boolean, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { callProviderEnum } from './calls';

export const voiceCatalogue = pgTable(
  'voice_catalogue',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    provider: callProviderEnum('provider').notNull(),
    external_voice_id: text('external_voice_id').notNull(),
    display_name: text('display_name').notNull(),
    language: text('language').notNull().default('it-IT'),
    gender: text('gender'),
    style: text('style'),
    sample_url: text('sample_url'),
    active: boolean('active').notNull().default(true),
    default_for_templates: text('default_for_templates')
      .array()
      .notNull()
      .default(sql`'{}'`),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('voice_catalogue_external_voice_id_provider_unique').on(
      t.external_voice_id,
      t.provider,
    ),
  ],
);

export type VoiceCatalogueEntry = typeof voiceCatalogue.$inferSelect;
export type NewVoiceCatalogueEntry = typeof voiceCatalogue.$inferInsert;

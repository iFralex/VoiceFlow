import { sql } from 'drizzle-orm';

import { creditPackageSeedData } from './credit_packages';
import {
  buildScriptTemplateSeedData,
  scriptTemplateSeedData,
  TEMPLATE_DEFINITIONS,
} from './script_templates';
import { withSystemContext } from '../context';
import { creditPackages } from '../schema/credit_packages';
import { scriptTemplates } from '../schema/script_templates';

export async function seedScriptTemplates(): Promise<void> {
  await withSystemContext(async (tx) => {
    await tx
      .insert(scriptTemplates)
      .values(scriptTemplateSeedData)
      .onConflictDoUpdate({
        target: [scriptTemplates.slug, scriptTemplates.version],
        set: {
          name: sql`excluded.name`,
          system_prompt: sql`excluded.system_prompt`,
          variable_schema: sql`excluded.variable_schema`,
          default_voice_id: sql`excluded.default_voice_id`,
          default_language: sql`excluded.default_language`,
          published_at: sql`excluded.published_at`,
        },
      });
  });
}

/**
 * Bumps a single template to the next version (base version + 1) and upserts
 * it into the database, leaving the old version row intact.
 *
 * This is useful when iteratively authoring a template: edit the .txt file,
 * then run `pnpm db:seed --bump <slug>` to publish the new version without
 * breaking existing scripts that reference the previous version.
 */
export async function bumpScriptTemplate(slug: string): Promise<void> {
  const def = TEMPLATE_DEFINITIONS.find((d) => d.slug === slug);
  if (!def) {
    throw new Error(
      `Unknown template slug "${slug}". Valid slugs: ${TEMPLATE_DEFINITIONS.map((d) => d.slug).join(', ')}`,
    );
  }

  const bumpedVersion = def.version + 1;
  const rows = buildScriptTemplateSeedData({ [slug]: bumpedVersion });
  const row = rows.find((r) => r.slug === slug);
  if (!row) throw new Error(`Failed to build bumped row for slug "${slug}"`);

  await withSystemContext(async (tx) => {
    await tx
      .insert(scriptTemplates)
      .values([row])
      .onConflictDoUpdate({
        target: [scriptTemplates.slug, scriptTemplates.version],
        set: {
          name: sql`excluded.name`,
          system_prompt: sql`excluded.system_prompt`,
          variable_schema: sql`excluded.variable_schema`,
          default_voice_id: sql`excluded.default_voice_id`,
          default_language: sql`excluded.default_language`,
          published_at: sql`excluded.published_at`,
        },
      });
  });
}

export async function seedCreditPackages(): Promise<void> {
  await withSystemContext(async (tx) => {
    await tx
      .insert(creditPackages)
      .values(creditPackageSeedData)
      .onConflictDoUpdate({
        target: creditPackages.slug,
        set: {
          display_name: sql`excluded.display_name`,
          price_cents: sql`excluded.price_cents`,
          included_minutes: sql`excluded.included_minutes`,
          stripe_price_id: sql`excluded.stripe_price_id`,
          active: sql`excluded.active`,
        },
      });
  });
}

export async function seed(): Promise<void> {
  console.warn('Seeding script templates...');
  await seedScriptTemplates();
  console.warn(`  ✓ ${scriptTemplateSeedData.length} script templates upserted`);

  console.warn('Seeding credit packages...');
  await seedCreditPackages();
  console.warn(`  ✓ ${creditPackageSeedData.length} credit packages upserted`);

  console.warn('Seed complete.');
}

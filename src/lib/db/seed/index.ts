import { eq, max, sql } from 'drizzle-orm';

import { creditPackageSeedData } from './credit_packages';
import { phoneNumberSeedData } from './phone_numbers';
import {
  buildScriptTemplateSeedData,
  scriptTemplateSeedData,
  TEMPLATE_DEFINITIONS,
} from './script_templates';
import { voiceCatalogueSeedData } from './voice_catalogue';
import { withSystemContext } from '../context';
import { creditPackages } from '../schema/credit_packages';
import { phoneNumbers } from '../schema/phone_numbers';
import { scriptTemplates } from '../schema/script_templates';
import { voiceCatalogue } from '../schema/voice_catalogue';

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

  // Query the current max version from the database so repeated --bump calls
  // always insert the next version rather than overwriting a previously bumped row.
  const bumpedVersion = await withSystemContext(async (tx) => {
    const rows = await tx
      .select({ maxVersion: max(scriptTemplates.version) })
      .from(scriptTemplates)
      .where(eq(scriptTemplates.slug, slug));
    const maxVersion = rows[0]?.maxVersion;
    return (maxVersion ?? def.version) + 1;
  });
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

export async function seedVoiceCatalogue(): Promise<void> {
  await withSystemContext(async (tx) => {
    await tx
      .insert(voiceCatalogue)
      .values(voiceCatalogueSeedData)
      .onConflictDoUpdate({
        target: [voiceCatalogue.external_voice_id, voiceCatalogue.provider],
        set: {
          display_name: sql`excluded.display_name`,
          language: sql`excluded.language`,
          gender: sql`excluded.gender`,
          style: sql`excluded.style`,
          sample_url: sql`excluded.sample_url`,
          active: sql`excluded.active`,
          default_for_templates: sql`excluded.default_for_templates`,
        },
      });
  });
}

/**
 * Seed the shared CLI pool. Upserts the placeholder DIDs from
 * `phone_numbers.ts`, refreshing only the metadata fields the founder is
 * expected to update post-procurement (`provider`, `provider_external_id`,
 * `region`, `capabilities`). Live usage state (`status`, `daily_call_count`,
 * `spam_score`, `last_used_at`) is left untouched on conflict so re-running
 * the seed never resets a number that the watchdog has cooled down.
 */
export async function seedPhoneNumbers(): Promise<void> {
  await withSystemContext(async (tx) => {
    await tx
      .insert(phoneNumbers)
      .values(phoneNumberSeedData)
      .onConflictDoUpdate({
        target: phoneNumbers.e164,
        set: {
          provider: sql`excluded.provider`,
          provider_external_id: sql`excluded.provider_external_id`,
          region: sql`excluded.region`,
          capabilities: sql`excluded.capabilities`,
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

  console.warn('Seeding voice catalogue...');
  await seedVoiceCatalogue();
  console.warn(`  ✓ ${voiceCatalogueSeedData.length} voice catalogue entries upserted`);

  console.warn('Seeding phone numbers (CLI pool)...');
  await seedPhoneNumbers();
  console.warn(`  ✓ ${phoneNumberSeedData.length} phone numbers upserted`);

  console.warn('Seed complete.');
}

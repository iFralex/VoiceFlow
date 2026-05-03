import { db } from '../client';
import { creditPackageSeedData } from './credit_packages';
import { scriptTemplateSeedData } from './script_templates';
import { creditPackages } from '../schema/credit_packages';
import { scriptTemplates } from '../schema/script_templates';

export async function seedScriptTemplates(): Promise<void> {
  await db
    .insert(scriptTemplates)
    .values(scriptTemplateSeedData)
    .onConflictDoUpdate({
      target: [scriptTemplates.slug, scriptTemplates.version],
      set: {
        name: scriptTemplates.name,
        system_prompt: scriptTemplates.system_prompt,
        variable_schema: scriptTemplates.variable_schema,
        default_voice_id: scriptTemplates.default_voice_id,
        default_language: scriptTemplates.default_language,
        published_at: scriptTemplates.published_at,
      },
    });
}

export async function seedCreditPackages(): Promise<void> {
  await db
    .insert(creditPackages)
    .values(creditPackageSeedData)
    .onConflictDoUpdate({
      target: creditPackages.slug,
      set: {
        display_name: creditPackages.display_name,
        price_cents: creditPackages.price_cents,
        included_minutes: creditPackages.included_minutes,
        active: creditPackages.active,
      },
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

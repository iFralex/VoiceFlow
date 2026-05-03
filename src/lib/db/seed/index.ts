import { sql } from 'drizzle-orm';

import { creditPackageSeedData } from './credit_packages';
import { scriptTemplateSeedData } from './script_templates';
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

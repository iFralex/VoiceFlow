import { desc, eq } from 'drizzle-orm';

import { getAuthContext } from '@/lib/auth/context';
import { dbForRequest } from '@/lib/db/client';
import { scripts, scriptTemplates } from '@/lib/db/schema';
import { TEMPLATE_DEFINITIONS } from '@/lib/db/seed/script_templates';
import { t as serverT } from '@/i18n/server';

import type { SerializedScript, TemplateCard } from './_components/scripts-page-client';
import { ScriptsPageClient } from './_components/scripts-page-client';

export default async function ScriptsPage() {
  const { orgId } = await getAuthContext();
  const { withOrgContext } = await dbForRequest();
  const tScripts = await serverT('scripts');

  const rows = await withOrgContext(async (tx) => {
    return tx
      .select({
        id: scripts.id,
        name: scripts.name,
        template_slug: scriptTemplates.slug,
        template_name: scriptTemplates.name,
        updated_at: scripts.updated_at,
      })
      .from(scripts)
      .innerJoin(scriptTemplates, eq(scripts.template_id, scriptTemplates.id))
      .where(eq(scripts.org_id, orgId))
      .orderBy(desc(scripts.updated_at));
  });

  const templateCards: TemplateCard[] = TEMPLATE_DEFINITIONS.map((def) => {
    const schema = def.variableSchema as { required?: string[] };
    const descKey =
      `template_${def.slug.replace(/-/g, '_')}_desc` as Parameters<typeof tScripts>[0];
    return {
      slug: def.slug,
      name: def.name,
      description: tScripts(descKey),
      requiredFields: schema.required ?? [],
    };
  });

  const orgScripts: SerializedScript[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    template_slug: r.template_slug,
    template_name: r.template_name,
    updated_at: r.updated_at.toISOString(),
  }));

  return <ScriptsPageClient templateCards={templateCards} scripts={orgScripts} />;
}

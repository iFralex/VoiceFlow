import * as fs from 'node:fs';
import * as path from 'node:path';

import { and, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';

import { getAuthContext } from '@/lib/auth/context';
import { dbForRequest } from '@/lib/db/client';
import { scripts, scriptTemplates } from '@/lib/db/schema';
import { TEMPLATE_DEFINITIONS } from '@/lib/db/seed/script_templates';
import { env } from '@/lib/env';
import {
  AI_ACT_PREAMBLE_IT,
  OUTCOME_CLASSIFICATION_INSTRUCTIONS_IT,
} from '@/lib/voice/prompt/preamble';

import type { SerializedScriptDetail } from './_components/script-detail-client';
import { ScriptDetailClient } from './_components/script-detail-client';
import type { TemplateInfo } from '../new/_components/new-script-wizard';

const PROMPTS_DIR = path.join(process.cwd(), 'src', 'lib', 'voice', 'templates', 'prompts');

function readPromptFile(filename: string): string {
  try {
    return fs.readFileSync(path.join(PROMPTS_DIR, filename), 'utf-8').trim();
  } catch {
    return '';
  }
}

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ScriptDetailPage({ params }: PageProps) {
  const { id } = await params;
  const { orgId } = await getAuthContext();
  const { withOrgContext } = await dbForRequest();

  const rows = await withOrgContext(async (tx) => {
    return tx
      .select({ script: scripts, template: scriptTemplates })
      .from(scripts)
      .innerJoin(scriptTemplates, eq(scripts.template_id, scriptTemplates.id))
      .where(and(eq(scripts.id, id), eq(scripts.org_id, orgId)));
  });

  const row = rows[0];
  if (!row) notFound();

  const scriptDetail: SerializedScriptDetail = {
    id: row.script.id,
    name: row.script.name,
    variables: row.script.variables as Record<string, unknown>,
    voice_id: row.script.voice_id,
    template_slug: row.template.slug,
    template_name: row.template.name,
    updated_at: row.script.updated_at.toISOString(),
  };

  const templateDef = TEMPLATE_DEFINITIONS.find((d) => d.slug === row.template.slug);

  const templateInfo: TemplateInfo | null = templateDef
    ? {
        slug: templateDef.slug,
        name: templateDef.name,
        description: '',
        schema: templateDef.variableSchema as TemplateInfo['schema'],
        systemPromptBody: readPromptFile(templateDef.promptFile),
        firstMessageBody: readPromptFile(templateDef.firstMessageFile),
      }
    : null;

  return (
    <ScriptDetailClient
      script={scriptDetail}
      templateInfo={templateInfo}
      preamble={AI_ACT_PREAMBLE_IT}
      outcomeInstructions={OUTCOME_CLASSIFICATION_INSTRUCTIONS_IT}
      elevenLabsConfigured={!!env.ELEVENLABS_API_KEY}
    />
  );
}

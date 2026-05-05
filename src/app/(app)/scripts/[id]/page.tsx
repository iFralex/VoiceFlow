import * as fs from 'node:fs';
import * as path from 'node:path';

import { notFound } from 'next/navigation';

import { getAuthContext } from '@/lib/auth/context';
import { TEMPLATE_DEFINITIONS } from '@/lib/db/seed/script_templates';
import { env } from '@/lib/env';
import { getScript } from '@/lib/services/scripts';
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

  const row = await getScript(orgId, id);
  if (!row) notFound();

  const scriptDetail: SerializedScriptDetail = {
    id: row.id,
    name: row.name,
    variables: row.variables as Record<string, unknown>,
    voice_id: row.voice_id,
    template_slug: row.template.slug,
    template_name: row.template.name,
    updated_at: row.updated_at.toISOString(),
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

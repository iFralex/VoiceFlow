import * as fs from 'node:fs';
import * as path from 'node:path';

import { t as serverT } from '@/i18n/server';
import { TEMPLATE_DEFINITIONS } from '@/lib/db/seed/script_templates';
import {
  AI_ACT_PREAMBLE_IT,
  OUTCOME_CLASSIFICATION_INSTRUCTIONS_IT,
} from '@/lib/voice/prompt/preamble';

import type { TemplateInfo, TemplateJsonSchema } from './_components/new-script-wizard';
import { NewScriptWizard } from './_components/new-script-wizard';

const PROMPTS_DIR = path.join(process.cwd(), 'src', 'lib', 'voice', 'templates', 'prompts');

function readPromptFile(filename: string): string {
  try {
    return fs.readFileSync(path.join(PROMPTS_DIR, filename), 'utf-8').trim();
  } catch {
    return '';
  }
}

type PageProps = {
  searchParams: Promise<{ template?: string }>;
};

export default async function NewScriptPage({ searchParams }: PageProps) {
  const { template: templateParam } = await searchParams;
  const tScripts = await serverT('scripts');

  const templates: TemplateInfo[] = TEMPLATE_DEFINITIONS.map((def) => {
    const descKey =
      `template_${def.slug.replace(/-/g, '_')}_desc` as Parameters<typeof tScripts>[0];

    return {
      slug: def.slug,
      name: def.name,
      description: tScripts(descKey),
      schema: def.variableSchema as unknown as TemplateJsonSchema,
      systemPromptBody: readPromptFile(def.promptFile),
      firstMessageBody: readPromptFile(def.firstMessageFile),
    };
  });

  const validTemplate = templates.find((tpl) => tpl.slug === templateParam);

  return (
    <NewScriptWizard
      templates={templates}
      initialTemplateSlug={validTemplate?.slug}
      preamble={AI_ACT_PREAMBLE_IT}
      outcomeInstructions={OUTCOME_CLASSIFICATION_INSTRUCTIONS_IT}
    />
  );
}

import * as fs from 'node:fs';
import * as path from 'node:path';

import { appointmentConfirmJsonSchema } from '@/lib/voice/templates/schemas/appointment-confirm.schema';
import { carRenewalJsonSchema } from '@/lib/voice/templates/schemas/car-renewal.schema';
import { csiSurveyJsonSchema } from '@/lib/voice/templates/schemas/csi-survey.schema';
import { leadReactivationJsonSchema } from '@/lib/voice/templates/schemas/lead-reactivation.schema';
import { postSaleFollowupJsonSchema } from '@/lib/voice/templates/schemas/post-sale-followup.schema';

import { NewScriptTemplate } from '../schema/script_templates';
import {
  CHIARA_VOICE_ID,
  GIULIA_VOICE_ID,
  MARCO_VOICE_ID,
  SOFIA_VOICE_ID,
} from './voice_catalogue';

// process.cwd() resolves to the project root in both tsx CLI runs and Next.js
// production builds, unlike __dirname which points inside .next/server/chunks/.
const PROMPTS_DIR = path.join(process.cwd(), 'src', 'lib', 'voice', 'templates', 'prompts');

function readPromptFile(filename: string): string {
  const fullPath = path.join(PROMPTS_DIR, filename);
  return fs.readFileSync(fullPath, 'utf-8').trim();
}

// ---------------------------------------------------------------------------
// Template definitions — metadata + file references
// ---------------------------------------------------------------------------

export interface TemplateDef {
  slug: string;
  name: string;
  /** Base version used when no override is supplied. */
  version: number;
  promptFile: string;
  firstMessageFile: string;
  variableSchema: unknown;
  defaultVoiceId: string;
}

export const TEMPLATE_DEFINITIONS: TemplateDef[] = [
  {
    slug: 'lead-reactivation',
    name: 'Riattivazione Lead',
    version: 1,
    promptFile: 'lead-reactivation.txt',
    firstMessageFile: 'lead-reactivation-first-message.txt',
    variableSchema: leadReactivationJsonSchema,
    defaultVoiceId: GIULIA_VOICE_ID,
  },
  {
    slug: 'appointment-confirm',
    name: 'Conferma Appuntamento',
    version: 1,
    promptFile: 'appointment-confirm.txt',
    firstMessageFile: 'appointment-confirm-first-message.txt',
    variableSchema: appointmentConfirmJsonSchema,
    defaultVoiceId: GIULIA_VOICE_ID,
  },
  {
    slug: 'car-renewal',
    name: 'Rinnovo Auto Programmato',
    version: 1,
    promptFile: 'car-renewal.txt',
    firstMessageFile: 'car-renewal-first-message.txt',
    variableSchema: carRenewalJsonSchema,
    defaultVoiceId: MARCO_VOICE_ID,
  },
  {
    slug: 'post-sale-followup',
    name: 'Follow-up Post Vendita',
    version: 1,
    promptFile: 'post-sale-followup.txt',
    firstMessageFile: 'post-sale-followup-first-message.txt',
    variableSchema: postSaleFollowupJsonSchema,
    defaultVoiceId: SOFIA_VOICE_ID,
  },
  {
    slug: 'csi-survey',
    name: 'Questionario CSI',
    version: 1,
    promptFile: 'csi-survey.txt',
    firstMessageFile: 'csi-survey-first-message.txt',
    variableSchema: csiSurveyJsonSchema,
    defaultVoiceId: CHIARA_VOICE_ID,
  },
];

// ---------------------------------------------------------------------------
// Builder — reads all three components from disk at call time
// ---------------------------------------------------------------------------

/**
 * Builds the array of NewScriptTemplate rows to upsert.
 *
 * @param versionOverrides - Map of slug → version to use instead of the
 *   definition's base version (used by --bump to insert a bumped version).
 */
export function buildScriptTemplateSeedData(
  versionOverrides: Record<string, number> = {},
): NewScriptTemplate[] {
  return TEMPLATE_DEFINITIONS.map((def) => {
    const version = versionOverrides[def.slug] ?? def.version;

    // Read system prompt from disk (canonical authoritative source).
    const systemPrompt = readPromptFile(def.promptFile);

    // Read first-message file to validate it exists alongside the prompt.
    // The content is used at call-dispatch time by the voice adapter (plan 08);
    // it is not stored in the DB column but must be present on disk.
    readPromptFile(def.firstMessageFile);

    return {
      slug: def.slug,
      name: def.name,
      version,
      system_prompt: systemPrompt,
      variable_schema: def.variableSchema,
      default_voice_id: def.defaultVoiceId,
      default_language: 'it-IT' as const,
      published_at: new Date(),
    };
  });
}

// ---------------------------------------------------------------------------
// Default export — base versions, read at module load time
// ---------------------------------------------------------------------------

export const scriptTemplateSeedData: NewScriptTemplate[] = buildScriptTemplateSeedData();

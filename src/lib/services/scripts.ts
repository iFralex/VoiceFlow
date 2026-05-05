import * as fs from 'node:fs';
import * as path from 'node:path';

import { and, desc, eq, inArray, not } from 'drizzle-orm';

import { recordAudit } from '@/lib/db/audit';
import { withOrgContext } from '@/lib/db/context';
import { campaigns, scripts, scriptTemplates } from '@/lib/db/schema';
import type { Script, ScriptTemplate } from '@/lib/db/schema';
import { TEMPLATE_DEFINITIONS } from '@/lib/db/seed/script_templates';
import {
  assembleSystemPrompt,
  interpolate,
  verifyComplianceOrThrow,
} from '@/lib/voice/prompt/preamble';
import { TEMPLATE_SCHEMAS } from '@/lib/voice/templates/schemas';
import type { TemplateSlug } from '@/lib/voice/templates/schemas';

// Prompts directory resolved relative to project root, compatible with Next.js
// production builds where __dirname points inside .next/server/chunks/.
const PROMPTS_DIR = path.join(process.cwd(), 'src', 'lib', 'voice', 'templates', 'prompts');

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Thrown by deleteScript when the script is still referenced by one or more
 * non-completed campaigns. The caller surfaces this to the UI.
 */
export class ScriptReferencedByCampaignError extends Error {
  readonly campaignIds: string[];

  constructor(campaignIds: string[]) {
    super(
      `Cannot delete script: referenced by ${campaignIds.length} active campaign(s). Complete or cancel those campaigns first.`,
    );
    this.name = 'ScriptReferencedByCampaignError';
    this.campaignIds = campaignIds;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Coerces a stored JSONB variable map (which may contain arrays and numbers
 * from the Zod schema) into the `Record<string, string>` format expected by
 * `interpolate`. Arrays are joined with ", "; all other types are stringified.
 */
function coerceVariablesToStrings(
  variables: Record<string, unknown>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(variables)) {
    if (Array.isArray(value)) {
      result[key] = value.map((v) => String(v)).join(', ');
    } else {
      result[key] = String(value ?? '');
    }
  }
  return result;
}

/**
 * Ensures every property declared in the template's JSON Schema has an entry
 * in `vars`, inserting an empty string for any key that is absent (i.e.
 * optional fields the user did not supply). This prevents `interpolate` from
 * throwing "Missing variable" for optional placeholders used in the prompt.
 */
function fillMissingSchemaFields(
  vars: Record<string, string>,
  schema: unknown,
): Record<string, string> {
  const props =
    (schema as { properties?: Record<string, unknown> } | null)?.properties ?? {};
  const result = { ...vars };
  for (const key of Object.keys(props)) {
    if (!(key in result)) {
      result[key] = '';
    }
  }
  return result;
}

/**
 * Validates `variables` against the Zod schema bound to `templateSlug`.
 * Throws with a human-readable message if validation fails.
 * Unknown slugs (no matching schema) are passed through without validation.
 */
async function validateVariables(
  templateSlug: string,
  variables: Record<string, unknown>,
): Promise<void> {
  if (!(templateSlug in TEMPLATE_SCHEMAS)) return;

  const slug = templateSlug as TemplateSlug;
  const zodSchema = await TEMPLATE_SCHEMAS[slug].zod();
  const result = zodSchema.safeParse(variables);
  if (!result.success) {
    const messages = result.error.issues
      .map((e) => `${e.path.map(String).join('.') || 'root'}: ${e.message}`)
      .join('; ');
    throw new Error(`Variable validation failed: ${messages}`);
  }
}

/**
 * Reads the first-message template file for a given template slug.
 * Returns the raw (un-interpolated) content.
 */
function readFirstMessageTemplate(templateSlug: string): string {
  const def = TEMPLATE_DEFINITIONS.find((d) => d.slug === templateSlug);
  if (!def) {
    throw new Error(`Unknown template slug: ${templateSlug}`);
  }
  const filePath = path.join(PROMPTS_DIR, def.firstMessageFile);
  return fs.readFileSync(filePath, 'utf-8').trim();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function listScripts(orgId: string): Promise<Script[]> {
  return withOrgContext(orgId, async (tx) => {
    return tx
      .select()
      .from(scripts)
      .where(eq(scripts.org_id, orgId))
      .orderBy(desc(scripts.created_at));
  });
}

export async function getScript(
  orgId: string,
  scriptId: string,
): Promise<(Script & { template: ScriptTemplate }) | null> {
  return withOrgContext(orgId, async (tx) => {
    const rows = await tx
      .select({ script: scripts, template: scriptTemplates })
      .from(scripts)
      .innerJoin(scriptTemplates, eq(scripts.template_id, scriptTemplates.id))
      .where(and(eq(scripts.id, scriptId), eq(scripts.org_id, orgId)));

    const row = rows[0];
    if (!row) return null;

    return { ...row.script, template: row.template };
  });
}

export async function createScript(
  orgId: string,
  byUserId: string,
  input: {
    templateSlug: string;
    templateVersion?: number;
    name: string;
    variables: Record<string, unknown>;
    voiceIdOverride?: string;
  },
): Promise<Script> {
  await validateVariables(input.templateSlug, input.variables);

  return withOrgContext(orgId, async (tx) => {
    // Resolve the template — latest published by slug, or a specific version.
    const baseConditions = [eq(scriptTemplates.slug, input.templateSlug)];
    if (input.templateVersion !== undefined) {
      baseConditions.push(eq(scriptTemplates.version, input.templateVersion));
    }

    const templateRows = await tx
      .select()
      .from(scriptTemplates)
      .where(and(...baseConditions))
      .orderBy(desc(scriptTemplates.version))
      .limit(1);

    const template = templateRows[0];
    if (!template) {
      throw new Error(
        `Template not found: slug="${input.templateSlug}"${input.templateVersion !== undefined ? `, version=${input.templateVersion}` : ''}`,
      );
    }

    // Compliance check: verify AI Act preamble and first-message disclosure.
    // Fill in empty strings for optional fields absent from user input so that
    // interpolate does not throw "Missing variable" for optional placeholders.
    const stringVarsForCheck = fillMissingSchemaFields(
      coerceVariablesToStrings(input.variables as Record<string, unknown>),
      template.variable_schema,
    );
    const assembledPrompt = assembleSystemPrompt({
      templateBody: template.system_prompt,
      variables: stringVarsForCheck,
    });
    const firstMsgTpl = readFirstMessageTemplate(input.templateSlug);
    const firstMsg = interpolate(firstMsgTpl, stringVarsForCheck);
    verifyComplianceOrThrow(assembledPrompt, firstMsg);

    const [created] = await tx
      .insert(scripts)
      .values({
        org_id: orgId,
        template_id: template.id,
        name: input.name,
        variables: input.variables,
        voice_id: input.voiceIdOverride ?? null,
      })
      .returning();

    await recordAudit(tx, {
      orgId,
      actorUserId: byUserId,
      actorType: 'user',
      action: 'script.created',
      subjectType: 'script',
      subjectId: created!.id,
      metadata: { name: input.name, template_slug: input.templateSlug },
    });

    return created!;
  });
}

export async function updateScript(
  orgId: string,
  byUserId: string,
  scriptId: string,
  patch: Partial<Pick<Script, 'name' | 'variables' | 'voice_id'>>,
): Promise<Script> {
  // If variables are being patched, validate against the template's schema
  // and verify compliance (preamble + first-message disclosure).
  if (patch.variables !== undefined) {
    // We need the template slug to validate; load the script first outside
    // the write transaction to keep validation separate from mutation.
    const existing = await getScript(orgId, scriptId);
    if (!existing) throw new Error('script_not_found');
    await validateVariables(
      existing.template.slug,
      patch.variables as Record<string, unknown>,
    );

    // Compliance check: verify AI Act preamble and first-message disclosure.
    // Fill in empty strings for optional fields absent from user input so that
    // interpolate does not throw "Missing variable" for optional placeholders.
    const stringVarsForCheck = fillMissingSchemaFields(
      coerceVariablesToStrings(patch.variables as Record<string, unknown>),
      existing.template.variable_schema,
    );
    const assembledPrompt = assembleSystemPrompt({
      templateBody: existing.template.system_prompt,
      variables: stringVarsForCheck,
    });
    const firstMsgTpl = readFirstMessageTemplate(existing.template.slug);
    const firstMsg = interpolate(firstMsgTpl, stringVarsForCheck);
    verifyComplianceOrThrow(assembledPrompt, firstMsg);
  }

  return withOrgContext(orgId, async (tx) => {
    const [updated] = await tx
      .update(scripts)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.variables !== undefined ? { variables: patch.variables } : {}),
        ...(patch.voice_id !== undefined ? { voice_id: patch.voice_id } : {}),
        updated_at: new Date(),
      })
      .where(and(eq(scripts.id, scriptId), eq(scripts.org_id, orgId)))
      .returning();

    if (!updated) throw new Error('script_not_found');

    await recordAudit(tx, {
      orgId,
      actorUserId: byUserId,
      actorType: 'user',
      action: 'script.updated',
      subjectType: 'script',
      subjectId: scriptId,
      metadata: { fields: Object.keys(patch) },
    });

    return updated;
  });
}

export async function deleteScript(
  orgId: string,
  byUserId: string,
  scriptId: string,
): Promise<void> {
  await withOrgContext(orgId, async (tx) => {
    // Block deletion if any non-terminal campaign still references this script.
    const activeCampaigns = await tx
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(
        and(
          eq(campaigns.org_id, orgId),
          eq(campaigns.script_id, scriptId),
          not(inArray(campaigns.status, ['completed', 'cancelled'])),
        ),
      );

    if (activeCampaigns.length > 0) {
      throw new ScriptReferencedByCampaignError(activeCampaigns.map((c) => c.id));
    }

    const [deleted] = await tx
      .delete(scripts)
      .where(and(eq(scripts.id, scriptId), eq(scripts.org_id, orgId)))
      .returning({ id: scripts.id });

    if (!deleted) throw new Error('script_not_found');

    await recordAudit(tx, {
      orgId,
      actorUserId: byUserId,
      actorType: 'user',
      action: 'script.deleted',
      subjectType: 'script',
      subjectId: scriptId,
    });
  });
}

export async function previewSystemPrompt(
  orgId: string,
  scriptId: string,
): Promise<{ systemPrompt: string; firstMessage: string }> {
  const script = await getScript(orgId, scriptId);
  if (!script) throw new Error('script_not_found');

  const stringVars = fillMissingSchemaFields(
    coerceVariablesToStrings(script.variables as Record<string, unknown>),
    script.template.variable_schema,
  );

  const systemPrompt = assembleSystemPrompt({
    templateBody: script.template.system_prompt,
    variables: stringVars,
  });

  const firstMessageTemplate = readFirstMessageTemplate(script.template.slug);
  const firstMessage = interpolate(firstMessageTemplate, stringVars);

  return { systemPrompt, firstMessage };
}

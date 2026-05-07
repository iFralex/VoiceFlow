/**
 * AI Act three-layer conformance audit (plan 11 task 7).
 *
 * Samples completed outbound calls from a time window and verifies each layer
 * of the AI Act transparency requirements (spec §12.3):
 *   - Layer 1: the assembled system prompt begins with the canonical preamble
 *   - Layer 2: the first message contains "assistente vocale automatico"
 *   - Layer 3: the transcript first 30s contains the same phrase (already
 *     verified per call by plan 08's classifier; we just aggregate the flag
 *     from `calls.metadata.disclosure_verified`).
 *
 * Layers 1 and 2 are reconstructed from the (call → campaign → script →
 * script_template) chain — there is no canonical "snapshot of the assembled
 * prompt" stored alongside the call, but the dispatcher's assembleSystemPrompt
 * is deterministic from those inputs, so a fresh re-derivation has the same
 * regulatory force.
 *
 * Output is meant to be persisted in `audit_log` with action
 * `compliance.aiact_audit_completed`; the founder dashboard (plan 14) reads
 * those rows to surface the monthly conformance numbers.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { and, eq, gte, lte, sql } from 'drizzle-orm';

import { withSystemContext } from '@/lib/db/context';
import { calls, campaigns, scriptTemplates, scripts } from '@/lib/db/schema';
import { TEMPLATE_DEFINITIONS } from '@/lib/db/seed/script_templates';
import { DISCLOSURE_PHRASE } from '@/lib/voice/disclosure';
import {
  AI_ACT_PREAMBLE_IT,
  assembleSystemPrompt,
  interpolate,
} from '@/lib/voice/prompt/preamble';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_AUDIT_SAMPLE_SIZE = 500;
const PREAMBLE_PREFIX_LENGTH = 200;
const PROMPTS_DIR = path.join(process.cwd(), 'src', 'lib', 'voice', 'templates', 'prompts');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AiActAuditSample {
  callId: string;
  orgId: string;
  scriptId: string;
  templateSlug: string;
  layer1Passed: boolean;
  layer2Passed: boolean;
  /** `null` when no per-call disclosure flag is on the row yet (e.g. transcript
   *  not yet classified). Counted toward `layer3NotApplicable`, not `failed`. */
  layer3Passed: boolean | null;
  failureReasons: string[];
}

export interface AiActAuditResult {
  totalSampled: number;
  layer1Passed: number;
  layer2Passed: number;
  layer3Passed: number;
  layer3NotApplicable: number;
  windowStart: string;
  windowEnd: string;
  samples: AiActAuditSample[];
}

export interface AiActAuditOptions {
  windowStart: Date;
  windowEnd: Date;
  sampleSize?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SampleRow {
  callId: string;
  orgId: string;
  scriptId: string;
  scriptVariables: unknown;
  templateSlug: string;
  templateBody: string;
  templateSchema: unknown;
  callMetadata: unknown;
}

function readFirstMessageTemplate(templateSlug: string): string | null {
  const def = TEMPLATE_DEFINITIONS.find((d) => d.slug === templateSlug);
  if (!def) return null;
  try {
    const filePath = path.join(PROMPTS_DIR, def.firstMessageFile);
    return fs.readFileSync(filePath, 'utf-8').trim();
  } catch {
    return null;
  }
}

function coerceVars(
  vars: unknown,
  schema: unknown,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (vars && typeof vars === 'object') {
    for (const [key, value] of Object.entries(vars as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        result[key] = value.map((v) => String(v)).join(', ');
      } else {
        result[key] = String(value ?? '');
      }
    }
  }
  const props =
    (schema as { properties?: Record<string, unknown> } | null)?.properties ?? {};
  for (const key of Object.keys(props)) {
    if (!(key in result)) result[key] = '';
  }
  return result;
}

async function fetchSample(
  windowStart: Date,
  windowEnd: Date,
  sampleSize: number,
): Promise<SampleRow[]> {
  return withSystemContext(async (tx) => {
    return tx
      .select({
        callId: calls.id,
        orgId: calls.org_id,
        scriptId: scripts.id,
        scriptVariables: scripts.variables,
        templateSlug: scriptTemplates.slug,
        templateBody: scriptTemplates.system_prompt,
        templateSchema: scriptTemplates.variable_schema,
        callMetadata: calls.metadata,
      })
      .from(calls)
      .innerJoin(campaigns, eq(calls.campaign_id, campaigns.id))
      .innerJoin(scripts, eq(campaigns.script_id, scripts.id))
      .innerJoin(scriptTemplates, eq(scripts.template_id, scriptTemplates.id))
      .where(
        and(
          eq(calls.direction, 'outbound'),
          gte(calls.created_at, windowStart),
          lte(calls.created_at, windowEnd),
        ),
      )
      .orderBy(sql`random()`)
      .limit(sampleSize);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Runs the AI Act conformance audit over the provided time window.
 *
 * Returns aggregate counters plus per-call samples. Pure: no side effects on
 * the database; the cron route persists the result to `audit_log` separately.
 */
export async function runAiActConformanceAudit(
  opts: AiActAuditOptions,
): Promise<AiActAuditResult> {
  const sampleSize = opts.sampleSize ?? DEFAULT_AUDIT_SAMPLE_SIZE;
  const rows = await fetchSample(opts.windowStart, opts.windowEnd, sampleSize);

  const samples: AiActAuditSample[] = [];
  let layer1Passed = 0;
  let layer2Passed = 0;
  let layer3Passed = 0;
  let layer3NotApplicable = 0;

  const preamblePrefix = AI_ACT_PREAMBLE_IT.slice(0, PREAMBLE_PREFIX_LENGTH);

  for (const row of rows) {
    const failureReasons: string[] = [];
    const stringVars = coerceVars(row.scriptVariables, row.templateSchema);

    let l1 = false;
    try {
      const systemPrompt = assembleSystemPrompt({
        templateBody: row.templateBody,
        variables: stringVars,
      });
      l1 = systemPrompt.startsWith(preamblePrefix);
      if (!l1) failureReasons.push('layer1: preamble missing or altered');
    } catch (err) {
      failureReasons.push(
        `layer1: ${err instanceof Error ? err.message : 'reassembly failed'}`,
      );
    }

    let l2 = false;
    const firstMessageTemplate = readFirstMessageTemplate(row.templateSlug);
    if (firstMessageTemplate === null) {
      failureReasons.push(
        `layer2: first-message template missing for slug ${row.templateSlug}`,
      );
    } else {
      try {
        const firstMessage = interpolate(firstMessageTemplate, stringVars);
        l2 = firstMessage.toLowerCase().includes(DISCLOSURE_PHRASE);
        if (!l2) {
          failureReasons.push('layer2: first message lacks disclosure phrase');
        }
      } catch (err) {
        failureReasons.push(
          `layer2: ${err instanceof Error ? err.message : 'interpolation failed'}`,
        );
      }
    }

    let l3: boolean | null = null;
    const meta = (row.callMetadata as Record<string, unknown> | null) ?? null;
    const flag = meta?.['disclosure_verified'];
    if (typeof flag === 'boolean') {
      l3 = flag;
      if (!l3) {
        failureReasons.push('layer3: disclosure phrase absent in transcript first 30s');
      }
    }

    if (l1) layer1Passed++;
    if (l2) layer2Passed++;
    if (l3 === true) layer3Passed++;
    else if (l3 === null) layer3NotApplicable++;

    samples.push({
      callId: row.callId,
      orgId: row.orgId,
      scriptId: row.scriptId,
      templateSlug: row.templateSlug,
      layer1Passed: l1,
      layer2Passed: l2,
      layer3Passed: l3,
      failureReasons,
    });
  }

  return {
    totalSampled: rows.length,
    layer1Passed,
    layer2Passed,
    layer3Passed,
    layer3NotApplicable,
    windowStart: opts.windowStart.toISOString(),
    windowEnd: opts.windowEnd.toISOString(),
    samples,
  };
}

import * as fs from 'node:fs';
import * as path from 'node:path';

import { and, eq, inArray } from 'drizzle-orm';

import { recordAudit } from '@/lib/db/audit';
import { withOrgContext, withSystemContext } from '@/lib/db/context';
import type { Call, NewCall } from '@/lib/db/schema';
import {
  auditLog,
  calls,
  campaigns,
  contacts,
  phoneNumbers,
  scriptTemplates,
  scripts,
} from '@/lib/db/schema';
import { TEMPLATE_DEFINITIONS } from '@/lib/db/seed/script_templates';
import { env } from '@/lib/env';
import { sendInngestEvent } from '@/lib/inngest/client';
import { computeCallCost, computePerMinuteCents } from '@/lib/services/billing-rules';
import { chargeForCall } from '@/lib/services/credit';
import { getVoiceProvider } from '@/lib/voice/factory';
import { assembleSystemPrompt, interpolate } from '@/lib/voice/prompt/preamble';
import { TEMPLATE_TOOLS } from '@/lib/voice/templates/tools';
import { dispatchToolSideEffect } from '@/lib/voice/tools/handlers';
import type { ToolDefinition, TranscriptSegment } from '@/lib/voice/types';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Inngest event emitted when a call ends; triggers artifact persistence (Task 9). */
export const CALL_COMPLETED_EVENT = 'call/completed' as const;

/** Inngest event emitted to request outcome classification (Task 11). */
export const CALL_CLASSIFY_EVENT = 'call/classify' as const;

const PROMPTS_DIR = path.join(process.cwd(), 'src', 'lib', 'voice', 'templates', 'prompts');
const MAX_CALL_DURATION_SECONDS = 600;
const VOICEMAIL_MESSAGE_TEMPLATE_FILE = 'voicemail-message.txt';

// ─── Error types ─────────────────────────────────────────────────────────────

export class NoPhoneNumberAvailableError extends Error {
  constructor(orgId: string) {
    super(`No active phone number available for org ${orgId}`);
    this.name = 'NoPhoneNumberAvailableError';
  }
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface CallTimelineEvent {
  type: string;
  timestamp: Date;
  data: Record<string, unknown>;
}

export interface CallTimeline {
  call: Call;
  events: CallTimelineEvent[];
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function coerceToStringRecord(variables: Record<string, unknown>): Record<string, string> {
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

function fillMissingSchemaKeys(
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

function readFirstMessageTemplate(templateSlug: string): string {
  const def = TEMPLATE_DEFINITIONS.find((d) => d.slug === templateSlug);
  if (!def) throw new Error(`Unknown template slug: ${templateSlug}`);
  const filePath = path.join(PROMPTS_DIR, def.firstMessageFile);
  return fs.readFileSync(filePath, 'utf-8').trim();
}

function readVoicemailMessageTemplate(): string {
  const filePath = path.join(PROMPTS_DIR, VOICEMAIL_MESSAGE_TEMPLATE_FILE);
  return fs.readFileSync(filePath, 'utf-8').trim();
}

function mapEndedReasonToStatus(endedReason: string): Call['status'] {
  switch (endedReason.toLowerCase()) {
    case 'voicemail':
    case 'voicemail-detected':
      return 'voicemail';
    case 'no-answer':
    case 'customer-did-not-answer':
      return 'no_answer';
    case 'busy':
    case 'customer-busy':
      return 'busy';
    case 'pipeline-error':
    case 'error':
      return 'failed';
    default:
      return 'completed';
  }
}

// ─── Service functions ────────────────────────────────────────────────────────

/**
 * Inserts a new call record in the 'pending' state.
 */
export async function createPendingCall(orgId: string, input: NewCall): Promise<Call> {
  return withOrgContext(orgId, async (tx) => {
    const [created] = await tx
      .insert(calls)
      .values({ ...input, status: 'pending' })
      .returning();

    await recordAudit(tx, {
      orgId,
      actorType: 'system',
      action: 'call.created',
      subjectType: 'call',
      subjectId: created!.id,
      metadata: {
        campaignId: input.campaign_id,
        contactId: input.contact_id,
        provider: input.provider,
      },
    });

    return created!;
  });
}

/**
 * Dispatches a pending call to the voice provider.
 *
 * Resolves the campaign script, assembles the system prompt and first message,
 * selects a voice and caller number, calls the provider, and transitions the
 * call status from 'pending' → 'dialing'.
 *
 * Note: full phone-number pool management (Vapi number IDs, rotation, spam
 * scoring) is implemented in plan 10. This call uses the first active number
 * assigned to the org as a placeholder.
 */
export async function dispatchCall(orgId: string, callId: string): Promise<void> {
  // 1. Load call record
  const [call] = await withOrgContext(orgId, (tx) =>
    tx
      .select()
      .from(calls)
      .where(and(eq(calls.id, callId), eq(calls.org_id, orgId)))
      .limit(1),
  );
  if (!call) throw new Error('call_not_found');

  // 2. Load campaign
  const [campaign] = await withOrgContext(orgId, (tx) =>
    tx
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, call.campaign_id), eq(campaigns.org_id, orgId)))
      .limit(1),
  );
  if (!campaign) throw new Error('campaign_not_found');

  // 3. Load script (org-scoped)
  const [script] = await withOrgContext(orgId, (tx) =>
    tx
      .select()
      .from(scripts)
      .where(and(eq(scripts.id, campaign.script_id), eq(scripts.org_id, orgId)))
      .limit(1),
  );
  if (!script) throw new Error('script_not_found');

  // 4. Load template (system-owned table — requires withSystemContext)
  const [template] = await withSystemContext((tx) =>
    tx
      .select()
      .from(scriptTemplates)
      .where(eq(scriptTemplates.id, script.template_id))
      .limit(1),
  );
  if (!template) throw new Error('template_not_found');

  // 5. Load contact (for the destination phone number)
  const [contact] = await withOrgContext(orgId, (tx) =>
    tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, call.contact_id), eq(contacts.org_id, orgId)))
      .limit(1),
  );
  if (!contact) throw new Error('contact_not_found');

  // 6. Assemble system prompt and first message
  const stringVars = fillMissingSchemaKeys(
    coerceToStringRecord(script.variables as Record<string, unknown>),
    template.variable_schema,
  );
  const systemPrompt = assembleSystemPrompt({
    templateBody: template.system_prompt,
    variables: stringVars,
  });
  const firstMessage = interpolate(readFirstMessageTemplate(template.slug), stringVars);

  // 7. Pick voice: test-call override → script override → template default → last-resort fallback
  const callMetaVoiceOverride = (call.metadata as Record<string, unknown> | null)?.['voice_id_override'] as string | null | undefined;
  const voiceId = (callMetaVoiceOverride || undefined) ?? script.voice_id ?? template.default_voice_id ?? 'it-IT-placeholder';

  // 8. Pick a caller number from the phone pool
  //    Plan 10 extends this with Vapi-specific number IDs and rotation logic.
  const [phone] = await withSystemContext((tx) =>
    tx
      .select({ e164: phoneNumbers.e164 })
      .from(phoneNumbers)
      .where(
        and(eq(phoneNumbers.status, 'active'), eq(phoneNumbers.org_id, orgId)),
      )
      .limit(1),
  );
  if (!phone) throw new NoPhoneNumberAvailableError(orgId);

  // 9. Resolve per-template tools
  const tools = (
    TEMPLATE_TOOLS[template.slug as keyof typeof TEMPLATE_TOOLS] ?? []
  ) as unknown as ToolDefinition[];

  // 10. Dispatch to voice provider
  const provider = getVoiceProvider();
  const webhookUrl = `${env.NEXT_PUBLIC_APP_URL}/api/webhooks/${provider.name}`;

  // Read the optional transfer destination from script variables.
  // If present and a valid E.164 string, it is passed to the provider so it can
  // configure the warm-transfer destination for the call. If absent, live transfer
  // is disabled for this call (the LLM's transfer_to_human_agent tool still fires
  // our DB side-effects but Vapi will not bridge the phone call).
  const scriptVars = script.variables as Record<string, unknown>;
  const transferTargetPhone =
    typeof scriptVars['transfer_target_phone'] === 'string' &&
    scriptVars['transfer_target_phone'].startsWith('+')
      ? scriptVars['transfer_target_phone']
      : undefined;

  // Per-script AMD voicemail policy. Default is false (hang up on AMD) which is
  // the safer choice for compliance in Phase 1. When true, the provider is
  // instructed to wait for the beep and read a pre-authored AI Act compliant
  // voicemail message.
  const leaveVoicemailMessage = scriptVars['leave_voicemail_message'] === true;
  let voicemailMessage: string | undefined;
  if (leaveVoicemailMessage) {
    voicemailMessage = interpolate(readVoicemailMessageTemplate(), stringVars);
  }

  const { providerCallId } = await provider.createCall({
    toNumber: contact.phone_e164,
    fromNumber: phone.e164,
    systemPrompt,
    firstMessage,
    voiceId,
    language: 'it-IT',
    maxDurationSeconds: MAX_CALL_DURATION_SECONDS,
    webhookUrl,
    metadata: {
      orgId,
      campaignId: call.campaign_id,
      callId: call.id,
      contactId: call.contact_id,
    },
    endCallFunctions: tools,
    amdEnabled: true,
    recordingEnabled: true,
    ...(transferTargetPhone !== undefined && { transferTargetPhone }),
    ...(voicemailMessage !== undefined && { voicemailMessage }),
  });

  // 11. Persist provider_call_id and transition to 'dialing'.
  //     Store leave_voicemail_message in metadata so recordCallEnded can set
  //     the correct outcome when AMD detects a voicemail.
  await withOrgContext(orgId, async (tx) => {
    await tx
      .update(calls)
      .set({
        provider_call_id: providerCallId,
        status: 'dialing',
        provider: provider.name as Call['provider'],
        metadata: { leave_voicemail_message: leaveVoicemailMessage },
      })
      .where(and(eq(calls.id, callId), eq(calls.org_id, orgId)));

    await recordAudit(tx, {
      orgId,
      actorType: 'system',
      action: 'call.dispatched',
      subjectType: 'call',
      subjectId: callId,
      metadata: { providerCallId, provider: provider.name },
    });
  });
}

/**
 * Records that a call has started ringing / connected (webhook: call.started).
 * Idempotent: only transitions from pending/dialing to in_progress.
 */
export async function recordCallStarted(
  callId: string,
  providerEventId: string,
): Promise<void> {
  const [row] = await withSystemContext((tx) =>
    tx
      .select({ org_id: calls.org_id })
      .from(calls)
      .where(eq(calls.id, callId))
      .limit(1),
  );
  if (!row) return;

  const orgId = row.org_id;

  await withOrgContext(orgId, async (tx) => {
    await tx
      .update(calls)
      .set({ status: 'in_progress', started_at: new Date() })
      .where(
        and(
          eq(calls.id, callId),
          inArray(calls.status, ['pending', 'dialing']),
        ),
      );

    await recordAudit(tx, {
      orgId,
      actorType: 'webhook',
      action: 'call.started',
      subjectType: 'call',
      subjectId: callId,
      metadata: { providerEventId },
    });
  });
}

/**
 * Records that a call has ended.
 *
 * Computes billable duration, updates the call record, charges the org's credit
 * balance, and emits a `call/completed` Inngest event for artifact persistence
 * (Task 9) and outcome classification (Task 11).
 */
export async function recordCallEnded(
  callId: string,
  args: {
    durationSeconds: number;
    endedReason: string;
    recordingUrl?: string;
    transcriptSegments?: TranscriptSegment[];
  },
): Promise<void> {
  const [row] = await withSystemContext((tx) =>
    tx
      .select({ org_id: calls.org_id, metadata: calls.metadata })
      .from(calls)
      .where(eq(calls.id, callId))
      .limit(1),
  );
  if (!row) return;

  const orgId = row.org_id;

  // Compute billing
  const perMinuteCents = await computePerMinuteCents(orgId);
  const { billableSeconds, costCents } = computeCallCost({
    durationSeconds: args.durationSeconds,
    perMinuteCents: perMinuteCents ?? 0,
  });

  const terminalStatus = mapEndedReasonToStatus(args.endedReason);

  // For voicemail calls, determine the outcome from the stored per-call policy:
  // - leave_voicemail_message=true  → voicemail_left (the AI read a message after the beep)
  // - leave_voicemail_message=false → voicemail_no_message (hung up on AMD, default)
  let voicemailOutcome: Call['outcome'] | null = null;
  if (terminalStatus === 'voicemail') {
    const meta = (row.metadata as Record<string, unknown> | null) ?? {};
    voicemailOutcome = meta['leave_voicemail_message'] === true ? 'voicemail_left' : 'voicemail_no_message';
  }

  await withOrgContext(orgId, async (tx) => {
    await tx
      .update(calls)
      .set({
        status: terminalStatus,
        ended_at: new Date(),
        billable_seconds: billableSeconds,
        cost_cents: costCents,
        ...(voicemailOutcome !== null && { outcome: voicemailOutcome }),
      })
      .where(eq(calls.id, callId));

    await recordAudit(tx, {
      orgId,
      actorType: 'webhook',
      action: 'call.ended',
      subjectType: 'call',
      subjectId: callId,
      metadata: {
        durationSeconds: args.durationSeconds,
        endedReason: args.endedReason,
        billableSeconds,
        costCents,
      },
    });
  });

  // Charge credits outside the transaction so billing failures do not roll back
  // the status update. chargeForCall is itself idempotent on callId.
  if (costCents > 0) {
    await chargeForCall(orgId, callId, costCents);
  }

  // Emit event for downstream artifact persistence and classification.
  await sendInngestEvent({
    name: CALL_COMPLETED_EVENT,
    data: {
      callId,
      orgId,
      durationSeconds: args.durationSeconds,
      endedReason: args.endedReason,
      recordingUrl: args.recordingUrl ?? null,
    },
    id: `call-completed-${callId}`,
  });
}

/**
 * Records a tool invocation during a call (from webhook: function-call) and
 * runs the corresponding side-effect handler inside the same transaction.
 *
 * The audit record and all DB side effects (outcome update, appointment insert,
 * opt-out registry, etc.) are committed atomically. Inngest events that need to
 * fire after the commit are emitted outside the transaction.
 */
export async function recordToolInvocation(
  callId: string,
  tool: string,
  args: unknown,
): Promise<void> {
  const [row] = await withSystemContext((tx) =>
    tx
      .select({ org_id: calls.org_id })
      .from(calls)
      .where(eq(calls.id, callId))
      .limit(1),
  );
  if (!row) return;

  const orgId = row.org_id;

  const { inngestEvents } = await withOrgContext(orgId, async (tx) => {
    await recordAudit(tx, {
      orgId,
      actorType: 'webhook',
      action: 'call.tool_invoked',
      subjectType: 'call',
      subjectId: callId,
      metadata: { tool, args },
    });

    return dispatchToolSideEffect(tx, orgId, callId, tool, args);
  });

  // Emit events outside the transaction so Inngest failures don't roll back the DB write.
  for (const event of inngestEvents) {
    await sendInngestEvent(event);
  }
}

/**
 * Emits a `call/classify` Inngest event if no tool-driven outcome has been set.
 * The outcome classifier (Task 11) consumes this event and writes `calls.outcome`.
 */
export async function classifyAndFinaliseCall(callId: string): Promise<void> {
  const [row] = await withSystemContext((tx) =>
    tx
      .select({ org_id: calls.org_id, outcome: calls.outcome })
      .from(calls)
      .where(eq(calls.id, callId))
      .limit(1),
  );
  if (!row) return;

  // Tool-driven outcome already set — skip classifier
  if (row.outcome !== null) return;

  await sendInngestEvent({
    name: CALL_CLASSIFY_EVENT,
    data: { callId, orgId: row.org_id },
    id: `call-classify-${callId}`,
  });
}

/**
 * Returns the call record combined with its audit-log event timeline.
 * Returns null when the call does not exist or belongs to a different org.
 */
export async function fetchCallTimeline(
  orgId: string,
  callId: string,
): Promise<CallTimeline | null> {
  const [call] = await withOrgContext(orgId, (tx) =>
    tx
      .select()
      .from(calls)
      .where(and(eq(calls.id, callId), eq(calls.org_id, orgId)))
      .limit(1),
  );
  if (!call) return null;

  // auditLog is a system-owned table — use withSystemContext with explicit org filter
  const events = await withSystemContext((tx) =>
    tx
      .select({
        type: auditLog.action,
        timestamp: auditLog.created_at,
        data: auditLog.metadata,
      })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.org_id, orgId),
          eq(auditLog.subject_type, 'call'),
          eq(auditLog.subject_id, callId),
        ),
      )
      .orderBy(auditLog.created_at),
  );

  return {
    call,
    events: events.map((e) => ({
      type: e.type,
      timestamp: e.timestamp,
      data: (e.data as Record<string, unknown>) ?? {},
    })),
  };
}

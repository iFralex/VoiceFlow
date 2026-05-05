/**
 * Inngest function: call.classify
 *
 * Triggered by `call/classify` events (emitted by `classifyAndFinaliseCall`
 * after a call ends with no tool-driven outcome).
 *
 * Steps:
 *  1. Load the call record and verify it still has no tool-driven outcome.
 *  2. Download the transcript JSON from Supabase Storage.
 *  3. Run the OpenAI gpt-4o-mini classifier.
 *  4. Persist the inferred outcome and confidence.
 *  5. If a tool outcome appeared in the interim (race), check for mismatch and
 *     emit `quality/outcome-mismatch` instead of overwriting.
 *
 * Idempotent: re-running for the same callId is safe — the UPDATE is guarded
 * by `outcome IS NULL` so a second run is a no-op if the first already wrote.
 */

import { and, eq, isNull } from 'drizzle-orm';

import { withOrgContext } from '@/lib/db/context';
import { calls } from '@/lib/db/schema';
import { sendInngestEvent } from '@/lib/inngest/client';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { classifyTranscript } from '@/lib/voice/classifier';
import { CALL_MEDIA_BUCKET } from '@/lib/voice/persistence';
import type { TranscriptSegment } from '@/lib/voice/types';
import type { CallClassifyData } from './events';
import { QUALITY_OUTCOME_MISMATCH_EVENT } from './events';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Processes a `call/classify` event: classifies the call transcript and
 * persists the inferred outcome when no tool-driven outcome has been set.
 */
export async function classifyCallHandler(data: CallClassifyData): Promise<void> {
  const { callId, orgId } = data;

  // 1. Load call record — check transcript path and current outcome
  const [call] = await withOrgContext(orgId, (tx) =>
    tx
      .select({
        outcome: calls.outcome,
        transcript_path: calls.transcript_path,
      })
      .from(calls)
      .where(and(eq(calls.id, callId), eq(calls.org_id, orgId)))
      .limit(1),
  );

  if (!call) return;

  if (!call.transcript_path) {
    throw new Error(`Call ${callId} has no transcript_path — cannot classify`);
  }

  // 2. Download transcript from Supabase Storage
  const { data: transcriptBlob, error: downloadError } = await supabaseAdmin.storage
    .from(CALL_MEDIA_BUCKET)
    .download(call.transcript_path);

  if (downloadError || !transcriptBlob) {
    throw new Error(
      `Failed to download transcript for call ${callId}: ${downloadError?.message ?? 'empty response'}`,
    );
  }

  const transcriptJson = await transcriptBlob.text();
  const segments = JSON.parse(transcriptJson) as TranscriptSegment[];

  // 3. Run the outcome classifier
  const result = await classifyTranscript(segments);

  // 4. Re-read outcome to detect race with a concurrent tool invocation
  const [current] = await withOrgContext(orgId, (tx) =>
    tx
      .select({ outcome: calls.outcome })
      .from(calls)
      .where(and(eq(calls.id, callId), eq(calls.org_id, orgId)))
      .limit(1),
  );

  if (!current) return;

  if (current.outcome !== null && current.outcome !== undefined) {
    // A tool-driven outcome was set concurrently — we must NOT overwrite it.
    if (current.outcome !== result.outcome) {
      // Outcomes disagree — emit a quality event for the QA dashboard (plan 14).
      await sendInngestEvent({
        name: QUALITY_OUTCOME_MISMATCH_EVENT,
        data: {
          callId,
          orgId,
          toolOutcome: current.outcome,
          inferredOutcome: result.outcome,
          inferredConfidence: result.confidence,
          reasoning: result.reasoning,
        },
        id: `outcome-mismatch-${callId}`,
      });
    }
    // Whether they agree or disagree, do not touch the tool-driven outcome.
    return;
  }

  // 5. No tool outcome — persist the inferred outcome.
  // The `isNull(calls.outcome)` guard ensures idempotency even if two classify
  // functions somehow run in parallel.
  await withOrgContext(orgId, async (tx) => {
    await tx
      .update(calls)
      .set({
        outcome: result.outcome,
        outcome_confidence: result.confidence.toFixed(2),
      })
      .where(
        and(
          eq(calls.id, callId),
          eq(calls.org_id, orgId),
          isNull(calls.outcome),
        ),
      );
  });
}

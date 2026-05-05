/**
 * Inngest function: call.persist-artifacts
 *
 * Triggered by `call/completed` events.  Downloads the recording (MP3) and
 * transcript from the voice provider and stores them in Supabase Storage.
 *
 * Retry strategy: the voice provider may not have finished post-processing the
 * recording by the time the `call/completed` event fires.  When
 * `persistCallArtifacts` throws a `RecordingNotReadyError` we re-throw so that
 * Inngest's built-in retry mechanism (exponential back-off, up to
 * MAX_ATTEMPTS) can attempt again after a delay.
 *
 * When the Inngest SDK is wired up in a later plan, wrap the two I/O steps
 * (fetchRecording, fetchTranscript) in `step.run()` blocks for finer-grained
 * retries without changing the business logic here.
 */

import { classifyAndFinaliseCall } from '@/lib/services/calls';
import { persistCallArtifacts, RecordingNotReadyError } from '@/lib/voice/persistence';

import type { CallCompletedData } from './events';

/** Maximum number of execution attempts before giving up. */
export const PERSIST_ARTIFACTS_MAX_ATTEMPTS = 5;

/**
 * Processes a `call/completed` event and persists the call's recording and
 * transcript to storage.
 *
 * Throws `RecordingNotReadyError` when the recording is still processing so
 * that the Inngest runtime can schedule a delayed retry.
 */
export async function persistCallArtifactsHandler(data: CallCompletedData): Promise<void> {
  try {
    await persistCallArtifacts(data.callId);
  } catch (err) {
    if (err instanceof RecordingNotReadyError) {
      // Re-throw so Inngest retries with back-off
      throw err;
    }
    // For all other errors, wrap with context and re-throw
    throw new Error(
      `persistCallArtifacts failed for callId=${data.callId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Artifacts are now in storage — emit call/classify if no tool outcome was set.
  await classifyAndFinaliseCall(data.callId);
}

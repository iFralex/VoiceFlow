/**
 * Call artifact persistence.
 *
 * Downloads recordings (MP3) and transcripts (JSON) from the voice provider
 * and stores them in Supabase Storage, then updates the call record with the
 * storage paths so the app can serve signed download URLs.
 *
 * Storage layout (single `call-media` bucket):
 *   recordings/<org_id>/<call_id>.mp3
 *   transcripts/<org_id>/<call_id>.json
 *
 * Idempotent: re-running for the same callId is safe — Supabase Storage
 * upload uses `upsert: true` and the DB update is a SET on the same columns.
 */

import { eq } from 'drizzle-orm';

import { withOrgContext, withSystemContext } from '@/lib/db/context';
import { calls } from '@/lib/db/schema';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getVoiceProviderByName } from '@/lib/voice/factory';

// ─── Constants ───────────────────────────────────────────────────────────────

export const CALL_MEDIA_BUCKET = 'call-media';

// ─── Error types ─────────────────────────────────────────────────────────────

/**
 * Thrown when the voice provider has not finished processing the recording yet.
 * Callers (Inngest function wrappers) should treat this as a retriable error.
 */
export class RecordingNotReadyError extends Error {
  constructor(callId: string) {
    super(`Recording not ready for call ${callId} — will retry`);
    this.name = 'RecordingNotReadyError';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function uploadToStorage(
  bucket: string,
  path: string,
  body: Buffer | string,
  contentType: string,
): Promise<void> {
  const { error } = await supabaseAdmin.storage.from(bucket).upload(path, body, {
    contentType,
    upsert: true,
  });

  if (error) {
    throw new Error(`Storage upload failed for "${path}": ${error.message}`);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetches recording and transcript from the voice provider and persists them
 * to Supabase Storage.  Updates `calls.recording_path` and
 * `calls.transcript_path` on completion.
 *
 * @throws {RecordingNotReadyError} if the MP3 bytes are not yet available
 *   (provider still post-processing).  Callers should schedule a retry.
 */
export async function persistCallArtifacts(callId: string): Promise<void> {
  // 1. Load the call record (system context — just reading org_id / provider)
  const [call] = await withSystemContext((tx) =>
    tx
      .select({
        org_id: calls.org_id,
        provider: calls.provider,
        provider_call_id: calls.provider_call_id,
      })
      .from(calls)
      .where(eq(calls.id, callId))
      .limit(1),
  );

  if (!call) throw new Error(`Call not found: ${callId}`);
  if (!call.provider_call_id) throw new Error(`Call ${callId} has no provider_call_id`);

  const { org_id: orgId, provider, provider_call_id: providerCallId } = call;

  // 2. Get the right adapter for this call's provider
  const adapter = getVoiceProviderByName(provider);

  // 3. Persist recording ──────────────────────────────────────────────────────
  const recordingStoragePath = `recordings/${orgId}/${callId}.mp3`;

  const { url: recordingUrl, bytes: recordingBytes } =
    await adapter.fetchRecording(providerCallId);

  if (recordingBytes === null) {
    // Provider hasn't finished processing yet — signal for retry
    throw new RecordingNotReadyError(callId);
  }

  await uploadToStorage(CALL_MEDIA_BUCKET, recordingStoragePath, recordingBytes, 'audio/mpeg');

  // 4. Persist transcript ─────────────────────────────────────────────────────
  const transcriptStoragePath = `transcripts/${orgId}/${callId}.json`;

  const segments = await adapter.fetchTranscript(providerCallId);
  const transcriptJson = JSON.stringify(segments, null, 2);

  await uploadToStorage(
    CALL_MEDIA_BUCKET,
    transcriptStoragePath,
    Buffer.from(transcriptJson, 'utf-8'),
    'application/json',
  );

  // 5. Update the call record with storage paths ──────────────────────────────
  await withOrgContext(orgId, async (tx) => {
    await tx
      .update(calls)
      .set({
        recording_path: recordingStoragePath,
        transcript_path: transcriptStoragePath,
      })
      .where(eq(calls.id, callId));
  });

  // Suppress unused-variable warning for recordingUrl (kept for observability / future use)
  void recordingUrl;
}

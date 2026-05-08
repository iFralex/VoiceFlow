/**
 * Daily retention purge cron — plan 11 task 13.
 *
 * Runs daily at 03:00 Europe/Rome (registered in `vercel.json`). Walks every
 * live organization and enforces the retention windows declared in
 * `src/lib/compliance/retention.ts`:
 *
 *   - Recordings:  delete the storage object, then NULL the `recording_path`.
 *   - Transcripts: delete the storage object, then NULL the `transcript_path`.
 *   - Soft-deleted contacts: hard-delete rows past the 30-day grace period.
 *
 * Storage deletion is best-effort: a chunk error is counted (`storageErrors`)
 * and the matching DB columns are NOT cleared, so the next run retries the
 * same paths. This avoids losing the only pointer to data we still hold.
 *
 * The retention policy for recordings is per-org (`organizations.recording_retention_days`);
 * everything else is platform-fixed. We resolve the policy once per org, then
 * loop the artifact-by-artifact deletion in chunks until exhausted.
 *
 * Cross-org by design — runs through `withSystemContext` and is mounted at a
 * cron-only route guarded by `Authorization: Bearer ${CRON_SECRET}`.
 *
 * Legal hold (plan 11 task 14): a contact whose `legal_hold_until` is non-NULL
 * and still in the future is excluded from every step here — its calls keep
 * their recording / transcript paths, and the contact row is not hard-deleted
 * even after the 30-day grace period has elapsed. The hold expires implicitly
 * once `legal_hold_until <= now()`, after which the next cron run resumes
 * normal retention. Inbound IVR calls (no `contact_id`) are unaffected.
 */

import { timingSafeEqual } from 'crypto';

import { and, eq, gt, inArray, isNotNull, isNull, lt, notInArray, or } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getRetentionThresholds } from '@/lib/compliance/retention';
import { recordAudit } from '@/lib/db/audit';
import { withSystemContext } from '@/lib/db/context';
import { calls, contacts, organizations } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { CALL_MEDIA_BUCKET } from '@/lib/voice/persistence';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/**
 * How many call rows to fetch per artifact-purge query. Each row maps to one
 * storage object so this also bounds the size of the storage `.remove()` call.
 * Supabase Storage accepts thousands per request but smaller chunks keep the
 * blast radius of a single failure tighter.
 */
const ARTIFACT_BATCH_SIZE = 500;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function authorize(request: Request): boolean {
  const secret = env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!auth) return false;
  const authBuf = Buffer.from(auth);
  const expectedBuf = Buffer.from(`Bearer ${secret}`);
  if (authBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(authBuf, expectedBuf);
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface RetentionPurgeOrgResult {
  orgId: string;
  recordingsDeleted: number;
  transcriptsDeleted: number;
  storageErrors: number;
  contactsHardDeleted: number;
}

export interface RetentionPurgeResult {
  orgsProcessed: number;
  totalRecordingsDeleted: number;
  totalTranscriptsDeleted: number;
  totalStorageErrors: number;
  totalContactsHardDeleted: number;
  errors: number;
}

// ---------------------------------------------------------------------------
// Public entry point (exposed for tests)
// ---------------------------------------------------------------------------

export async function runRetentionPurge(now: Date = new Date()): Promise<RetentionPurgeResult> {
  const orgIds = await fetchOrgIds();

  let orgsProcessed = 0;
  let totalRecordingsDeleted = 0;
  let totalTranscriptsDeleted = 0;
  let totalStorageErrors = 0;
  let totalContactsHardDeleted = 0;
  let errors = 0;

  for (const orgId of orgIds) {
    try {
      const r = await purgeOrg(orgId, now);
      totalRecordingsDeleted += r.recordingsDeleted;
      totalTranscriptsDeleted += r.transcriptsDeleted;
      totalStorageErrors += r.storageErrors;
      totalContactsHardDeleted += r.contactsHardDeleted;
      orgsProcessed++;
    } catch (err) {
      console.error('[retention-purge] org failed', {
        orgId,
        error: err instanceof Error ? err.message : String(err),
      });
      errors++;
    }
  }

  await withSystemContext(async (tx) => {
    await recordAudit(tx, {
      actorType: 'system',
      action: 'compliance.retention_purge_completed',
      subjectType: 'retention',
      subjectId: 'daily',
      metadata: {
        orgsProcessed,
        totalRecordingsDeleted,
        totalTranscriptsDeleted,
        totalStorageErrors,
        totalContactsHardDeleted,
        errors,
      },
    });
  });

  return {
    orgsProcessed,
    totalRecordingsDeleted,
    totalTranscriptsDeleted,
    totalStorageErrors,
    totalContactsHardDeleted,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Per-org orchestration
// ---------------------------------------------------------------------------

async function purgeOrg(orgId: string, now: Date): Promise<RetentionPurgeOrgResult> {
  const thresholds = await getRetentionThresholds(orgId, { now });

  // Resolve held contacts up-front so every subsequent step can exclude them.
  // Hold expiry is measured against `now` (the cron's wall clock), so a hold
  // whose `legal_hold_until` has passed simply doesn't appear in the set and
  // retention proceeds normally for that contact.
  const heldContactIds = await fetchHeldContactIds(orgId, now);

  const recordings = await purgeArtifactColumn({
    orgId,
    cutoff: thresholds.recordingCutoff,
    column: 'recording_path',
    heldContactIds,
  });

  const transcripts = await purgeArtifactColumn({
    orgId,
    cutoff: thresholds.transcriptCutoff,
    column: 'transcript_path',
    heldContactIds,
  });

  const contactsHardDeleted = await hardDeleteSoftDeletedContacts(
    orgId,
    thresholds.softDeletedContactCutoff,
    heldContactIds,
  );

  return {
    orgId,
    recordingsDeleted: recordings.deleted,
    transcriptsDeleted: transcripts.deleted,
    storageErrors: recordings.storageErrors + transcripts.storageErrors,
    contactsHardDeleted,
  };
}

// ---------------------------------------------------------------------------
// Helpers — orgs
// ---------------------------------------------------------------------------

async function fetchOrgIds(): Promise<string[]> {
  return withSystemContext(async (tx) => {
    const rows = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(isNull(organizations.deleted_at));
    return rows.map((r) => r.id);
  });
}

// ---------------------------------------------------------------------------
// Helpers — legal hold (plan 11 task 14)
// ---------------------------------------------------------------------------

/**
 * Resolves contacts under an active legal hold for the given org.
 *
 * "Active" means `legal_hold_until` is non-NULL and strictly in the future
 * relative to `now` — past timestamps let a hold expire on its own without
 * any operator action. We materialise the IDs into a Set so callers can do
 * cheap exclusion in tight loops without re-querying.
 */
async function fetchHeldContactIds(orgId: string, now: Date): Promise<Set<string>> {
  return withSystemContext(async (tx) => {
    const rows = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.org_id, orgId),
          isNotNull(contacts.legal_hold_until),
          gt(contacts.legal_hold_until, now),
        ),
      );
    return new Set(rows.map((r) => r.id));
  });
}

// ---------------------------------------------------------------------------
// Helpers — artifact (recording / transcript) purge
// ---------------------------------------------------------------------------

interface PurgeArtifactArgs {
  orgId: string;
  cutoff: Date;
  column: 'recording_path' | 'transcript_path';
  heldContactIds: Set<string>;
}

interface PurgeArtifactResult {
  deleted: number;
  storageErrors: number;
}

/**
 * Drains expired recordings or transcripts for one org. Loops in chunks so a
 * backlog larger than `ARTIFACT_BATCH_SIZE` is fully cleared in a single cron
 * run. Each chunk is a self-contained sequence:
 *
 *   1. Fetch up to N call rows whose timestamp is past the cutoff and whose
 *      target path column is non-null.
 *   2. Best-effort batch delete from Storage. On error, count storage errors
 *      and skip the DB clear so the same paths get retried next run.
 *   3. NULL the path column for the rows whose storage delete succeeded.
 */
async function purgeArtifactColumn({
  orgId,
  cutoff,
  column,
  heldContactIds,
}: PurgeArtifactArgs): Promise<PurgeArtifactResult> {
  let deleted = 0;
  let storageErrors = 0;

  for (;;) {
    const rows = await fetchExpiredCalls(orgId, cutoff, column, heldContactIds);
    if (rows.length === 0) break;

    const paths = rows.map((r) => r.path);
    const ids = rows.map((r) => r.id);

    const storageOk = await deleteStorageObjects(paths);
    if (!storageOk) {
      storageErrors += paths.length;
      // Bail out of this column for this org — retrying the same chunk next
      // call would loop forever. The next cron run will pick it up.
      break;
    }

    const cleared = await clearArtifactColumn(orgId, ids, column);
    deleted += cleared;

    if (rows.length < ARTIFACT_BATCH_SIZE) break;
  }

  return { deleted, storageErrors };
}

interface ExpiredCallRow {
  id: string;
  path: string;
}

async function fetchExpiredCalls(
  orgId: string,
  cutoff: Date,
  column: 'recording_path' | 'transcript_path',
  heldContactIds: Set<string>,
): Promise<ExpiredCallRow[]> {
  return withSystemContext(async (tx) => {
    const pathCol = column === 'recording_path' ? calls.recording_path : calls.transcript_path;
    // Calls with `contact_id IS NULL` are inbound IVR rows — they have no
    // contact and therefore no legal-hold linkage; they purge as normal.
    const heldExclusion = heldContactIds.size > 0
      ? or(isNull(calls.contact_id), notInArray(calls.contact_id, [...heldContactIds]))
      : undefined;
    const rows = await tx
      .select({ id: calls.id, path: pathCol })
      .from(calls)
      .where(
        and(
          eq(calls.org_id, orgId),
          isNotNull(pathCol),
          lt(calls.created_at, cutoff),
          heldExclusion,
        ),
      )
      .limit(ARTIFACT_BATCH_SIZE);
    return rows
      .filter((r): r is { id: string; path: string } => r.path !== null)
      .map((r) => ({ id: r.id, path: r.path }));
  });
}

async function clearArtifactColumn(
  orgId: string,
  callIds: string[],
  column: 'recording_path' | 'transcript_path',
): Promise<number> {
  if (callIds.length === 0) return 0;
  return withSystemContext(async (tx) => {
    const setClause = column === 'recording_path'
      ? { recording_path: null }
      : { transcript_path: null };
    const r = await tx
      .update(calls)
      .set(setClause)
      .where(and(eq(calls.org_id, orgId), inArray(calls.id, callIds)))
      .returning({ id: calls.id });
    return r.length;
  });
}

/**
 * Deletes a batch of storage objects. Returns true on success (no error from
 * the storage client). The Supabase `.remove()` call tolerates missing keys —
 * a path that no longer exists in the bucket is reported in `data` as failed
 * but does not produce a top-level `error`. We treat any non-null `error` as
 * a hard failure and let the caller retry on the next cron run.
 */
async function deleteStorageObjects(paths: string[]): Promise<boolean> {
  if (paths.length === 0) return true;
  const { error } = await supabaseAdmin.storage.from(CALL_MEDIA_BUCKET).remove(paths);
  if (error) {
    console.error('[retention-purge] storage delete failed', {
      count: paths.length,
      error: error.message,
    });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Helpers — soft-deleted contact hard purge
// ---------------------------------------------------------------------------

/**
 * Hard-deletes contacts whose `deleted_at` is older than the soft-delete grace
 * period (30 days, see {@link SOFT_DELETED_CONTACT_PURGE_DAYS}). The FK on
 * `calls.contact_id` is `ON DELETE CASCADE`, so the deletion sweeps the
 * contact's call rows as well.
 *
 * Storage objects (recordings, transcripts) for those calls would otherwise be
 * orphaned: the cascade removes the only DB pointer to them, so the artifact
 * retention cron can never find them again. To stay compliant with the 12-month
 * recording retention spec we eagerly purge any non-null `recording_path` /
 * `transcript_path` for every call about to be cascade-deleted, *before* the
 * contact rows go away. GDPR-erased contacts have `recording_path` /
 * `transcript_path` already NULLed by `eraseSubject`, so the storage delete is
 * a no-op for that path.
 */
async function hardDeleteSoftDeletedContacts(
  orgId: string,
  cutoff: Date,
  heldContactIds: Set<string>,
): Promise<number> {
  // 1. Resolve the contact ids that are about to be deleted. We do this
  //    before the DELETE so the FK cascade can't remove the rows out from
  //    under us — once the contacts are gone we lose all paths to their
  //    calls' storage objects.
  const contactIds = await withSystemContext(async (tx) => {
    const heldExclusion = heldContactIds.size > 0
      ? notInArray(contacts.id, [...heldContactIds])
      : undefined;
    const ids = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.org_id, orgId),
          isNotNull(contacts.deleted_at),
          lt(contacts.deleted_at, cutoff),
          heldExclusion,
        ),
      );
    return ids.map((r) => r.id);
  });

  if (contactIds.length === 0) return 0;

  // 2. Fetch all storage paths attached to those contacts' calls so we can
  //    purge them up front. Without this step the cascade-delete would
  //    leave recordings/transcripts orphaned in the bucket — the artifact
  //    retention cron can never find them again because the call rows are gone.
  const { recordingPaths, transcriptPaths } = await withSystemContext(async (tx) => {
    const rows = await tx
      .select({ recording: calls.recording_path, transcript: calls.transcript_path })
      .from(calls)
      .where(and(eq(calls.org_id, orgId), inArray(calls.contact_id, contactIds)));
    return {
      recordingPaths: rows
        .map((c) => c.recording)
        .filter((p): p is string => typeof p === 'string' && p.length > 0),
      transcriptPaths: rows
        .map((c) => c.transcript)
        .filter((p): p is string => typeof p === 'string' && p.length > 0),
    };
  });

  // 3. Best-effort storage purge. A storage failure is logged but does not
  //    block the DB delete — privacy is preserved at the DB layer regardless,
  //    and we cannot re-attempt later because the cascade is about to remove
  //    the only DB pointer to these paths. This trades occasional orphans on
  //    storage outages for guaranteed forward progress on retention.
  const allPaths = [...recordingPaths, ...transcriptPaths];
  if (allPaths.length > 0) {
    const { error } = await supabaseAdmin.storage.from(CALL_MEDIA_BUCKET).remove(allPaths);
    if (error) {
      console.error('[retention-purge] cascade storage purge failed', {
        orgId,
        count: allPaths.length,
        error: error.message,
      });
    }
  }

  // 4. Hard-delete the contacts; FK cascade removes the calls rows.
  return withSystemContext(async (tx) => {
    const r = await tx
      .delete(contacts)
      .where(and(eq(contacts.org_id, orgId), inArray(contacts.id, contactIds)))
      .returning({ id: contacts.id });
    return r.length;
  });
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<Response> {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await runRetentionPurge();
  return NextResponse.json({ ok: true, ...result });
}

export const dynamic = 'force-dynamic';

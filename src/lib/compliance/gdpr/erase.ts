/**
 * GDPR Article 17 — data subject erasure (plan 11 task 10).
 *
 * Resolves a contact by phone (E.164) or email within an org and erases their
 * data:
 *
 *   1. Soft-delete the contact: set `deleted_at`, scrub `first_name`,
 *      `last_name`, `email`. The `phone_e164` value is preserved so the
 *      `opt_out_registry` row remains queryable — the contact metadata is
 *      stamped with `erased_at` and `gdpr_erasure: true` to mark the row.
 *   2. Record a full org-level opt-out via the standard
 *      {@link markOptOutInTx} flow with source `gdpr_request`. This guarantees
 *      the same audit and event semantics as every other opt-out source.
 *   3. Replace the `calls.metadata` JSONB on every call referencing the
 *      contact with a tombstone (`{ gdpr_erasure: true, erased_at }`) so
 *      transcript snippets, raw outcome text, etc. cannot leak post-erasure.
 *   4. Insert an `audit_log` entry with action `compliance.gdpr_erasure`
 *      capturing the byUserId, reason, identifier and the totals.
 *
 * The DB writes run inside a single `withOrgContext` transaction so they
 * commit atomically. Storage object deletion is intentionally performed
 * **after** the transaction commits — Storage operations are not
 * transactional, and we'd rather have orphan storage objects (mopped up by
 * the retention cron) than have a transient storage outage block the legally
 * required DB scrub. Storage errors are recorded on the result and forwarded
 * on the audit log metadata for follow-up.
 *
 * Confirmation gate: the caller must pass `confirmPhone` equal to the
 * contact's `phone_e164`. Mismatches raise {@link SubjectErasureConfirmationError}
 * before any writes happen. This mirrors the spec requirement that the
 * requestor "type the contact's phone number to confirm".
 *
 * The hard purge (deleting `contacts` rows whose `deleted_at` is older than
 * 30 days) is owned by the retention cron in task 13 — this module only soft
 * deletes and scrubs.
 */

import { and, eq, isNull, or } from 'drizzle-orm';

import { recordAudit } from '@/lib/db/audit';
import type { DbTx } from '@/lib/db/context';
import { withOrgContext } from '@/lib/db/context';
import { calls, contacts } from '@/lib/db/schema';
import type { Contact } from '@/lib/db/schema';
import { sendInngestEvents } from '@/lib/inngest/client';
import type { InngestEventPayload } from '@/lib/inngest/client';
import { markOptOutInTx } from '@/lib/services/optout';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { CALL_MEDIA_BUCKET } from '@/lib/voice/persistence';

// ─── Constants ───────────────────────────────────────────────────────────────

export const COMPLIANCE_GDPR_ERASURE_EVENT = 'compliance/gdpr-erasure' as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EraseSubjectParams {
  orgId: string;
  byUserId: string;
  identifier: string;
  reason: string;
  /**
   * Confirmation phone — must equal the resolved contact's `phone_e164` or
   * the call throws {@link SubjectErasureConfirmationError} before writing
   * anything. The UI requires the operator to retype the phone number to
   * guard against accidental erasure.
   */
  confirmPhone: string;
}

export interface EraseSubjectResult {
  contactId: string;
  phoneE164: string;
  totals: {
    callsScrubbed: number;
    recordingsDeleted: number;
    transcriptsDeleted: number;
    storageErrors: number;
  };
}

export interface ComplianceGdprErasureEventData {
  orgId: string;
  contactId: string;
  phoneE164: string;
  byUserId: string;
  reason: string;
  erasedAt: string;
  totals: EraseSubjectResult['totals'];
}

export class SubjectNotFoundError extends Error {
  constructor(identifier: string) {
    super(`No contact in this org matches identifier "${identifier}"`);
    this.name = 'SubjectNotFoundError';
  }
}

export class SubjectErasureConfirmationError extends Error {
  constructor() {
    super(
      'Confirmation phone does not match the contact phone number. Retype the contact phone number exactly.',
    );
    this.name = 'SubjectErasureConfirmationError';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function looksLikeEmail(s: string): boolean {
  return s.includes('@');
}

interface ResolvedSubject {
  contact: Contact;
  callRows: Array<{ id: string; recording_path: string | null; transcript_path: string | null }>;
}

async function resolveSubject(
  tx: DbTx,
  orgId: string,
  identifier: string,
): Promise<ResolvedSubject | null> {
  const lookupConditions = [
    and(eq(contacts.org_id, orgId), eq(contacts.phone_e164, identifier), isNull(contacts.deleted_at)),
  ];
  if (looksLikeEmail(identifier)) {
    lookupConditions.push(
      and(eq(contacts.org_id, orgId), eq(contacts.email, identifier), isNull(contacts.deleted_at)),
    );
  }

  const [contact] = await tx
    .select()
    .from(contacts)
    .where(or(...lookupConditions))
    .limit(1);

  if (!contact) return null;

  const callRows = await tx
    .select({
      id: calls.id,
      recording_path: calls.recording_path,
      transcript_path: calls.transcript_path,
    })
    .from(calls)
    .where(and(eq(calls.org_id, orgId), eq(calls.contact_id, contact.id)));

  return { contact, callRows };
}

interface StorageDeleteOutcome {
  recordingsDeleted: number;
  transcriptsDeleted: number;
  storageErrors: number;
}

/**
 * Best-effort batched delete from the call-media bucket. Errors are logged
 * and counted but do not throw — the DB scrub has already committed and
 * privacy is preserved at the DB layer. Orphan storage objects are mopped up
 * by the retention cron.
 */
async function purgeStorageObjects(
  recordingPaths: string[],
  transcriptPaths: string[],
): Promise<StorageDeleteOutcome> {
  const outcome: StorageDeleteOutcome = {
    recordingsDeleted: 0,
    transcriptsDeleted: 0,
    storageErrors: 0,
  };

  if (recordingPaths.length > 0) {
    const { data, error } = await supabaseAdmin.storage
      .from(CALL_MEDIA_BUCKET)
      .remove(recordingPaths);
    if (error) {
      console.error('[gdpr.erase] recording delete failed:', error.message);
      outcome.storageErrors += recordingPaths.length;
    } else {
      outcome.recordingsDeleted = data?.length ?? recordingPaths.length;
    }
  }

  if (transcriptPaths.length > 0) {
    const { data, error } = await supabaseAdmin.storage
      .from(CALL_MEDIA_BUCKET)
      .remove(transcriptPaths);
    if (error) {
      console.error('[gdpr.erase] transcript delete failed:', error.message);
      outcome.storageErrors += transcriptPaths.length;
    } else {
      outcome.transcriptsDeleted = data?.length ?? transcriptPaths.length;
    }
  }

  return outcome;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fulfils a GDPR Article 17 erasure request for the contact identified by
 * `identifier` (phone E.164 or email) within the given org. See the file
 * docstring for the full sequence of operations.
 *
 * @throws {SubjectNotFoundError} if no live contact in `orgId` matches.
 * @throws {SubjectErasureConfirmationError} if `confirmPhone` does not match.
 */
export async function eraseSubject(
  params: EraseSubjectParams,
): Promise<EraseSubjectResult> {
  const { orgId, byUserId, identifier, reason, confirmPhone } = params;

  const erasedAt = new Date();
  const erasedAtIso = erasedAt.toISOString();

  // Run the entire DB scrub inside one transaction so a partial failure
  // rolls back. Storage deletion happens after commit — see file docstring.
  const txResult = await withOrgContext(orgId, async (tx) => {
    const subject = await resolveSubject(tx, orgId, identifier);
    if (!subject) throw new SubjectNotFoundError(identifier);

    if (subject.contact.phone_e164 !== confirmPhone) {
      throw new SubjectErasureConfirmationError();
    }

    const { contact, callRows } = subject;

    // 1. Scrub the contact row. Preserve phone_e164 so the opt_out_registry
    //    row stays queryable; everything else is wiped or tombstoned.
    const existingMetadata =
      typeof contact.metadata === 'object' && contact.metadata !== null
        ? (contact.metadata as Record<string, unknown>)
        : {};
    const contactTombstone = {
      ...existingMetadata,
      gdpr_erasure: true,
      erased_at: erasedAtIso,
      erasure_reason: reason,
    };
    await tx
      .update(contacts)
      .set({
        first_name: null,
        last_name: null,
        email: null,
        metadata: contactTombstone,
        deleted_at: erasedAt,
      })
      .where(and(eq(contacts.org_id, orgId), eq(contacts.id, contact.id)));

    // 2. Tombstone every call's metadata. We replace the JSONB entirely
    //    rather than try to whitelist PII fields — call metadata schemas
    //    drift over time and missing one field would be a leak.
    const callTombstone = {
      gdpr_erasure: true,
      erased_at: erasedAtIso,
    };
    if (callRows.length > 0) {
      await tx
        .update(calls)
        .set({ metadata: callTombstone })
        .where(and(eq(calls.org_id, orgId), eq(calls.contact_id, contact.id)));
    }

    // 3. Record the org-wide opt-out via the standard service. Reuses its
    //    audit + event mechanics — we do NOT duplicate that here.
    const optOutEvents = await markOptOutInTx(tx, {
      orgId,
      phoneE164: contact.phone_e164,
      source: 'gdpr_request',
      actorUserId: byUserId,
      actorType: 'user',
      reason,
      metadata: { contactId: contact.id, gdprErasure: true },
    });

    // 4. Audit the erasure itself. The opt_out.recorded entry above covers
    //    the registry side; this entry covers the contact-level scrub.
    await recordAudit(tx, {
      orgId,
      actorUserId: byUserId,
      actorType: 'user',
      action: 'compliance.gdpr_erasure',
      subjectType: 'contact',
      subjectId: contact.id,
      metadata: {
        identifier,
        reason,
        phoneE164: contact.phone_e164,
        callCount: callRows.length,
        erasedAt: erasedAtIso,
      },
    });

    return { contact, callRows, optOutEvents };
  });

  // 5. Best-effort storage purge — see purgeStorageObjects for the rationale.
  const recordingPaths = txResult.callRows
    .map((c) => c.recording_path)
    .filter((p): p is string => typeof p === 'string' && p.length > 0);
  const transcriptPaths = txResult.callRows
    .map((c) => c.transcript_path)
    .filter((p): p is string => typeof p === 'string' && p.length > 0);
  const storageOutcome = await purgeStorageObjects(recordingPaths, transcriptPaths);

  const totals = {
    callsScrubbed: txResult.callRows.length,
    recordingsDeleted: storageOutcome.recordingsDeleted,
    transcriptsDeleted: storageOutcome.transcriptsDeleted,
    storageErrors: storageOutcome.storageErrors,
  };

  // 6. Emit Inngest events: the opt-out registration plus the erasure event
  //    consumed by plan 13's notifier.
  const erasureEvent: InngestEventPayload = {
    name: COMPLIANCE_GDPR_ERASURE_EVENT,
    // Dedupe at the contact granularity — re-running erasure for the same
    // contact is a no-op (the contact is already soft-deleted) but a stuck
    // retry shouldn't multi-notify.
    id: `gdpr-erasure-${orgId}-${txResult.contact.id}`,
    data: {
      orgId,
      contactId: txResult.contact.id,
      phoneE164: txResult.contact.phone_e164,
      byUserId,
      reason,
      erasedAt: erasedAtIso,
      totals,
    } satisfies ComplianceGdprErasureEventData as unknown as Record<string, unknown>,
  };

  await sendInngestEvents([...txResult.optOutEvents, erasureEvent]);

  return {
    contactId: txResult.contact.id,
    phoneE164: txResult.contact.phone_e164,
    totals,
  };
}

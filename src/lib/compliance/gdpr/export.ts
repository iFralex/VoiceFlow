/**
 * GDPR Article 15 — data subject export (plan 11 task 9).
 *
 * Builds a single ZIP archive containing every record we hold about one
 * contact within an org and uploads it to Supabase Storage with a 7-day
 * signed URL. The archive layout is:
 *
 *   contact.json          — the contacts row (PII included)
 *   calls.json            — every calls row that references the contact
 *   appointments.json     — every appointments row
 *   opt_outs.json         — opt_out_registry rows for the contact's phone
 *   audit_log.json        — audit_log rows where subject_id matches the
 *                           contact id, the phone, or the email
 *   recordings/<call>.mp3 — recording artefacts for each call (when present)
 *   transcripts/<call>.json — transcript artefacts for each call (when present)
 *
 * The contact is resolved by phone (E.164) or email within the org. Lookups
 * use `withOrgContext` so RLS still applies and cross-org data cannot leak.
 * Storage downloads use `supabaseAdmin` because Storage has no RLS GUC and
 * the path itself is org-scoped (`recordings/<orgId>/<callId>.mp3`).
 */

import { randomUUID } from 'node:crypto';

import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import JSZip from 'jszip';

import { recordAudit } from '@/lib/db/audit';
import { withOrgContext, withSystemContext } from '@/lib/db/context';
import {
  appointments,
  auditLog,
  calls,
  contacts,
  optOutRegistry,
} from '@/lib/db/schema';
import type { Appointment, AuditLogEntry, Call, Contact, OptOutRegistryEntry } from '@/lib/db/schema';
import { CSV_UPLOADS_BUCKET } from '@/lib/storage/signed';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { CALL_MEDIA_BUCKET } from '@/lib/voice/persistence';

// ─── Constants ───────────────────────────────────────────────────────────────

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BuildSubjectExportParams {
  orgId: string;
  identifier: string;
  actorUserId?: string;
}

export interface SubjectExportResult {
  exportId: string;
  storagePath: string;
  signedUrl: string;
  expiresAt: Date;
  contactId: string;
  totals: {
    calls: number;
    appointments: number;
    optOuts: number;
    auditEntries: number;
    recordingsBundled: number;
    transcriptsBundled: number;
  };
}

export class SubjectNotFoundError extends Error {
  constructor(identifier: string) {
    super(`No contact in this org matches identifier "${identifier}"`);
    this.name = 'SubjectNotFoundError';
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function looksLikeEmail(s: string): boolean {
  return s.includes('@');
}

async function downloadStorageObject(
  bucket: string,
  path: string,
): Promise<Buffer | null> {
  const { data, error } = await supabaseAdmin.storage.from(bucket).download(path);
  if (error || !data) return null;
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

interface SubjectData {
  contact: Contact;
  calls: Call[];
  appointments: Appointment[];
  optOuts: OptOutRegistryEntry[];
  auditEntries: AuditLogEntry[];
}

/**
 * Resolves the contact by identifier and pulls every related row. Reads happen
 * inside `withOrgContext` so RLS guarantees cross-org isolation. The audit_log
 * table has no RLS policy so we read it via `withSystemContext` and filter
 * on `org_id` explicitly.
 */
async function collectSubjectData(
  orgId: string,
  identifier: string,
): Promise<SubjectData> {
  const subject = await withOrgContext(orgId, async (tx) => {
    // Filter `deleted_at IS NULL` to match `resolveSubject` in erase.ts. After
    // an Article 17 erasure the contact row is tombstoned (PII scrubbed,
    // `deleted_at` set, `metadata.gdpr_erasure: true`). Without this guard a
    // subsequent Article 15 lookup by phone could surface the tombstone
    // metadata and prior call/audit ids — information the data subject is
    // entitled to be told no longer exists.
    const lookupConditions = [
      and(
        eq(contacts.org_id, orgId),
        eq(contacts.phone_e164, identifier),
        isNull(contacts.deleted_at),
      ),
    ];
    if (looksLikeEmail(identifier)) {
      lookupConditions.push(
        and(
          eq(contacts.org_id, orgId),
          eq(contacts.email, identifier),
          isNull(contacts.deleted_at),
        ),
      );
    }

    const [contact] = await tx
      .select()
      .from(contacts)
      .where(or(...lookupConditions))
      .limit(1);

    if (!contact) return null;

    const callRows = await tx
      .select()
      .from(calls)
      .where(and(eq(calls.org_id, orgId), eq(calls.contact_id, contact.id)));

    const apptRows = await tx
      .select()
      .from(appointments)
      .where(and(eq(appointments.org_id, orgId), eq(appointments.contact_id, contact.id)));

    const optOutRows = await tx
      .select()
      .from(optOutRegistry)
      .where(
        and(
          eq(optOutRegistry.org_id, orgId),
          eq(optOutRegistry.phone_e164, contact.phone_e164),
        ),
      );

    return { contact, callRows, apptRows, optOutRows };
  });

  if (!subject) throw new SubjectNotFoundError(identifier);

  // audit_log has no RLS — query system-context and filter by org_id explicitly.
  // We match entries whose subject_id is the contact id, phone, email, or any
  // of the contact's call / appointment ids. This covers contact.*,
  // opt_out.recorded, compliance.*, plus call.* and appointment.* events
  // recorded against the call/appointment id rather than the contact (which is
  // how voice tools and dispatcher write their audit rows).
  const subjectIds = [subject.contact.id, subject.contact.phone_e164];
  if (subject.contact.email) subjectIds.push(subject.contact.email);
  for (const c of subject.callRows) subjectIds.push(c.id);
  for (const a of subject.apptRows) subjectIds.push(a.id);

  const auditEntries = await withSystemContext(async (tx) =>
    tx
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.org_id, orgId), inArray(auditLog.subject_id, subjectIds))),
  );

  return {
    contact: subject.contact,
    calls: subject.callRows,
    appointments: subject.apptRows,
    optOuts: subject.optOutRows,
    auditEntries,
  };
}

function jsonBlob(value: unknown): Buffer {
  // audit_log.id is bigserial → bigint at runtime; coerce to string so the
  // archive's JSON files round-trip cleanly.
  const replacer = (_key: string, v: unknown): unknown =>
    typeof v === 'bigint' ? v.toString() : v;
  return Buffer.from(JSON.stringify(value, replacer, 2), 'utf-8');
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Builds a GDPR Article 15 export ZIP for the given identifier (phone E.164
 * or email) and returns a 7-day signed download URL. Records an audit entry
 * with action `compliance.gdpr_export`.
 *
 * @throws {SubjectNotFoundError} if no contact in `orgId` matches `identifier`.
 */
export async function buildSubjectExport(
  params: BuildSubjectExportParams,
): Promise<SubjectExportResult> {
  const { orgId, identifier, actorUserId } = params;

  const data = await collectSubjectData(orgId, identifier);

  const exportId = randomUUID();
  const timestamp = Date.now();
  const storagePath = `${orgId}/exports/gdpr-${data.contact.id}-${timestamp}.zip`;

  // Build the archive
  const zip = new JSZip();
  zip.file('contact.json', jsonBlob(data.contact));
  zip.file('calls.json', jsonBlob(data.calls));
  zip.file('appointments.json', jsonBlob(data.appointments));
  zip.file('opt_outs.json', jsonBlob(data.optOuts));
  zip.file('audit_log.json', jsonBlob(data.auditEntries));

  let recordingsBundled = 0;
  let transcriptsBundled = 0;
  for (const call of data.calls) {
    if (call.recording_path) {
      const bytes = await downloadStorageObject(CALL_MEDIA_BUCKET, call.recording_path);
      if (bytes) {
        zip.file(`recordings/${call.id}.mp3`, bytes);
        recordingsBundled += 1;
      }
    }
    if (call.transcript_path) {
      const bytes = await downloadStorageObject(CALL_MEDIA_BUCKET, call.transcript_path);
      if (bytes) {
        zip.file(`transcripts/${call.id}.json`, bytes);
        transcriptsBundled += 1;
      }
    }
  }

  const archiveBytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

  // Upload to storage
  const { error: uploadError } = await supabaseAdmin.storage
    .from(CSV_UPLOADS_BUCKET)
    .upload(storagePath, archiveBytes, {
      contentType: 'application/zip',
      upsert: true,
    });
  if (uploadError) {
    throw new Error(`GDPR export upload failed: ${uploadError.message}`);
  }

  const { data: signed, error: signError } = await supabaseAdmin.storage
    .from(CSV_UPLOADS_BUCKET)
    .createSignedUrl(storagePath, SEVEN_DAYS_SECONDS);
  if (signError || !signed?.signedUrl) {
    throw new Error(`GDPR export sign failed: ${signError?.message ?? 'unknown error'}`);
  }

  const expiresAt = new Date(Date.now() + SEVEN_DAYS_SECONDS * 1000);

  // Audit
  await withOrgContext(orgId, async (tx) => {
    await recordAudit(tx, {
      orgId,
      ...(actorUserId !== undefined ? { actorUserId } : {}),
      actorType: 'user',
      action: 'compliance.gdpr_export',
      subjectType: 'contact',
      subjectId: data.contact.id,
      metadata: {
        exportId,
        storagePath,
        identifier,
        totals: {
          calls: data.calls.length,
          appointments: data.appointments.length,
          optOuts: data.optOuts.length,
          auditEntries: data.auditEntries.length,
          recordingsBundled,
          transcriptsBundled,
        },
      },
    });
  });

  return {
    exportId,
    storagePath,
    signedUrl: signed.signedUrl,
    expiresAt,
    contactId: data.contact.id,
    totals: {
      calls: data.calls.length,
      appointments: data.appointments.length,
      optOuts: data.optOuts.length,
      auditEntries: data.auditEntries.length,
      recordingsBundled,
      transcriptsBundled,
    },
  };
}

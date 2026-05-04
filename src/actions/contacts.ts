'use server';

import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { getAuthContext, requireCapability } from '@/lib/auth/context';
import { recordAudit } from '@/lib/db/audit';
import { withOrgContext } from '@/lib/db/context';
import { sendInngestEvent } from '@/lib/inngest/client';
import {
  CONTACTS_EXPORT_REQUESTED,
  CONTACTS_IMPORT_REQUESTED,
} from '@/lib/inngest/contacts/events';
import type {
  ContactsExportRequestedData,
  ContactsImportRequestedData,
} from '@/lib/inngest/contacts/events';
import { contactsToCsv } from '@/lib/inngest/contacts/export';
import { getContactList } from '@/lib/services/contact_lists';
import { bulkMarkOptOut, listContacts, markOptOut, softDeleteContact, upsertContact } from '@/lib/services/contacts';
import type { RpoStatus } from '@/lib/services/contacts';
import { CSV_UPLOADS_BUCKET } from '@/lib/storage/signed';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { ActionResult } from '@/lib/utils/action-toast';
import { normaliseToE164 } from '@/lib/utils/phone';

const EXPORT_INLINE_LIMIT = 10_000;

const triggerSchema = z.object({
  listId: z.string().uuid(),
  storagePath: z.string().min(1),
  consentBasis: z.enum(['consent', 'legitimate_interest', 'existing_customer']),
  contactType: z.enum(['b2c', 'b2b']).optional(),
  consentEvidence: z.string().max(500).optional(),
  columnMapping: z
    .object({
      phone: z.string().min(1),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      email: z.string().optional(),
    })
    .optional(),
});

type TriggerInput = z.infer<typeof triggerSchema>;

/**
 * Fires a `contacts/import-requested` Inngest event to kick off the 7-step
 * async import pipeline. Must only be called after the CSV file has been
 * successfully uploaded to Supabase Storage.
 */
export async function triggerContactsImport(input: TriggerInput): Promise<ActionResult> {
  const parsed = triggerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'validation_error' };
  }

  try {
    const { orgId } = await getAuthContext();
    await requireCapability('contacts.upload');

    const { listId, storagePath, consentBasis, contactType, consentEvidence, columnMapping } =
      parsed.data;

    // Security: storagePath must belong to the calling org to prevent reading other orgs' files
    if (!storagePath.startsWith(`${orgId}/`)) {
      return { ok: false, message: 'storage_path_forbidden' };
    }

    // Verify the contact list belongs to the calling org
    const list = await getContactList(orgId, listId);
    if (!list) return { ok: false, message: 'list_not_found' };

    const eventData: ContactsImportRequestedData = { orgId, listId, storagePath, consentBasis };
    if (contactType !== undefined) eventData.contactType = contactType;
    if (consentEvidence) eventData.consentEvidence = consentEvidence;
    if (columnMapping !== undefined) {
      const cm: NonNullable<ContactsImportRequestedData['columnMapping']> = {
        phone: columnMapping.phone,
      };
      if (columnMapping.firstName) cm.firstName = columnMapping.firstName;
      if (columnMapping.lastName) cm.lastName = columnMapping.lastName;
      if (columnMapping.email) cm.email = columnMapping.email;
      eventData.columnMapping = cm;
    }

    await sendInngestEvent({
      name: CONTACTS_IMPORT_REQUESTED,
      data: eventData,
      id: `contacts-import-${listId}`,
    });

    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'import_trigger_failed';
    return { ok: false, message };
  }
}

// ---------------------------------------------------------------------------
// List detail actions
// ---------------------------------------------------------------------------

/**
 * Returns the current import status and counts for a contact list.
 * Used as a polling fallback when the Realtime subscription is not available.
 */
export async function getContactListStatus(listId: string): Promise<
  ActionResult & { status?: string | null; totalCount?: number; validCount?: number }
> {
  try {
    const { orgId } = await getAuthContext();
    const list = await getContactList(orgId, listId);
    if (!list) return { ok: false, message: 'list_not_found' };
    return {
      ok: true,
      status: list.import_status,
      totalCount: list.total_count,
      validCount: list.valid_count,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'error' };
  }
}

const optOutSchema = z.object({
  contactId: z.string().uuid(),
  phoneE164: z.string().min(1),
  reason: z.string().optional(),
});

/**
 * Marks a contact as opted out and records in the org opt-out registry.
 */
export async function markContactOptOut(
  input: z.infer<typeof optOutSchema>,
): Promise<ActionResult> {
  const parsed = optOutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'validation_error' };
  try {
    const { orgId } = await getAuthContext();
    await requireCapability('contacts.upload');
    await markOptOut(orgId, parsed.data.phoneE164, 'dealer_input', parsed.data.reason);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'error' };
  }
}

const deleteContactSchema = z.object({ contactId: z.string().uuid() });

/**
 * Soft-deletes a contact (sets deleted_at).
 */
export async function deleteContact(input: z.infer<typeof deleteContactSchema>): Promise<ActionResult> {
  const parsed = deleteContactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'validation_error' };
  try {
    const { orgId, userId } = await getAuthContext();
    await requireCapability('contacts.delete');
    await softDeleteContact(orgId, userId, parsed.data.contactId);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'error' };
  }
}

const bulkOptOutSchema = z.object({
  contacts: z.array(z.object({ contactId: z.string().uuid(), phoneE164: z.string().min(1) })).min(1).max(500),
});

/**
 * Marks multiple contacts as opted out.
 */
export async function bulkMarkContactsOptOut(
  input: z.infer<typeof bulkOptOutSchema>,
): Promise<ActionResult> {
  const parsed = bulkOptOutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'validation_error' };
  try {
    const { orgId } = await getAuthContext();
    await requireCapability('contacts.upload');
    await Promise.all(
      parsed.data.contacts.map(({ phoneE164 }) => markOptOut(orgId, phoneE164, 'dealer_input')),
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'error' };
  }
}

const bulkDeleteSchema = z.object({
  contactIds: z.array(z.string().uuid()).min(1).max(500),
});

/**
 * Soft-deletes multiple contacts.
 */
export async function bulkDeleteContacts(
  input: z.infer<typeof bulkDeleteSchema>,
): Promise<ActionResult> {
  const parsed = bulkDeleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'validation_error' };
  try {
    const { orgId, userId } = await getAuthContext();
    await requireCapability('contacts.delete');
    await Promise.all(
      parsed.data.contactIds.map((id) => softDeleteContact(orgId, userId, id)),
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'error' };
  }
}

const addManualContactSchema = z.object({
  listId: z.string().uuid(),
  phone: z.string().min(1),
  firstName: z.string().max(200).optional(),
  lastName: z.string().max(200).optional(),
  email: z.string().email().optional().or(z.literal('')),
  consentBasis: z.enum(['consent', 'legitimate_interest', 'existing_customer']),
  consentEvidence: z.string().max(500).optional(),
  contactType: z.enum(['b2c', 'b2b']).default('b2c'),
});

/**
 * Manually adds a single contact to a contact list via upsert.
 * Returns `inserted: true` when a new contact was created, `false` when an
 * existing contact was updated (conflict on org_id + phone_e164).
 */
export async function addManualContact(
  input: z.input<typeof addManualContactSchema>,
): Promise<ActionResult & { inserted?: boolean }> {
  const parsed = addManualContactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'validation_error' };

  const e164 = normaliseToE164(parsed.data.phone);
  if (!e164) return { ok: false, message: 'phone_invalid' };

  try {
    const { orgId } = await getAuthContext();
    await requireCapability('contacts.upload');

    const { listId, firstName, lastName, consentBasis, consentEvidence, contactType } = parsed.data;
    const email = parsed.data.email === '' ? undefined : parsed.data.email;

    const { inserted } = await upsertContact(orgId, {
      org_id: orgId,
      contact_list_id: listId,
      phone_e164: e164,
      first_name: firstName ?? null,
      last_name: lastName ?? null,
      email: email ?? null,
      consent_basis: consentBasis,
      consent_evidence: consentEvidence ?? null,
      contact_type: contactType,
    });

    return { ok: true, inserted };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'error' };
  }
}

const importDncSchema = z.object({
  csvText: z.string().min(1).max(5 * 1024 * 1024), // 5 MB text limit
});

/**
 * Imports a single-column CSV of phone numbers as opt-outs (do-not-call list).
 * Each number is normalised to E.164 then inserted into the org opt-out registry.
 * No new contact rows are created — only entries in `opt_out_registry`.
 */
export async function importDncList(
  input: z.infer<typeof importDncSchema>,
): Promise<ActionResult & { processedCount?: number; invalidCount?: number }> {
  const parsed = importDncSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'validation_error' };

  try {
    const { orgId } = await getAuthContext();
    await requireCapability('contacts.upload');

    const lines = parsed.data.csvText
      .split(/\r?\n/)
      .map((l) => l.split(',')[0]?.trim() ?? '')
      .filter(Boolean);

    // Skip header rows that are clearly column labels
    const headerPattern = /^(telefono|cellulare|numero|phone|mobile|tel)$/i;

    const validPhones: string[] = [];
    let invalidCount = 0;

    for (const raw of lines) {
      if (headerPattern.test(raw)) continue;
      const e164 = normaliseToE164(raw);
      if (!e164) {
        invalidCount++;
        continue;
      }
      validPhones.push(e164);
    }

    await bulkMarkOptOut(orgId, validPhones, 'dealer_input');

    return { ok: true, processedCount: validPhones.length, invalidCount };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'error' };
  }
}

/**
 * Returns a signed download URL for the import errors JSON artifact.
 * The file is stored at `<orgId>/uploads/<listId>-errors.json` in csv-uploads bucket.
 */
export async function getImportErrorsUrl(listId: string): Promise<ActionResult & { url?: string }> {
  try {
    const { orgId } = await getAuthContext();
    const list = await getContactList(orgId, listId);
    if (!list) return { ok: false, message: 'list_not_found' };
    const path = `${orgId}/uploads/${listId}-errors.json`;
    const { data, error } = await supabaseAdmin.storage
      .from(CSV_UPLOADS_BUCKET)
      .createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) return { ok: false, message: 'errors_file_not_found' };
    return { ok: true, url: data.signedUrl };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'error' };
  }
}

const exportFiltersSchema = z.object({
  listId: z.string().uuid().optional(),
  optOut: z.boolean().optional(),
  rpoStatus: z.enum(['clear', 'blocked', 'unchecked']).optional(),
  search: z.string().max(200).optional(),
});

/**
 * Exports contacts matching the given filters to a CSV file in Supabase Storage
 * and returns a 1-hour signed download URL.
 *
 * For <= 10,000 rows the export runs synchronously and returns `{ ok: true, url }`.
 * For > 10,000 rows the export is deferred to an Inngest function and returns
 * `{ ok: true, deferred: true, exportId }` — the caller can poll for completion.
 *
 * Every invocation records an audit log entry.
 */
export async function exportContactsCsv(
  input: z.infer<typeof exportFiltersSchema>,
): Promise<ActionResult & { url?: string; deferred?: boolean; exportId?: string }> {
  const parsed = exportFiltersSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'validation_error' };
  }

  try {
    const { orgId, userId } = await getAuthContext();
    await requireCapability('contacts.upload');

    const filters = parsed.data as {
      listId?: string;
      optOut?: boolean;
      rpoStatus?: RpoStatus;
      search?: string;
    };
    const exportId = randomUUID();

    // Probe: fetch up to EXPORT_INLINE_LIMIT rows.
    // If nextCursor is set there are more rows than the limit — defer to Inngest.
    const { items, nextCursor } = await listContacts(orgId, filters, {
      limit: EXPORT_INLINE_LIMIT,
    });
    const overLimit = nextCursor !== undefined;

    if (overLimit) {
      // Defer to Inngest for large exports
      const eventData: ContactsExportRequestedData = {
        orgId,
        exportId,
        requestedByUserId: userId,
        filters,
      };

      await sendInngestEvent({
        name: CONTACTS_EXPORT_REQUESTED,
        data: eventData,
        id: `contacts-export-${exportId}`,
      });

      // Record audit for the export request
      await withOrgContext(orgId, async (tx) => {
        await recordAudit(tx, {
          orgId,
          actorUserId: userId,
          actorType: 'user',
          action: 'contact_list.export_requested',
          subjectType: 'contact_list',
          subjectId: exportId,
          metadata: { filters, deferred: true },
        });
      });

      return { ok: true, deferred: true, exportId };
    }

    // Inline export: generate, upload, sign
    const csv = contactsToCsv(items);
    const path = `${orgId}/exports/contacts-${exportId}.csv`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from(CSV_UPLOADS_BUCKET)
      .upload(path, csv, { contentType: 'text/csv', upsert: true });

    if (uploadError) {
      console.error('[exportContactsCsv] upload failed:', uploadError.message);
      return { ok: false, message: 'export_upload_failed' };
    }

    const { data: signData, error: signError } = await supabaseAdmin.storage
      .from(CSV_UPLOADS_BUCKET)
      .createSignedUrl(path, 3600);

    if (signError ?? !signData?.signedUrl) {
      return { ok: false, message: 'export_sign_failed' };
    }

    // Record audit
    await withOrgContext(orgId, async (tx) => {
      await recordAudit(tx, {
        orgId,
        actorUserId: userId,
        actorType: 'user',
        action: 'contact_list.export_completed',
        subjectType: 'contact_list',
        subjectId: exportId,
        metadata: { rowCount: items.length, storagePath: path, filters },
      });
    });

    return { ok: true, url: signData.signedUrl, exportId };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'export_failed' };
  }
}

'use server';

import { z } from 'zod';

import { getAuthContext, requireCapability } from '@/lib/auth/context';
import { sendInngestEvent } from '@/lib/inngest/client';
import { CONTACTS_IMPORT_REQUESTED } from '@/lib/inngest/contacts/events';
import type { ContactsImportRequestedData } from '@/lib/inngest/contacts/events';
import { getContactList } from '@/lib/services/contact_lists';
import { markOptOut, softDeleteContact, upsertContact } from '@/lib/services/contacts';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { ActionResult } from '@/lib/utils/action-toast';
import { normaliseToE164 } from '@/lib/utils/phone';

const triggerSchema = z.object({
  listId: z.string().uuid(),
  storagePath: z.string().min(1),
  consentBasis: z.enum(['consent', 'legitimate_interest', 'existing_customer']),
  contactType: z.enum(['b2c', 'b2b']).optional(),
  consentEvidence: z.string().optional(),
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
      data: eventData as unknown as Record<string, unknown>,
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
  contacts: z.array(z.object({ contactId: z.string().uuid(), phoneE164: z.string().min(1) })).min(1),
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
  contactIds: z.array(z.string().uuid()).min(1),
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

/**
 * Returns a signed download URL for the import errors JSON artifact.
 * The file is stored at `<orgId>/uploads/<listId>-errors.json` in csv-uploads bucket.
 */
export async function getImportErrorsUrl(listId: string): Promise<ActionResult & { url?: string }> {
  try {
    const { orgId } = await getAuthContext();
    const path = `${orgId}/uploads/${listId}-errors.json`;
    const { data, error } = await supabaseAdmin.storage
      .from('csv-uploads')
      .createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) return { ok: false, message: 'errors_file_not_found' };
    return { ok: true, url: data.signedUrl };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'error' };
  }
}

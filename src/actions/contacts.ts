'use server';

import { z } from 'zod';

import { getAuthContext, requireCapability } from '@/lib/auth/context';
import { sendInngestEvent } from '@/lib/inngest/client';
import { CONTACTS_IMPORT_REQUESTED } from '@/lib/inngest/contacts/events';
import type { ContactsImportRequestedData } from '@/lib/inngest/contacts/events';
import type { ActionResult } from '@/lib/utils/action-toast';

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

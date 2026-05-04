/**
 * Contact CSV export processor.
 *
 * Handles the heavy export path (>10k rows) triggered by the
 * `contacts/export-requested` event via Inngest.
 *
 * Steps:
 *   1. collect   — paginate through listContacts to gather all matching rows
 *   2. generate  — serialize to CSV using papaparse unparse
 *   3. upload    — write the CSV to `<orgId>/exports/contacts-<exportId>.csv`
 *   4. audit     — record an audit log entry with row count
 *   5. notify    — emit `contacts/export-completed` with a 1-hour signed URL
 */

import Papa from 'papaparse';

import { recordAudit } from '@/lib/db/audit';
import { withOrgContext } from '@/lib/db/context';
import type { Contact } from '@/lib/db/schema';
import { sendInngestEvent } from '@/lib/inngest/client';
import { listContacts } from '@/lib/services/contacts';
import type { RpoStatus } from '@/lib/services/contacts';
import { supabaseAdmin } from '@/lib/supabase/admin';

import {
  CONTACTS_EXPORT_COMPLETED,
  type ContactsExportCompletedData,
  type ContactsExportRequestedData,
} from './events';

const CSV_BUCKET = 'csv-uploads';
const EXPORT_PAGE_SIZE = 1000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface ExportFilters {
  listId?: string;
  optOut?: boolean;
  rpoStatus?: RpoStatus;
  search?: string;
}

/**
 * Paginates through `listContacts` and returns all matching contacts.
 */
export async function collectAllContacts(orgId: string, filters: ExportFilters): Promise<Contact[]> {
  const all: Contact[] = [];
  let cursor: string | undefined;

  do {
    const page = cursor !== undefined
      ? { limit: EXPORT_PAGE_SIZE, cursor }
      : { limit: EXPORT_PAGE_SIZE };
    const { items, nextCursor } = await listContacts(orgId, filters, page);
    all.push(...items);
    cursor = nextCursor;
  } while (cursor !== undefined);

  return all;
}

/**
 * Serializes an array of Contact rows to a CSV string.
 * Only exports the columns that are useful to dealers.
 */
export function contactsToCsv(rows: Contact[]): string {
  const data = rows.map((c) => ({
    phone_e164: c.phone_e164,
    first_name: c.first_name ?? '',
    last_name: c.last_name ?? '',
    email: c.email ?? '',
    opt_out: c.opt_out ? 'yes' : 'no',
    rpo_status: c.rpo_status,
    consent_basis: c.consent_basis,
    contact_type: c.contact_type,
    created_at: c.created_at.toISOString(),
  }));

  return Papa.unparse(data, { header: true });
}

/**
 * Uploads a CSV string to Supabase Storage and returns the storage path.
 */
async function uploadExportCsv(orgId: string, exportId: string, csv: string): Promise<string> {
  const path = `${orgId}/exports/contacts-${exportId}.csv`;

  const { error } = await supabaseAdmin.storage.from(CSV_BUCKET).upload(path, csv, {
    contentType: 'text/csv',
    upsert: true,
  });

  if (error) {
    throw new Error(`Failed to upload export CSV: ${error.message}`);
  }

  return path;
}

// ─── Public processor ────────────────────────────────────────────────────────

export async function processContactsExport(
  data: ContactsExportRequestedData,
): Promise<ContactsExportCompletedData> {
  const { orgId, exportId, requestedByUserId, filters } = data;

  // Step 1: collect
  const rows = await collectAllContacts(orgId, filters);

  // Step 2: generate
  const csv = contactsToCsv(rows);

  // Step 3: upload
  const storagePath = await uploadExportCsv(orgId, exportId, csv);

  // Step 4: audit
  await withOrgContext(orgId, async (tx) => {
    await recordAudit(tx, {
      orgId,
      actorUserId: requestedByUserId,
      actorType: 'user',
      action: 'contact_list.export_completed',
      subjectType: 'contact_list',
      subjectId: exportId,
      metadata: {
        rowCount: rows.length,
        storagePath,
        filters,
      },
    });
  });

  // Step 5: notify
  const completedData: ContactsExportCompletedData = {
    orgId,
    exportId,
    storagePath,
    rowCount: rows.length,
    status: 'completed',
  };

  await sendInngestEvent({
    name: CONTACTS_EXPORT_COMPLETED,
    data: completedData as unknown as Record<string, unknown>,
    id: `contacts-export-completed-${exportId}`,
  });

  return completedData;
}

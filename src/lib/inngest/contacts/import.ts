/**
 * Contact import processor.
 *
 * Implements the 7-step pipeline described in plan 06, Task 6:
 *   1. download-file  — fetch the CSV from Supabase Storage
 *   2. parse          — run parseContactsCsv; store errors artifact
 *   3. enrich         — resolve opt-out and RPO status for each valid row
 *   4. bulk-upsert    — idempotent INSERT ... ON CONFLICT in batches of 500
 *   5. update-list    — update counts and set import_status
 *   6. audit          — record audit log entry with totals
 *   7. notify         — emit contacts/import-completed event
 *
 * The function is idempotent on (orgId, listId): re-running it after a partial
 * failure is safe because bulkUpsertContacts uses ON CONFLICT DO UPDATE and
 * updateListCounts / updateListImportStatus are pure SET operations.
 *
 * When the Inngest SDK is wired up (later plan), each step block can be wrapped
 * with `step.run(stepName, () => ...)` for built-in retries without changing
 * the business logic.
 */

import { and, eq, inArray } from 'drizzle-orm';

import { recordAudit } from '@/lib/db/audit';
import { withOrgContext, withSystemContext } from '@/lib/db/context';
import type { NewContact } from '@/lib/db/schema';
import { optOutRegistry, rpoSnapshots } from '@/lib/db/schema';
import { sendInngestEvent } from '@/lib/inngest/client';
import { updateListCounts, updateListImportStatus } from '@/lib/services/contact_lists';
import { bulkUpsertContacts, countContactsForOrg } from '@/lib/services/contacts';
import type { CsvParseResult } from '@/lib/services/csv';
import { parseContactsCsv } from '@/lib/services/csv';
import { supabaseAdmin } from '@/lib/supabase/admin';

import {
  CONTACTS_IMPORT_COMPLETED,
  type ContactsImportCompletedData,
  type ContactsImportRequestedData,
} from './events';

const CSV_BUCKET = 'csv-uploads';

// ─── Private step helpers ────────────────────────────────────────────────────

async function downloadCsvFile(storagePath: string): Promise<Buffer> {
  const { data, error } = await supabaseAdmin.storage.from(CSV_BUCKET).download(storagePath);

  if (error ?? !data) {
    throw new Error(`Failed to download CSV file at "${storagePath}": ${error?.message ?? 'no data returned'}`);
  }

  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function storeErrorsArtifact(
  orgId: string,
  listId: string,
  invalidRows: CsvParseResult['invalidRows'],
): Promise<void> {
  const path = `${orgId}/uploads/${listId}-errors.json`;
  const content = JSON.stringify(invalidRows, null, 2);

  const { error } = await supabaseAdmin.storage.from(CSV_BUCKET).upload(path, content, {
    contentType: 'application/json',
    upsert: true,
  });

  if (error) {
    // Non-fatal — log and continue so the import can still complete
    console.error(`[contacts/import] Failed to store errors artifact at "${path}": ${error.message}`);
  }
}

/**
 * Enriches each valid contact row with opt-out and RPO status resolved from
 * the live registries.  Called before bulkUpsertContacts so new contacts are
 * inserted with the correct state; existing contacts keep their DB-stored
 * values (ON CONFLICT SET does not overwrite opt_out / rpo_status).
 */
async function enrichWithOptOutAndRpo(
  orgId: string,
  validRows: NewContact[],
): Promise<NewContact[]> {
  if (validRows.length === 0) return [];

  const phones = validRows.map((r) => r.phone_e164);

  // Opt-out registry — org-scoped
  const optOutPhones = await withOrgContext(orgId, async (tx) => {
    const results = await tx
      .select({ phone_e164: optOutRegistry.phone_e164 })
      .from(optOutRegistry)
      .where(
        and(
          eq(optOutRegistry.org_id, orgId),
          inArray(optOutRegistry.phone_e164, phones),
        ),
      );
    return new Set(results.map((r) => r.phone_e164));
  });

  // RPO snapshots — system-owned, no org scope
  const rpoMap = await withSystemContext(async (tx) => {
    const results = await tx
      .select({ phone_e164: rpoSnapshots.phone_e164, is_blocked: rpoSnapshots.is_blocked })
      .from(rpoSnapshots)
      .where(inArray(rpoSnapshots.phone_e164, phones));
    return new Map(results.map((r) => [r.phone_e164, r.is_blocked]));
  });

  return validRows.map((row) => {
    const isBlocked = rpoMap.get(row.phone_e164);
    const rpoStatus =
      isBlocked === undefined ? 'unchecked' : isBlocked ? 'blocked' : 'clear';

    return {
      ...row,
      opt_out: optOutPhones.has(row.phone_e164),
      rpo_status: rpoStatus,
    };
  });
}

// ─── Public processor ────────────────────────────────────────────────────────

export async function processContactsImport(
  data: ContactsImportRequestedData,
): Promise<ContactsImportCompletedData> {
  const { orgId, listId, storagePath } = data;

  // Mark list as 'parsing' so the UI can show live progress
  await updateListImportStatus(orgId, listId, 'parsing');

  // Step 1: download-file
  const csvBuffer = await downloadCsvFile(storagePath);

  // Step 2: parse
  const parseResult = await parseContactsCsv(csvBuffer, {
    consentBasis: data.consentBasis,
    sourceListId: listId,
    orgId,
    ...(data.contactType !== undefined ? { contactType: data.contactType } : {}),
    ...(data.columnMapping !== undefined ? { columnMapping: data.columnMapping } : {}),
    ...(data.consentEvidence !== undefined ? { consentEvidence: data.consentEvidence } : {}),
  });

  if (parseResult.invalidRows.length > 0) {
    await storeErrorsArtifact(orgId, listId, parseResult.invalidRows);
  }

  // Step 3: enrich — resolve opt-out and RPO state for each valid row
  const enrichedRows = await enrichWithOptOutAndRpo(orgId, parseResult.validRows);

  // Step 4: bulk-upsert (guarded by org-level contact cap)
  const maxPerOrg =
    parseInt(process.env['CONTACTS_MAX_ROWS_PER_ORG'] ?? '1000000', 10) || 1_000_000;

  let upsertCounts = { insertedCount: 0, updatedCount: 0, skippedCount: 0 };
  if (enrichedRows.length > 0) {
    const currentOrgCount = await countContactsForOrg(orgId);
    if (currentOrgCount + enrichedRows.length > maxPerOrg) {
      await updateListImportStatus(orgId, listId, 'failed');
      throw new Error(
        `org_contact_limit_exceeded: org ${orgId} has ${currentOrgCount} contacts; adding ${enrichedRows.length} would exceed limit of ${maxPerOrg}`,
      );
    }
    upsertCounts = await bulkUpsertContacts(orgId, enrichedRows);
  }

  // Step 5: update-list
  const finalStatus: 'completed' | 'failed' =
    parseResult.validRows.length === 0 ? 'failed' : 'completed';

  await updateListCounts(orgId, listId, parseResult.totalRows, parseResult.validRows.length);
  await updateListImportStatus(orgId, listId, finalStatus);

  // Step 6: audit
  await withOrgContext(orgId, async (tx) => {
    await recordAudit(tx, {
      orgId,
      actorType: 'system',
      action: 'contact_list.import_completed',
      subjectType: 'contact_list',
      subjectId: listId,
      metadata: {
        totalRows: parseResult.totalRows,
        validRows: parseResult.validRows.length,
        invalidRows: parseResult.invalidRows.length,
        insertedCount: upsertCounts.insertedCount,
        updatedCount: upsertCounts.updatedCount,
        status: finalStatus,
      },
    });
  });

  // Step 7: notify
  const completedData: ContactsImportCompletedData = {
    orgId,
    listId,
    totalRows: parseResult.totalRows,
    validRows: parseResult.validRows.length,
    invalidRows: parseResult.invalidRows.length,
    insertedCount: upsertCounts.insertedCount,
    updatedCount: upsertCounts.updatedCount,
    status: finalStatus,
  };

  await sendInngestEvent({
    name: CONTACTS_IMPORT_COMPLETED,
    data: completedData as unknown as Record<string, unknown>,
    id: `contacts-import-completed-${listId}`,
  });

  return completedData;
}

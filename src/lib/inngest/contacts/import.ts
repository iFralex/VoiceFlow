/**
 * Contact import processor.
 *
 * Implements the pipeline described in plan 06 (Task 6) and plan 11 (Task 3):
 *   1. download-file   — fetch the CSV from Supabase Storage
 *   2. parse           — run parseContactsCsv; store errors artifact
 *   3. enrich          — resolve opt-out and RPO status for each valid row
 *   4. bulk-upsert     — idempotent INSERT ... ON CONFLICT in batches of 500
 *   5. rpo-batch-check — live RPO bulkCheck for newly-inserted unchecked B2C
 *   6. update-list     — update counts and set import_status
 *   7. audit           — record audit log entry with totals
 *   8. notify          — emit contacts/import-completed event
 *
 * The function is idempotent on (orgId, listId): re-running it after a partial
 * failure is safe because bulkUpsertContacts uses ON CONFLICT DO UPDATE and
 * updateListCounts / updateListImportStatus are pure SET operations.
 *
 * When the Inngest SDK is wired up (later plan), each step block can be wrapped
 * with `step.run(stepName, () => ...)` for built-in retries without changing
 * the business logic.
 */

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { getRpoClient, type RpoClient } from '@/lib/compliance/rpo/client';
import { recordAudit } from '@/lib/db/audit';
import { withOrgContext, withSystemContext } from '@/lib/db/context';
import type { NewContact } from '@/lib/db/schema';
import { contacts, optOutRegistry, rpoSnapshots } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { sendInngestEvent } from '@/lib/inngest/client';
import { updateListCounts, updateListImportStatus } from '@/lib/services/contact_lists';
import { bulkUpsertContacts, countContactsForOrg } from '@/lib/services/contacts';
import type { CsvParseResult } from '@/lib/services/csv';
import { parseContactsCsv } from '@/lib/services/csv';
import { bulkMarkOptOut } from '@/lib/services/optout';
import { CSV_UPLOADS_BUCKET as CSV_BUCKET } from '@/lib/storage/signed';
import { supabaseAdmin } from '@/lib/supabase/admin';

import {
  CONTACTS_IMPORT_COMPLETED,
  type ContactsImportCompletedData,
  type ContactsImportRequestedData,
} from './events';

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
const ENRICH_BATCH_SIZE = 500;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function enrichWithOptOutAndRpo(
  orgId: string,
  validRows: NewContact[],
): Promise<NewContact[]> {
  if (validRows.length === 0) return [];

  const phones = validRows.map((r) => r.phone_e164);
  const phoneChunks = chunkArray(phones, ENRICH_BATCH_SIZE);

  // Opt-out registry — org-scoped; query in batches to stay within PG parameter limit
  const optOutPhones = new Set<string>();
  for (const chunk of phoneChunks) {
    await withOrgContext(orgId, async (tx) => {
      const results = await tx
        .select({ phone_e164: optOutRegistry.phone_e164 })
        .from(optOutRegistry)
        .where(
          and(
            eq(optOutRegistry.org_id, orgId),
            inArray(optOutRegistry.phone_e164, chunk),
          ),
        );
      for (const r of results) optOutPhones.add(r.phone_e164);
    });
  }

  // RPO snapshots — system-owned, no org scope; same batching
  const rpoMap = new Map<string, boolean>();
  for (const chunk of phoneChunks) {
    await withSystemContext(async (tx) => {
      const results = await tx
        .select({ phone_e164: rpoSnapshots.phone_e164, is_blocked: rpoSnapshots.is_blocked })
        .from(rpoSnapshots)
        .where(inArray(rpoSnapshots.phone_e164, chunk));
      for (const r of results) rpoMap.set(r.phone_e164, r.is_blocked);
    });
  }

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

/**
 * Live batch RPO check for the import's newly-inserted B2C contacts.
 *
 * Runs after `bulk-upsert`: any row left at `rpo_status='unchecked'` is a
 * phone number we have never seen before. We hit the RPO intermediary, write
 * fresh entries into `rpo_snapshots`, and propagate the result back into the
 * org's `contacts` rows.
 *
 * Failure-tolerant: if `getRpoClient()` throws (mis-configured) or any chunk
 * fails (network, intermediary outage), we log a warning, keep the contact
 * `rpo_status='unchecked'`, and let the per-call live check at dispatch time
 * (plan 11 Task 4) act as the safety net. The import never fails on RPO.
 */

interface RpoBatchCheckResult {
  checked: number;
  blocked: number;
  clear: number;
  errors: number;
  skipped: boolean;
}

const RPO_BATCH_CHUNK_SIZE = 500;

async function performBatchRpoCheck(
  orgId: string,
  listId: string,
): Promise<RpoBatchCheckResult> {
  let rpoClient: RpoClient;
  try {
    rpoClient = getRpoClient();
  } catch (e) {
    console.warn(
      `[contacts/import] RPO client unavailable; skipping batch RPO check: ${e instanceof Error ? e.message : String(e)}`,
    );
    return { checked: 0, blocked: 0, clear: 0, errors: 1, skipped: true };
  }

  // Newly-inserted B2C contacts whose phone wasn't already in rpo_snapshots
  // surface here as rpo_status='unchecked'. Re-imports of already-known
  // phones keep their existing status (ON CONFLICT preserves it).
  const phones = await withOrgContext(orgId, async (tx) => {
    const rows = await tx
      .selectDistinct({ phone_e164: contacts.phone_e164 })
      .from(contacts)
      .where(
        and(
          eq(contacts.org_id, orgId),
          eq(contacts.contact_list_id, listId),
          eq(contacts.contact_type, 'b2c'),
          eq(contacts.rpo_status, 'unchecked'),
          isNull(contacts.deleted_at),
        ),
      );
    return rows.map((r) => r.phone_e164);
  });

  if (phones.length === 0) {
    return { checked: 0, blocked: 0, clear: 0, errors: 0, skipped: false };
  }

  let checked = 0;
  let blocked = 0;
  let clear = 0;
  let errors = 0;

  for (const chunk of chunkArray(phones, RPO_BATCH_CHUNK_SIZE)) {
    let result: Map<string, boolean>;
    try {
      result = await rpoClient.bulkCheck(chunk);
    } catch (e) {
      console.warn(
        `[contacts/import] RPO bulkCheck failed for chunk; dispatch-time safety net will cover: ${e instanceof Error ? e.message : String(e)}`,
      );
      errors += 1;
      continue;
    }

    const checkedAt = new Date();
    const blockedNow: string[] = [];
    const clearNow: string[] = [];
    for (const phone of chunk) {
      if (result.get(phone) === true) blockedNow.push(phone);
      else clearNow.push(phone);
    }

    await withSystemContext(async (tx) => {
      await tx
        .insert(rpoSnapshots)
        .values(
          chunk.map((phone) => ({
            phone_e164: phone,
            is_blocked: result.get(phone) ?? false,
            last_checked_at: checkedAt,
          })),
        )
        .onConflictDoUpdate({
          target: rpoSnapshots.phone_e164,
          set: {
            is_blocked: sql`excluded.is_blocked`,
            last_checked_at: sql`excluded.last_checked_at`,
          },
        });
    });

    await withOrgContext(orgId, async (tx) => {
      if (clearNow.length > 0) {
        await tx
          .update(contacts)
          .set({ rpo_status: 'clear', rpo_checked_at: checkedAt })
          .where(
            and(
              eq(contacts.org_id, orgId),
              inArray(contacts.phone_e164, clearNow),
              isNull(contacts.deleted_at),
            ),
          );
      }
      if (blockedNow.length > 0) {
        await tx
          .update(contacts)
          .set({ rpo_status: 'blocked', rpo_checked_at: checkedAt })
          .where(
            and(
              eq(contacts.org_id, orgId),
              inArray(contacts.phone_e164, blockedNow),
              isNull(contacts.deleted_at),
            ),
          );
      }
    });

    // Plan 11 task 5: route every newly-detected RPO block through the
    // unified opt-out registry. Without this, contacts blocked at import
    // time would only carry `rpo_status='blocked'` — they would never be
    // enrolled in `opt_out_registry` and the dispatch-time RPO check
    // would mark each call `rpo_blocked` without ever notifying the
    // dealer, diverging from the daily-snapshot behaviour.
    if (blockedNow.length > 0) {
      await bulkMarkOptOut(orgId, blockedNow, 'rpo_block');
    }

    checked += chunk.length;
    blocked += blockedNow.length;
    clear += clearNow.length;
  }

  return { checked, blocked, clear, errors, skipped: false };
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
  const maxPerOrg = env.CONTACTS_MAX_ROWS_PER_ORG;

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

  // Step 5: rpo-batch-check — live RPO check for newly-inserted B2C contacts
  const rpoResult = await performBatchRpoCheck(orgId, listId);

  // Step 6: update-list
  const finalStatus: 'completed' | 'failed' =
    parseResult.validRows.length === 0 ? 'failed' : 'completed';

  await updateListCounts(orgId, listId, parseResult.totalRows, parseResult.validRows.length);
  await updateListImportStatus(orgId, listId, finalStatus);

  // Step 7: audit
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
        rpoChecked: rpoResult.checked,
        rpoBlocked: rpoResult.blocked,
        rpoClear: rpoResult.clear,
        rpoErrors: rpoResult.errors,
        rpoSkipped: rpoResult.skipped,
      },
    });
  });

  // Step 8: notify
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
    data: completedData,
    id: `contacts-import-completed-${listId}`,
  });

  return completedData;
}

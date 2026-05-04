/**
 * Integration tests for the contacts CSV import pipeline.
 *
 * These tests verify end-to-end behaviour of CSV parsing, bulk ingestion,
 * idempotency, the opt-out registry, soft-delete unique-index semantics, and
 * the storage signed-URL org-scoping enforcement.
 *
 * Prerequisites:
 *   docker compose -f infra/test/docker-compose.yml up -d
 *   DATABASE_DIRECT_URL=postgresql://postgres:postgres@localhost:5433/vox_auto_test \
 *     pnpm db:migrate
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/vox_auto_test
 *
 * Tests are skipped automatically when TEST_DATABASE_URL is not set so that
 * CI jobs without a database do not fail.
 */

import { and, count, eq, isNull, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { contactLists, contacts, optOutRegistry, organizations } from '@/lib/db/schema';
import { parseContactsCsv } from '@/lib/services/csv';
import { withTestDb } from '@/test/db';

// ── vi.mock must be at the top level (vitest hoists it) ─────────────────────
// Mock the auth context so storage helper tests can run outside a Next.js
// request lifecycle.
vi.mock('@/lib/auth/context', () => ({
  getAuthContext: vi.fn(),
  requireCapability: vi.fn(),
}));

// Mock supabaseAdmin so that importing @/lib/storage/signed does not attempt
// to create a real Supabase client (which would fail without env vars in CI).
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    storage: {
      from: vi.fn().mockReturnValue({
        createSignedUrl: vi.fn(),
        createSignedUploadUrl: vi.fn(),
      }),
    },
  },
}));

// ── Constants ────────────────────────────────────────────────────────────────

// Using 4x prefix to avoid collisions with other integration test files
const TEST_ORG = '40000000-0000-0000-0000-000000000001';
const TEST_LIST = '40000000-0000-0000-0000-000000000002';
const OTHER_ORG = '50000000-0000-0000-0000-000000000099';

const skipWhenNoDb = !process.env['TEST_DATABASE_URL'];

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generates a CSV string with Italian mobile phone numbers.
 * @param validCount   Number of valid rows to include
 * @param invalidCount Number of intentionally malformed phone rows to append
 */
function makeCsv(validCount: number, invalidCount = 0): string {
  const lines = ['telefono,nome,cognome'];
  for (let i = 0; i < validCount; i++) {
    // Italian mobile: +39 333 XXXXXXX (10-digit national number)
    const suffix = String(i).padStart(7, '0');
    lines.push(`+39333${suffix},Mario,Rossi${i}`);
  }
  for (let i = 0; i < invalidCount; i++) {
    lines.push(`NOT_A_PHONE_${i},Bad,Row`);
  }
  return lines.join('\n');
}

async function seedOrg(tx: Parameters<Parameters<typeof withTestDb>[0]>[0]): Promise<void> {
  await tx.insert(organizations).values({
    id: TEST_ORG,
    name: 'Integration Test Org',
    country: 'IT',
    timezone: 'Europe/Rome',
  });
}

async function seedList(tx: Parameters<Parameters<typeof withTestDb>[0]>[0]): Promise<void> {
  await tx.insert(contactLists).values({
    id: TEST_LIST,
    org_id: TEST_ORG,
    name: 'Test List',
    source: 'csv-upload',
    total_count: 0,
    valid_count: 0,
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('contacts CSV import pipeline — integration', () => {
  /**
   * Test 1: A 5,000-row CSV parses and ingests within 60 seconds.
   *
   * Verifies that the parsing step + batch insertion of 5,000 contacts
   * completes inside the 60-second SLA required by the plan.
   */
  it.skipIf(skipWhenNoDb)(
    '5,000-row CSV parses and bulk-ingests into the DB within 60s',
    async () => {
      const ROW_COUNT = 5_000;
      const BATCH = 500;

      const start = Date.now();

      // 1. Parse — no DB needed
      const csv = makeCsv(ROW_COUNT);
      const result = await parseContactsCsv(csv, {
        consentBasis: 'existing_customer',
        sourceListId: TEST_LIST,
        orgId: TEST_ORG,
      });

      expect(result.totalRows).toBe(ROW_COUNT);
      expect(result.validRows).toHaveLength(ROW_COUNT);
      expect(result.invalidRows).toHaveLength(0);

      // 2. Ingest into the DB in 500-row batches (mirrors bulkUpsertContacts)
      await withTestDb(async (tx) => {
        await seedOrg(tx);
        await seedList(tx);

        for (let i = 0; i < result.validRows.length; i += BATCH) {
          await tx.insert(contacts).values(result.validRows.slice(i, i + BATCH));
        }

        // Verify all rows landed
        const [row] = await tx
          .select({ total: count() })
          .from(contacts)
          .where(and(eq(contacts.org_id, TEST_ORG), isNull(contacts.deleted_at)));

        expect(row!.total).toBe(ROW_COUNT);
      });

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(60_000);
    },
    60_000, // vitest per-test timeout (ms)
  );

  /**
   * Test 2: Re-uploading the same CSV leaves zero new rows (idempotency).
   *
   * The contacts table has a partial unique index on (org_id, phone_e164)
   * WHERE deleted_at IS NULL. A second upload using ON CONFLICT DO UPDATE
   * must not increase the row count.
   */
  it.skipIf(skipWhenNoDb)(
    're-upload of the same CSV results in zero new rows (ON CONFLICT idempotency)',
    async () => {
      const ROW_COUNT = 100;
      const csv = makeCsv(ROW_COUNT);
      const result = await parseContactsCsv(csv, {
        consentBasis: 'existing_customer',
        sourceListId: TEST_LIST,
        orgId: TEST_ORG,
      });

      expect(result.validRows).toHaveLength(ROW_COUNT);

      await withTestDb(async (tx) => {
        await seedOrg(tx);
        await seedList(tx);

        // First upload
        await tx.insert(contacts).values(result.validRows);

        const [afterFirst] = await tx
          .select({ total: count() })
          .from(contacts)
          .where(and(eq(contacts.org_id, TEST_ORG), isNull(contacts.deleted_at)));

        expect(afterFirst!.total).toBe(ROW_COUNT);

        // Second upload — identical rows, using ON CONFLICT DO UPDATE
        await tx
          .insert(contacts)
          .values(result.validRows)
          .onConflictDoUpdate({
            target: [contacts.org_id, contacts.phone_e164],
            targetWhere: isNull(contacts.deleted_at),
            set: {
              first_name: sql`excluded.first_name`,
              last_name: sql`excluded.last_name`,
              email: sql`excluded.email`,
              consent_basis: sql`excluded.consent_basis`,
              consent_evidence: sql`excluded.consent_evidence`,
              contact_type: sql`excluded.contact_type`,
              metadata: sql`excluded.metadata`,
            },
          });

        const [afterSecond] = await tx
          .select({ total: count() })
          .from(contacts)
          .where(and(eq(contacts.org_id, TEST_ORG), isNull(contacts.deleted_at)));

        // Row count must be unchanged — no duplicates inserted
        expect(afterSecond!.total).toBe(ROW_COUNT);
      });
    },
  );

  /**
   * Test 3: Malformed phone numbers appear in invalidRows (no DB required).
   *
   * The CSV parser must report each unrecognisable phone in the invalidRows
   * array with a human-readable Italian error message.
   */
  it('rows with malformed phones are reported in invalidRows', async () => {
    const VALID = 10;
    const INVALID = 5;
    const csv = makeCsv(VALID, INVALID);

    const result = await parseContactsCsv(csv, {
      consentBasis: 'existing_customer',
      sourceListId: TEST_LIST,
      orgId: TEST_ORG,
    });

    expect(result.totalRows).toBe(VALID + INVALID);
    expect(result.validRows).toHaveLength(VALID);
    expect(result.invalidRows).toHaveLength(INVALID);

    for (const invalid of result.invalidRows) {
      const hasPhoneError = invalid.errors.some((e) =>
        e.includes('Numero di telefono non valido'),
      );
      expect(hasPhoneError).toBe(true);
      // Verify the raw value is preserved for the errors artifact
      expect(invalid.raw['telefono']).toMatch(/^NOT_A_PHONE_/);
    }
  });

  /**
   * Test 4: An invalid org_id in the storage path is rejected by getDownloadUrl.
   *
   * The helper must throw a Forbidden error when the first path segment does
   * not match the caller's orgId from the auth context.
   */
  it('invalid org_id in storage path is rejected by getDownloadUrl', async () => {
    const CALLER_ORG = TEST_ORG;

    // Configure the mocked getAuthContext to return the caller's org
    const { getAuthContext } = await import('@/lib/auth/context');
    vi.mocked(getAuthContext).mockResolvedValueOnce({
      userId: 'test-user-id',
      orgId: CALLER_ORG,
      role: 'owner',
    });

    // Import storage helper after mock is set up
    const { getDownloadUrl } = await import('@/lib/storage/signed');

    // Path belongs to OTHER_ORG — caller is in TEST_ORG → must be rejected
    await expect(
      getDownloadUrl(`${OTHER_ORG}/exports/contacts-test.csv`, 300),
    ).rejects.toThrow(
      `Forbidden: path belongs to org '${OTHER_ORG}', caller is in org '${CALLER_ORG}'`,
    );
  });

  /**
   * Test 5: Opt-out registry import does not create contact rows.
   *
   * Importing a do-not-call list via markOptOut (or direct insert) must only
   * write to opt_out_registry — no rows should appear in the contacts table.
   */
  it.skipIf(skipWhenNoDb)(
    'opt-out registry import does not create contact rows',
    async () => {
      const DNC_PHONES = ['+393330001000', '+393330001001', '+393330001002'];

      await withTestDb(async (tx) => {
        await seedOrg(tx);

        // Insert opt-out entries directly (mirrors what markOptOut does)
        await tx.insert(optOutRegistry).values(
          DNC_PHONES.map((phone_e164) => ({
            org_id: TEST_ORG,
            phone_e164,
            source: 'dealer_input' as const,
          })),
        );

        // Opt-out registry should have exactly the entries we inserted
        const optOutRows = await tx
          .select()
          .from(optOutRegistry)
          .where(eq(optOutRegistry.org_id, TEST_ORG));

        expect(optOutRows).toHaveLength(DNC_PHONES.length);
        for (const row of optOutRows) {
          expect(DNC_PHONES).toContain(row.phone_e164);
        }

        // No contact rows should exist for this org
        const [contactCount] = await tx
          .select({ total: count() })
          .from(contacts)
          .where(eq(contacts.org_id, TEST_ORG));

        expect(contactCount!.total).toBe(0);
      });
    },
  );

  /**
   * Test 6: The partial unique index on (org_id, phone_e164) WHERE deleted_at IS NULL
   * allows re-inserting a phone number that was previously soft-deleted.
   *
   * This is the expected behaviour: a contact can be re-imported after deletion,
   * resulting in two rows for the same phone — one with deleted_at set, one active.
   */
  it.skipIf(skipWhenNoDb)(
    '(org_id, phone_e164) partial unique index allows re-insert after soft-delete',
    async () => {
      const PHONE = '+393330009999';

      await withTestDb(async (tx) => {
        await seedOrg(tx);
        await seedList(tx);

        // 1. Insert the contact
        const [first] = await tx
          .insert(contacts)
          .values({
            org_id: TEST_ORG,
            contact_list_id: TEST_LIST,
            phone_e164: PHONE,
            consent_basis: 'existing_customer',
          })
          .returning({ id: contacts.id });

        expect(first).toBeDefined();

        // 2. Soft-delete it (mirrors softDeleteContact)
        await tx
          .update(contacts)
          .set({ deleted_at: new Date() })
          .where(eq(contacts.id, first!.id));

        // 3. Re-insert the same phone — the partial index only covers
        //    rows WHERE deleted_at IS NULL, so this must succeed
        const [second] = await tx
          .insert(contacts)
          .values({
            org_id: TEST_ORG,
            contact_list_id: TEST_LIST,
            phone_e164: PHONE,
            consent_basis: 'consent',
          })
          .returning({ id: contacts.id });

        expect(second).toBeDefined();
        expect(second!.id).not.toBe(first!.id);

        // 4. Two rows now exist: one deleted, one active
        const allRows = await tx
          .select()
          .from(contacts)
          .where(
            and(eq(contacts.org_id, TEST_ORG), eq(contacts.phone_e164, PHONE)),
          );

        expect(allRows).toHaveLength(2);

        const activeRows = allRows.filter((r) => r.deleted_at === null);
        const deletedRows = allRows.filter((r) => r.deleted_at !== null);

        expect(activeRows).toHaveLength(1);
        expect(deletedRows).toHaveLength(1);

        // The newly inserted row should use the updated consent basis
        expect(activeRows[0]!.consent_basis).toBe('consent');
      });
    },
  );
});

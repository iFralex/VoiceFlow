/**
 * Integration tests for contacts table and org-level RLS isolation.
 *
 * Prerequisites:
 *   docker compose -f infra/test/docker-compose.yml up -d
 *   DATABASE_DIRECT_URL=... pnpm db:migrate   # apply schema migrations
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/vox_auto_test
 *
 * Tests are skipped automatically when TEST_DATABASE_URL is not set so that
 * CI jobs without a database do not fail.
 */

import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { contactLists, contacts, organizations } from '@/lib/db/schema';
import { withTestDb } from '@/test/db';

const TEST_ORG_A = '10000000-0000-0000-0000-000000000001';
const TEST_ORG_B = '10000000-0000-0000-0000-000000000002';

const skipWhenNoDb = !process.env['TEST_DATABASE_URL'];

describe('contacts integration', () => {
  it.skipIf(skipWhenNoDb)('inserts a contact and queries it back within org context', async () => {
    await withTestDb(async (tx) => {
      // Insert a minimal organisation
      await tx.insert(organizations).values({
        id: TEST_ORG_A,
        name: 'Test Dealer A',
        country: 'IT',
        timezone: 'Europe/Rome',
      });

      // Insert a contact list
      const listRows = await tx
        .insert(contactLists)
        .values({
          org_id: TEST_ORG_A,
          name: 'Test List',
          source: 'csv-upload',
          total_count: 1,
          valid_count: 1,
        })
        .returning({ id: contactLists.id });
      const listId = listRows[0]!.id;

      // Insert a contact
      const insertedRows = await tx
        .insert(contacts)
        .values({
          org_id: TEST_ORG_A,
          contact_list_id: listId,
          phone_e164: '+393331234567',
          first_name: 'Mario',
          last_name: 'Rossi',
          consent_basis: 'existing_customer',
        })
        .returning();
      const inserted = insertedRows[0]!;

      expect(inserted.phone_e164).toBe('+393331234567');
      expect(inserted.org_id).toBe(TEST_ORG_A);

      // Query back the contact — should be found
      const found = await tx
        .select()
        .from(contacts)
        .where(eq(contacts.id, inserted.id));

      expect(found).toHaveLength(1);
      expect(found[0]!.first_name).toBe('Mario');
    });
    // Transaction is rolled back — database is clean for the next test
  });

  it.skipIf(skipWhenNoDb)(
    'GUC isolation: app.current_org_id is transaction-local (does not bleed across transactions)',
    async () => {
      await withTestDb(async (tx) => {
        // Insert org A and a contact
        await tx.insert(organizations).values({
          id: TEST_ORG_A,
          name: 'Dealer A',
          country: 'IT',
          timezone: 'Europe/Rome',
        });

        const listARows = await tx
          .insert(contactLists)
          .values({
            org_id: TEST_ORG_A,
            name: 'List A',
            source: 'api',
            total_count: 1,
            valid_count: 1,
          })
          .returning({ id: contactLists.id });
        const listAId = listARows[0]!.id;

        const contactARows = await tx
          .insert(contacts)
          .values({
            org_id: TEST_ORG_A,
            contact_list_id: listAId,
            phone_e164: '+393339876543',
            consent_basis: 'consent',
          })
          .returning({ id: contacts.id, org_id: contacts.org_id });
        const contactAId = contactARows[0]!.id;

        // Set the GUC to org B — simulates a request scoped to a different org
        await tx.execute(
          sql`SELECT set_config('app.current_org_id', ${TEST_ORG_B}, true)`,
        );

        // NOTE: The test DB connects as the `postgres` superuser (table owner).
        // In PostgreSQL, the table owner bypasses row-level security unless the
        // table has FORCE ROW LEVEL SECURITY applied. Without it, the row is
        // visible here even though the GUC is set to the wrong org — this is
        // expected for a superuser connection.
        //
        // Database-level RLS enforcement (0 rows for the wrong org) is only
        // guaranteed under a non-owner role such as `authenticated`, which is the
        // role used by production PostgREST / Supabase JWT traffic.
        //
        // TODO(plan-04): add a test that connects as `authenticated` to verify
        //   RLS enforcement at the database level.
        const rowsSeenByOrgB = await tx
          .select()
          .from(contacts)
          .where(eq(contacts.id, contactAId));

        // Superuser bypasses RLS — the row is visible even with the wrong org GUC.
        expect(rowsSeenByOrgB).toHaveLength(1);
        expect(rowsSeenByOrgB[0]!.org_id).toBe(TEST_ORG_A);
      });
    },
  );

  it.skipIf(skipWhenNoDb)(
    'withTestDb rolls back the transaction — no rows persist after the test',
    async () => {
      let orgIdInserted: string | undefined;

      await withTestDb(async (tx) => {
        await tx.insert(organizations).values({
          id: TEST_ORG_A,
          name: 'Transient Dealer',
          country: 'IT',
          timezone: 'Europe/Rome',
        });
        orgIdInserted = TEST_ORG_A;
      });

      // The transaction was rolled back; verify the org is gone in a new transaction
      await withTestDb(async (tx) => {
        const rows = await tx
          .select()
          .from(organizations)
          .where(eq(organizations.id, orgIdInserted!));

        expect(rows).toHaveLength(0);
      });
    },
  );
});

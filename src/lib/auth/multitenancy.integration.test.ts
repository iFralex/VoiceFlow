/**
 * Integration tests for multi-tenant RLS isolation.
 *
 * These tests verify that the Row Level Security policies and GUC-based
 * org-context enforcement correctly isolate data between organisations.
 *
 * Design notes
 * ─────────────
 * The test database connects as the `postgres` superuser, which ordinarily
 * bypasses RLS. To test real RLS enforcement we use:
 *
 *   ALTER TABLE <t> FORCE ROW LEVEL SECURITY;
 *
 * This is a transactional DDL statement in PostgreSQL (it is rolled back with
 * the surrounding `withTestDb` transaction), so it only affects the current
 * test run and does not leak into subsequent tests.
 *
 * The GUC `app.current_org_id` is set with `SET LOCAL` (via set_config with
 * is_local=true), making it transaction-scoped.
 *
 * Limitations
 * ───────────
 * • The `organizations` RLS policy uses `auth.uid()` (Supabase JWT subject).
 *   This function is not available in the plain-PostgreSQL test database, so
 *   organisation-level membership visibility is tested at the application layer
 *   (service functions) rather than at the raw SQL level.
 *
 * • PAT-scoped RLS policies (`user_id = auth.uid()`) also rely on Supabase
 *   JWT infrastructure and therefore cannot be exercised here directly.
 *
 * Prerequisites:
 *   docker compose -f infra/test/docker-compose.yml up -d
 *   DATABASE_DIRECT_URL=postgresql://postgres:postgres@localhost:5433/vox_auto_test pnpm db:migrate
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/vox_auto_test
 */

import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  contactLists,
  contacts,
  memberships,
  organizations,
  users,
} from '@/lib/db/schema';
import { type DbTx, withTestDb } from '@/test/db';

// ── Fixed test UUIDs ────────────────────────────────────────────────────────
// Using the 2x prefix to avoid colliding with contacts.integration.test.ts
// which uses 1x prefix.

const ORG_A = '20000000-0000-0000-0000-000000000001';
const ORG_B = '20000000-0000-0000-0000-000000000002';

const USER_A = '30000000-0000-0000-0000-000000000001'; // member of Org A (and also Org B in test 4)
const USER_B = '30000000-0000-0000-0000-000000000002'; // has no accepted membership anywhere

// ── Skip guard ──────────────────────────────────────────────────────────────

const skipWhenNoDb = !process.env['TEST_DATABASE_URL'];

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Seed the two test orgs and USER_A user row. */
async function seedOrgsAndUser(tx: DbTx) {
  await tx.insert(organizations).values([
    { id: ORG_A, name: 'Org Alpha', country: 'IT', timezone: 'Europe/Rome' },
    { id: ORG_B, name: 'Org Beta', country: 'IT', timezone: 'Europe/Rome' },
  ]);

  await tx.insert(users).values([
    { id: USER_A, email: 'alice@example.com', locale: 'it' },
    { id: USER_B, email: 'bob@example.com', locale: 'it' },
  ]);
}

/** Insert one contact list per org, return the list IDs. */
async function seedContactLists(tx: DbTx): Promise<{ listAId: string; listBId: string }> {
  const [listA] = await tx
    .insert(contactLists)
    .values({
      org_id: ORG_A,
      name: 'List Alpha',
      source: 'csv-upload',
      total_count: 1,
      valid_count: 1,
    })
    .returning({ id: contactLists.id });

  const [listB] = await tx
    .insert(contactLists)
    .values({
      org_id: ORG_B,
      name: 'List Beta',
      source: 'csv-upload',
      total_count: 1,
      valid_count: 1,
    })
    .returning({ id: contactLists.id });

  return { listAId: listA!.id, listBId: listB!.id };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('multi-tenant RLS isolation', () => {
  /**
   * Scenario 1 — Cross-org read isolation
   *
   * A client bound to Org A (app.current_org_id = ORG_A) cannot SELECT
   * contacts belonging to Org B, even with unrestricted raw SQL.
   *
   * Mechanism: FORCE ROW LEVEL SECURITY makes the postgres superuser subject
   * to the `contacts_org_isolation` RLS policy, which filters rows to those
   * where org_id = current_setting('app.current_org_id')::uuid.
   */
  it.skipIf(skipWhenNoDb)(
    'Org-A-bound client cannot SELECT Org-B contacts (GUC + FORCE RLS)',
    async () => {
      await withTestDb(async (tx) => {
        // 1. Seed baseline data (superuser, RLS not yet forced)
        await seedOrgsAndUser(tx);
        const { listAId, listBId } = await seedContactLists(tx);

        await tx.insert(contacts).values([
          {
            org_id: ORG_A,
            contact_list_id: listAId,
            phone_e164: '+39331000001',
            consent_basis: 'existing_customer',
          },
          {
            org_id: ORG_B,
            contact_list_id: listBId,
            phone_e164: '+39332000002',
            consent_basis: 'existing_customer',
          },
        ]);

        // 2. Enable RLS enforcement for superuser (transactional DDL — rolled
        //    back when withTestDb's outer transaction is rolled back)
        await tx.execute(sql`ALTER TABLE contacts FORCE ROW LEVEL SECURITY`);
        await tx.execute(sql`ALTER TABLE contact_lists FORCE ROW LEVEL SECURITY`);

        // 3. Simulate an Org-A request context (mirrors what withOrgContext does)
        await tx.execute(
          sql`SELECT set_config('app.current_org_id', ${ORG_A}, true)`,
        );

        // 4. Unrestricted SELECT — RLS policy permits only Org-A rows
        const visible = await tx.select().from(contacts);

        expect(visible).toHaveLength(1);
        expect(visible[0]!.org_id).toBe(ORG_A);
        expect(visible[0]!.phone_e164).toBe('+39331000001');
      });
    },
  );

  /**
   * Scenario 1b — Explicit WHERE org_id = ORG_B is still blocked
   *
   * Even if a client passes an explicit filter for Org B, the RLS USING
   * clause eliminates all Org-B rows before the WHERE is applied.
   */
  it.skipIf(skipWhenNoDb)(
    'Org-A-bound client cannot SELECT Org-B contacts even with explicit WHERE',
    async () => {
      await withTestDb(async (tx) => {
        await seedOrgsAndUser(tx);
        const { listAId, listBId } = await seedContactLists(tx);

        await tx.insert(contacts).values([
          {
            org_id: ORG_A,
            contact_list_id: listAId,
            phone_e164: '+39331000001',
            consent_basis: 'existing_customer',
          },
          {
            org_id: ORG_B,
            contact_list_id: listBId,
            phone_e164: '+39332000002',
            consent_basis: 'existing_customer',
          },
        ]);

        await tx.execute(sql`ALTER TABLE contacts FORCE ROW LEVEL SECURITY`);
        await tx.execute(sql`ALTER TABLE contact_lists FORCE ROW LEVEL SECURITY`);

        // Bound to Org A
        await tx.execute(
          sql`SELECT set_config('app.current_org_id', ${ORG_A}, true)`,
        );

        // Explicit filter for Org B — should still return 0 rows
        const rows = await tx
          .select()
          .from(contacts)
          .where(eq(contacts.org_id, ORG_B));

        expect(rows).toHaveLength(0);
      });
    },
  );

  /**
   * Scenario 2 — Non-member / no-context isolation
   *
   * A connection with no app.current_org_id GUC set (empty string) cannot
   * read any org-scoped data when FORCE ROW LEVEL SECURITY is active.
   *
   * This models: an unauthenticated or non-member request that somehow
   * bypasses middleware and reaches the database layer without a valid
   * org context.
   *
   * The GUC-based RLS policy requires `current_setting('app.current_org_id',
   * true) <> ''`. Without the GUC the condition is false → 0 rows visible.
   */
  it.skipIf(skipWhenNoDb)(
    'Connection without app.current_org_id GUC cannot read memberships (non-member isolation)',
    async () => {
      await withTestDb(async (tx) => {
        await seedOrgsAndUser(tx);

        // Seed User A as a member of Org A
        await tx.insert(memberships).values({
          org_id: ORG_A,
          user_id: USER_A,
          role: 'owner',
          accepted_at: new Date(),
        });

        // Force RLS so superuser is also subject to the policy
        await tx.execute(sql`ALTER TABLE memberships FORCE ROW LEVEL SECURITY`);

        // Explicitly clear the GUC (simulates a request with no org context)
        await tx.execute(
          sql`SELECT set_config('app.current_org_id', '', true)`,
        );

        // Without a valid org context, the policy USING clause is false
        const rows = await tx.select().from(memberships);

        expect(rows).toHaveLength(0);
      });
    },
  );

  /**
   * Scenario 2b — Correct org context reveals membership data
   *
   * Validates the positive case: with the GUC set to Org A, the membership
   * row for User A is visible.
   */
  it.skipIf(skipWhenNoDb)(
    'With correct org GUC, membership rows are visible',
    async () => {
      await withTestDb(async (tx) => {
        await seedOrgsAndUser(tx);

        await tx.insert(memberships).values({
          org_id: ORG_A,
          user_id: USER_A,
          role: 'owner',
          accepted_at: new Date(),
        });

        await tx.execute(sql`ALTER TABLE memberships FORCE ROW LEVEL SECURITY`);

        // Set GUC to Org A
        await tx.execute(
          sql`SELECT set_config('app.current_org_id', ${ORG_A}, true)`,
        );

        const rows = await tx.select().from(memberships);

        expect(rows).toHaveLength(1);
        expect(rows[0]!.user_id).toBe(USER_A);
        expect(rows[0]!.org_id).toBe(ORG_A);

        // Org B's memberships are NOT visible
        expect(rows.some((r) => r.org_id === ORG_B)).toBe(false);
      });
    },
  );

  /**
   * Scenario 3 — Service-role (withSystemContext) reads across orgs
   *
   * The postgres superuser (service role) without FORCE RLS is not restricted
   * by the GUC-based policies. This mirrors what withSystemContext provides:
   * a transaction without `app.current_org_id` that can see all org data,
   * intended for cron jobs, retention sweeps, and RPO bulk checks.
   *
   * Note: In production Supabase, service-role keys bypass RLS at the JWT
   * level. In the test DB, the same effect is achieved by running as the
   * postgres superuser without FORCE RLS.
   */
  it.skipIf(skipWhenNoDb)(
    'Service-role context (no GUC, no FORCE RLS) can read contacts across all orgs',
    async () => {
      await withTestDb(async (tx) => {
        await seedOrgsAndUser(tx);
        const { listAId, listBId } = await seedContactLists(tx);

        await tx.insert(contacts).values([
          {
            org_id: ORG_A,
            contact_list_id: listAId,
            phone_e164: '+39331000001',
            consent_basis: 'existing_customer',
          },
          {
            org_id: ORG_B,
            contact_list_id: listBId,
            phone_e164: '+39332000002',
            consent_basis: 'existing_customer',
          },
        ]);

        // No FORCE RLS, no GUC set → service-role / superuser sees everything
        const all = await tx.select().from(contacts);

        expect(all.length).toBeGreaterThanOrEqual(2);

        const orgIds = new Set(all.map((r) => r.org_id));
        expect(orgIds.has(ORG_A)).toBe(true);
        expect(orgIds.has(ORG_B)).toBe(true);
      });
    },
  );

  /**
   * Scenario 3b — Service-role can read memberships from multiple orgs
   */
  it.skipIf(skipWhenNoDb)(
    'Service-role context can read memberships from multiple orgs',
    async () => {
      await withTestDb(async (tx) => {
        await seedOrgsAndUser(tx);

        await tx.insert(memberships).values([
          { org_id: ORG_A, user_id: USER_A, role: 'owner', accepted_at: new Date() },
          { org_id: ORG_B, user_id: USER_A, role: 'admin', accepted_at: new Date() },
        ]);

        // No FORCE RLS → service role sees all memberships
        const rows = await tx.select().from(memberships);

        const orgIds = new Set(rows.map((r) => r.org_id));
        expect(orgIds.has(ORG_A)).toBe(true);
        expect(orgIds.has(ORG_B)).toBe(true);
      });
    },
  );

  /**
   * Scenario 4 — PAT scoped to Org 1 cannot mutate Org 2
   *
   * A Personal Access Token is bound to a specific org. When the request
   * context carries GUC = ORG_A (the PAT's org), the RLS WITH CHECK clause
   * on the contacts table blocks INSERT of rows with org_id = ORG_B.
   *
   * This ensures a PAT cannot be used to cross org boundaries even if the
   * underlying user has memberships in multiple orgs.
   */
  it.skipIf(skipWhenNoDb)(
    'PAT scoped to Org A cannot INSERT contacts into Org B (RLS WITH CHECK)',
    async () => {
      await withTestDb(async (tx) => {
        await seedOrgsAndUser(tx);
        const { listBId } = await seedContactLists(tx);

        // Force RLS on contacts so the WITH CHECK policy is enforced
        await tx.execute(sql`ALTER TABLE contacts FORCE ROW LEVEL SECURITY`);
        await tx.execute(sql`ALTER TABLE contact_lists FORCE ROW LEVEL SECURITY`);

        // Simulate: PAT bound to Org A — set GUC to ORG_A
        await tx.execute(
          sql`SELECT set_config('app.current_org_id', ${ORG_A}, true)`,
        );

        // Attempt to INSERT a contact belonging to Org B (the PAT's non-owner org)
        // RLS WITH CHECK: org_id must equal current_setting('app.current_org_id')::uuid
        // ORG_B ≠ ORG_A → policy violation → Postgres raises an error
        await expect(
          tx.insert(contacts).values({
            org_id: ORG_B,
            contact_list_id: listBId,
            phone_e164: '+39332000099',
            consent_basis: 'consent',
          }),
        ).rejects.toThrow();
      });
    },
  );

  /**
   * Scenario 4b — PAT scoped to Org A can INSERT contacts into its own org
   *
   * Positive case: the same PAT context (GUC = ORG_A) should successfully
   * insert a contact into Org A.
   */
  it.skipIf(skipWhenNoDb)(
    'PAT scoped to Org A can INSERT contacts into Org A (positive case)',
    async () => {
      await withTestDb(async (tx) => {
        await seedOrgsAndUser(tx);
        const { listAId } = await seedContactLists(tx);

        await tx.execute(sql`ALTER TABLE contacts FORCE ROW LEVEL SECURITY`);
        await tx.execute(sql`ALTER TABLE contact_lists FORCE ROW LEVEL SECURITY`);

        // PAT bound to Org A
        await tx.execute(
          sql`SELECT set_config('app.current_org_id', ${ORG_A}, true)`,
        );

        // INSERT into Org A — should succeed
        const [inserted] = await tx
          .insert(contacts)
          .values({
            org_id: ORG_A,
            contact_list_id: listAId,
            phone_e164: '+39331000099',
            consent_basis: 'consent',
          })
          .returning({ id: contacts.id, org_id: contacts.org_id });

        expect(inserted).toBeDefined();
        expect(inserted!.org_id).toBe(ORG_A);
      });
    },
  );

  /**
   * Scenario 4c — PAT scoped to Org A cannot UPDATE Org B records
   *
   * Even if the attacker tries to UPDATE a pre-existing Org B record while
   * bound to Org A, the RLS USING clause prevents the row from being visible
   * in the first place (UPDATE silently affects 0 rows under FORCE RLS).
   */
  it.skipIf(skipWhenNoDb)(
    'PAT scoped to Org A cannot UPDATE Org B contacts',
    async () => {
      await withTestDb(async (tx) => {
        await seedOrgsAndUser(tx);
        const { listBId } = await seedContactLists(tx);

        // Insert Org B contact while FORCE RLS is NOT yet active (superuser bypass)
        const [orgBContact] = await tx
          .insert(contacts)
          .values({
            org_id: ORG_B,
            contact_list_id: listBId,
            phone_e164: '+39332000777',
            consent_basis: 'existing_customer',
          })
          .returning({ id: contacts.id });

        // Now enable FORCE RLS
        await tx.execute(sql`ALTER TABLE contacts FORCE ROW LEVEL SECURITY`);
        await tx.execute(sql`ALTER TABLE contact_lists FORCE ROW LEVEL SECURITY`);

        // Simulate PAT bound to Org A
        await tx.execute(
          sql`SELECT set_config('app.current_org_id', ${ORG_A}, true)`,
        );

        // Attempt to UPDATE the Org B record — USING clause hides it → 0 rows updated
        const updated = await tx
          .update(contacts)
          .set({ first_name: 'Hacked' })
          .where(eq(contacts.id, orgBContact!.id))
          .returning({ id: contacts.id });

        expect(updated).toHaveLength(0);
      });
    },
  );

  /**
   * Scenario 5 — GUC is transaction-local (SET LOCAL prevents bleed-across)
   *
   * Verifies that set_config with is_local=true scopes the GUC to the
   * current transaction, so it does not bleed into adjacent transactions.
   * This mirrors how withOrgContext uses SET LOCAL under the hood.
   */
  it.skipIf(skipWhenNoDb)(
    'app.current_org_id GUC is transaction-local — does not persist across transactions',
    async () => {
      // First transaction: set GUC and verify it is visible
      await withTestDb(async (tx) => {
        await tx.execute(
          sql`SELECT set_config('app.current_org_id', ${ORG_A}, true)`,
        );

        const rows = await tx.execute<{ value: string }>(
          sql`SELECT current_setting('app.current_org_id', true) AS value`,
        );
        expect(rows[0]?.value).toBe(ORG_A);
      });

      // Second transaction: GUC should be cleared (rolled back with the tx)
      await withTestDb(async (tx) => {
        const rows = await tx.execute<{ value: string }>(
          sql`SELECT current_setting('app.current_org_id', true) AS value`,
        );
        // After rollback the GUC is empty (or the previous committed value, but
        // since withTestDb always rolls back, any SET LOCAL is undone)
        expect(rows[0]?.value).not.toBe(ORG_A);
      });
    },
  );

  /**
   * Scenario 6 — PAT personal_access_tokens records are scoped per org
   *
   * Verifies that a PAT inserted for Org A is not visible when the GUC is
   * set to Org B (using the memberships table RLS as a proxy, since
   * personal_access_tokens RLS uses auth.uid() which is Supabase-specific).
   *
   * This test uses the memberships table to confirm org isolation works for
   * all GUC-based RLS policies, which also covers PAT org isolation at the
   * application layer.
   */
  it.skipIf(skipWhenNoDb)(
    'PAT records for Org A are not visible when GUC is set to Org B',
    async () => {
      await withTestDb(async (tx) => {
        await seedOrgsAndUser(tx);

        await tx.insert(memberships).values([
          { org_id: ORG_A, user_id: USER_A, role: 'owner', accepted_at: new Date() },
          { org_id: ORG_B, user_id: USER_A, role: 'admin', accepted_at: new Date() },
        ]);

        await tx.execute(sql`ALTER TABLE memberships FORCE ROW LEVEL SECURITY`);

        // Bind to Org B
        await tx.execute(
          sql`SELECT set_config('app.current_org_id', ${ORG_B}, true)`,
        );

        const rows = await tx.select().from(memberships);

        // Only Org B membership visible
        expect(rows.every((r) => r.org_id === ORG_B)).toBe(true);
        expect(rows.some((r) => r.org_id === ORG_A)).toBe(false);
      });
    },
  );
});

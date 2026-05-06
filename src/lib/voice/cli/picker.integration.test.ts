/**
 * Integration tests for the CLI picker. Each test runs inside a
 * `withTestDb` transaction (always rolled back) so the test database is
 * never mutated.
 *
 * These tests exercise real Postgres semantics that the unit tests cannot:
 *   - daily / hourly cap filtering (the hourly count is a correlated
 *     sub-query against the calls table)
 *   - region tie-breaking through the multi-key ORDER BY
 *   - org-dedicated rows winning over shared-pool rows
 *   - status filtering (cooling_down / retired excluded)
 *
 * The full concurrent-pick / SKIP-LOCKED double-allocation test belongs to
 * plan 10 task 16 (it needs two real connections and lives in the broader
 * integration suite); the unit test asserts the locking-clause API call.
 *
 * Prerequisites:
 *   docker compose -f infra/test/docker-compose.yml up -d
 *   DATABASE_DIRECT_URL=postgresql://postgres:postgres@localhost:5433/vox_auto_test \
 *     pnpm db:migrate
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/vox_auto_test
 */

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type { DbTx as ProdDbTx } from '@/lib/db/context';
import {
  calls,
  campaigns,
  contactLists,
  contacts,
  organizations,
  phoneNumbers,
  scriptTemplates,
  scripts,
} from '@/lib/db/schema';
import { type DbTx as TestDbTx, withTestDb } from '@/test/db';

import { NoAvailableCliError, pickCliForOrg } from './picker';

// ── Fixed test UUIDs ────────────────────────────────────────────────────────
// Using 8x prefix to avoid collisions with other integration tests
// (contacts uses 1x, multitenancy uses 2x/3x, calls integration uses 7x).

const ORG_A = '80000000-0000-0000-0000-000000000001';
const ORG_B = '80000000-0000-0000-0000-000000000002';

const PHONE_DEDICATED_A = '80000000-0000-0000-0000-000000000010';
const PHONE_SHARED_MILANO = '80000000-0000-0000-0000-000000000011';
const PHONE_SHARED_ROMA = '80000000-0000-0000-0000-000000000012';
const PHONE_SHARED_NAPOLI = '80000000-0000-0000-0000-000000000013';
const PHONE_SHARED_MOBILE = '80000000-0000-0000-0000-000000000014';
const PHONE_COOLING = '80000000-0000-0000-0000-000000000015';
const PHONE_AT_DAILY_CAP = '80000000-0000-0000-0000-000000000016';

const TEMPLATE_ID = '80000000-0000-0000-0000-000000000020';
const SCRIPT_ID = '80000000-0000-0000-0000-000000000021';
const LIST_ID = '80000000-0000-0000-0000-000000000022';
const CONTACT_ID = '80000000-0000-0000-0000-000000000023';
const CAMPAIGN_ID = '80000000-0000-0000-0000-000000000024';

const skipWhenNoDb = !process.env['TEST_DATABASE_URL'];

// ── Shared helpers ──────────────────────────────────────────────────────────

/**
 * The picker exports a `DbTx` from the production `@/lib/db/context` module;
 * the test harness has its own `DbTx` from `@/test/db` because it owns its own
 * postgres-js client. The two are structurally the same drizzle PgTransaction
 * but TypeScript treats them as distinct generics, so we cast at the boundary.
 */
function asProdTx(tx: TestDbTx): ProdDbTx {
  return tx as unknown as ProdDbTx;
}

async function seedBaseOrgs(tx: TestDbTx) {
  await tx.insert(organizations).values([
    { id: ORG_A, name: 'Org A', country: 'IT', timezone: 'Europe/Rome' },
    { id: ORG_B, name: 'Org B', country: 'IT', timezone: 'Europe/Rome' },
  ]);
}

async function seedSharedPool(tx: TestDbTx) {
  await tx.insert(phoneNumbers).values([
    {
      id: PHONE_SHARED_MILANO,
      e164: '+390299990001',
      org_id: null,
      provider: 'voiped',
      status: 'active',
      region: 'milano',
      capabilities: ['landline'],
      daily_call_count: 0,
      spam_score: '0',
    },
    {
      id: PHONE_SHARED_ROMA,
      e164: '+390699990001',
      org_id: null,
      provider: 'voiped',
      status: 'active',
      region: 'roma',
      capabilities: ['landline'],
      daily_call_count: 0,
      spam_score: '0',
    },
    {
      id: PHONE_SHARED_NAPOLI,
      e164: '+390819990001',
      org_id: null,
      provider: 'voiped',
      status: 'active',
      region: 'napoli',
      capabilities: ['landline'],
      daily_call_count: 0,
      spam_score: '0',
    },
    {
      id: PHONE_SHARED_MOBILE,
      e164: '+393999900001',
      org_id: null,
      provider: 'voiped',
      status: 'active',
      region: null,
      capabilities: ['mobile'],
      daily_call_count: 0,
      spam_score: '0',
    },
  ]);
}

/**
 * Inserts the script_template / script / list / contact / campaign rows that
 * an inserted `calls` row needs to satisfy its foreign keys. Used by the
 * hourly-cap test which seeds historical call rows against a CLI.
 */
async function seedCallScaffold(tx: TestDbTx, orgId: string) {
  await tx.insert(scriptTemplates).values({
    id: TEMPLATE_ID,
    slug: 'inbound-test',
    name: 'Inbound Test',
    version: 1,
    system_prompt: 'system',
    variable_schema: { properties: {} } as unknown as object,
    default_voice_id: 'placeholder',
  });
  await tx.insert(scripts).values({
    id: SCRIPT_ID,
    org_id: orgId,
    template_id: TEMPLATE_ID,
    name: 'Test Script',
    variables: {},
    voice_id: null,
  });
  await tx.insert(contactLists).values({
    id: LIST_ID,
    org_id: orgId,
    name: 'Test List',
    source: 'api',
    total_count: 1,
    valid_count: 1,
  });
  await tx.insert(contacts).values({
    id: CONTACT_ID,
    org_id: orgId,
    contact_list_id: LIST_ID,
    phone_e164: '+393409999999',
    consent_basis: 'consent',
  });
  await tx.insert(campaigns).values({
    id: CAMPAIGN_ID,
    org_id: orgId,
    contact_list_id: LIST_ID,
    script_id: SCRIPT_ID,
    name: 'Test Campaign',
    status: 'draft',
  });
}

async function insertCallFrom(
  tx: TestDbTx,
  orgId: string,
  fromNumber: string,
  startedAt: Date,
) {
  await tx.insert(calls).values({
    org_id: orgId,
    campaign_id: CAMPAIGN_ID,
    contact_id: CONTACT_ID,
    provider: 'vapi',
    status: 'completed',
    from_number: fromNumber,
    started_at: startedAt,
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('pickCliForOrg integration', () => {
  it.skipIf(skipWhenNoDb)('returns a shared-pool CLI when no org-dedicated number exists', async () => {
    await withTestDb(async (tx) => {
      await seedBaseOrgs(tx);
      await seedSharedPool(tx);

      const picked = await pickCliForOrg(ORG_A, undefined, { tx: asProdTx(tx) });

      expect([
        '+390299990001',
        '+390699990001',
        '+390819990001',
        '+393999900001',
      ]).toContain(picked.phoneE164);
      expect(picked.provider).toBe('voiped');
    });
  });

  it.skipIf(skipWhenNoDb)('prefers an org-dedicated CLI over the shared pool', async () => {
    await withTestDb(async (tx) => {
      await seedBaseOrgs(tx);
      await seedSharedPool(tx);
      await tx.insert(phoneNumbers).values({
        id: PHONE_DEDICATED_A,
        e164: '+390299991111',
        org_id: ORG_A,
        provider: 'voiped',
        status: 'active',
        region: 'milano',
        capabilities: ['landline'],
        daily_call_count: 5, // higher count than shared rows but ownership wins
        spam_score: '0',
      });

      const picked = await pickCliForOrg(ORG_A, undefined, { tx: asProdTx(tx) });
      expect(picked.phoneE164).toBe('+390299991111');
      expect(picked.phoneNumberId).toBe(PHONE_DEDICATED_A);
    });
  });

  it.skipIf(skipWhenNoDb)("does not return another org's dedicated CLI", async () => {
    await withTestDb(async (tx) => {
      await seedBaseOrgs(tx);
      await tx.insert(phoneNumbers).values({
        id: PHONE_DEDICATED_A,
        e164: '+390299992222',
        org_id: ORG_B,
        provider: 'voiped',
        status: 'active',
        region: 'milano',
        capabilities: ['landline'],
        daily_call_count: 0,
        spam_score: '0',
      });

      await expect(
        pickCliForOrg(ORG_A, undefined, { tx: asProdTx(tx) }),
      ).rejects.toBeInstanceOf(NoAvailableCliError);
    });
  });

  it.skipIf(skipWhenNoDb)('prefers a CLI whose region matches the contact phone', async () => {
    await withTestDb(async (tx) => {
      await seedBaseOrgs(tx);
      await seedSharedPool(tx);

      // Contact in Roma → expect Roma CLI
      const picked = await pickCliForOrg(ORG_A, '+390687654321', {
        tx: asProdTx(tx),
      });
      expect(picked.phoneE164).toBe('+390699990001');
    });
  });

  it.skipIf(skipWhenNoDb)('falls through to lowest daily count when no region match exists', async () => {
    await withTestDb(async (tx) => {
      await seedBaseOrgs(tx);
      await seedSharedPool(tx);

      await tx
        .update(phoneNumbers)
        .set({ daily_call_count: 5 })
        .where(eq(phoneNumbers.id, PHONE_SHARED_MILANO));
      await tx
        .update(phoneNumbers)
        .set({ daily_call_count: 2 })
        .where(eq(phoneNumbers.id, PHONE_SHARED_NAPOLI));
      await tx
        .update(phoneNumbers)
        .set({ daily_call_count: 0 })
        .where(eq(phoneNumbers.id, PHONE_SHARED_ROMA));
      await tx
        .update(phoneNumbers)
        .set({ daily_call_count: 9 })
        .where(eq(phoneNumbers.id, PHONE_SHARED_MOBILE));

      // Padova contact: 049 area code, no region match for any seeded row.
      const picked = await pickCliForOrg(ORG_A, '+390499999999', {
        tx: asProdTx(tx),
      });
      expect(picked.phoneE164).toBe('+390699990001'); // lowest count = Roma
    });
  });

  it.skipIf(skipWhenNoDb)('excludes CLIs at the daily cap', async () => {
    await withTestDb(async (tx) => {
      await seedBaseOrgs(tx);
      await tx.insert(phoneNumbers).values({
        id: PHONE_AT_DAILY_CAP,
        e164: '+390277770001',
        org_id: null,
        provider: 'voiped',
        status: 'active',
        region: 'milano',
        capabilities: ['landline'],
        daily_call_count: 100,
        spam_score: '0',
      });

      await expect(
        pickCliForOrg(ORG_A, undefined, { tx: asProdTx(tx), dailyCap: 100 }),
      ).rejects.toBeInstanceOf(NoAvailableCliError);
    });
  });

  it.skipIf(skipWhenNoDb)('excludes CLIs whose hourly call count meets the cap', async () => {
    await withTestDb(async (tx) => {
      await seedBaseOrgs(tx);
      await seedSharedPool(tx);
      await seedCallScaffold(tx, ORG_A);

      // Push the Milano CLI over the (test) hourly cap of 2 by inserting two
      // calls in the past hour with from_number = its e164.
      const recent = new Date(Date.now() - 5 * 60 * 1000);
      await insertCallFrom(tx, ORG_A, '+390299990001', recent);
      await insertCallFrom(tx, ORG_A, '+390299990001', recent);

      // Older calls (> 1 hour) must not contribute to the sliding window.
      const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
      await insertCallFrom(tx, ORG_A, '+390299990001', old);

      // Milano contact would normally pick Milano, but Milano is at the
      // hourly cap → expect a non-Milano fallback.
      const picked = await pickCliForOrg(ORG_A, '+390212340000', {
        tx: asProdTx(tx),
        hourlyCap: 2,
      });
      expect(picked.phoneE164).not.toBe('+390299990001');
    });
  });

  it.skipIf(skipWhenNoDb)('skips cooling_down CLIs', async () => {
    await withTestDb(async (tx) => {
      await seedBaseOrgs(tx);
      await tx.insert(phoneNumbers).values({
        id: PHONE_COOLING,
        e164: '+390266660001',
        org_id: null,
        provider: 'voiped',
        status: 'cooling_down',
        region: 'milano',
        capabilities: ['landline'],
        daily_call_count: 0,
        spam_score: '85',
      });

      await expect(
        pickCliForOrg(ORG_A, undefined, { tx: asProdTx(tx) }),
      ).rejects.toBeInstanceOf(NoAvailableCliError);
    });
  });

  it.skipIf(skipWhenNoDb)(
    'prefers a CLI idle ≥30 minutes over one used recently (anti-spam)',
    async () => {
      await withTestDb(async (tx) => {
        await seedBaseOrgs(tx);
        // Two shared CLIs with identical region/daily_count/spam_score so the
        // only differentiator is the idle-30m anti-spam rank.
        const recent = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago — recent
        const idle = new Date(Date.now() - 45 * 60 * 1000); // 45 min ago — idle
        await tx.insert(phoneNumbers).values([
          {
            id: PHONE_SHARED_MILANO,
            e164: '+390299990001',
            org_id: null,
            provider: 'voiped',
            status: 'active',
            region: 'milano',
            capabilities: ['landline'],
            daily_call_count: 0,
            spam_score: '0',
            last_used_at: recent,
          },
          {
            id: PHONE_SHARED_ROMA,
            e164: '+390299990002',
            org_id: null,
            provider: 'voiped',
            status: 'active',
            region: 'milano',
            capabilities: ['landline'],
            daily_call_count: 0,
            spam_score: '0',
            last_used_at: idle,
          },
        ]);

        const picked = await pickCliForOrg(ORG_A, '+390212340000', {
          tx: asProdTx(tx),
        });
        expect(picked.phoneE164).toBe('+390299990002');
      });
    },
  );

  it.skipIf(skipWhenNoDb)(
    'falls back to the oldest CLI when every candidate was used in the last 30 minutes',
    async () => {
      await withTestDb(async (tx) => {
        await seedBaseOrgs(tx);
        const recent10 = new Date(Date.now() - 10 * 60 * 1000);
        const recent20 = new Date(Date.now() - 20 * 60 * 1000); // oldest of the recent group
        await tx.insert(phoneNumbers).values([
          {
            id: PHONE_SHARED_MILANO,
            e164: '+390299990001',
            org_id: null,
            provider: 'voiped',
            status: 'active',
            region: 'milano',
            capabilities: ['landline'],
            daily_call_count: 0,
            spam_score: '0',
            last_used_at: recent10,
          },
          {
            id: PHONE_SHARED_ROMA,
            e164: '+390299990002',
            org_id: null,
            provider: 'voiped',
            status: 'active',
            region: 'milano',
            capabilities: ['landline'],
            daily_call_count: 0,
            spam_score: '0',
            last_used_at: recent20,
          },
        ]);

        const picked = await pickCliForOrg(ORG_A, '+390212340000', {
          tx: asProdTx(tx),
        });
        // Both rows share idleRank=1; final last_used_at ASC tiebreaker picks
        // the oldest of the two (used 20 minutes ago).
        expect(picked.phoneE164).toBe('+390299990002');
      });
    },
  );

  it.skipIf(skipWhenNoDb)(
    'increments daily_call_count and stamps last_used_at on the picked row',
    async () => {
      await withTestDb(async (tx) => {
        await seedBaseOrgs(tx);
        await seedSharedPool(tx);

        const before = await tx
          .select({
            daily_call_count: phoneNumbers.daily_call_count,
            last_used_at: phoneNumbers.last_used_at,
          })
          .from(phoneNumbers)
          .where(eq(phoneNumbers.id, PHONE_SHARED_MILANO));
        expect(before[0]?.daily_call_count).toBe(0);
        expect(before[0]?.last_used_at).toBeNull();

        const picked = await pickCliForOrg(ORG_A, '+390212340000', {
          tx: asProdTx(tx),
        });
        expect(picked.phoneE164).toBe('+390299990001');

        const after = await tx
          .select({
            daily_call_count: phoneNumbers.daily_call_count,
            last_used_at: phoneNumbers.last_used_at,
          })
          .from(phoneNumbers)
          .where(eq(phoneNumbers.id, PHONE_SHARED_MILANO));
        expect(after[0]?.daily_call_count).toBe(1);
        expect(after[0]?.last_used_at).toBeInstanceOf(Date);
      });
    },
  );
});

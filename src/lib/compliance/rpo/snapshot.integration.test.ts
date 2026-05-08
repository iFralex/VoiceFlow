/**
 * Integration tests for the RPO compliance pipeline (plan 11 task 18).
 *
 * Two scenarios that the unit suites cannot cover end-to-end:
 *   1. The daily snapshot cron runs against the real schema, refreshing
 *      `rpo_snapshots`, propagating into `contacts.rpo_status`, and
 *      flipping newly-blocked contacts to `opt_out=true`.
 *   2. The per-call live RPO check fails closed when the intermediary
 *      throws and there is no stale snapshot to fall back on.
 *
 * Each test runs inside a `withTestDb` transaction that is always rolled
 * back, so the database state is never mutated.
 *
 * Prerequisites:
 *   docker compose -f infra/test/docker-compose.yml up -d
 *   DATABASE_DIRECT_URL=postgresql://postgres:postgres@localhost:5433/vox_auto_test \
 *     pnpm db:migrate
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/vox_auto_test
 */

import { eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

// Stub the Inngest fan-out so the cron does not reach out to a real events API.
vi.mock('@/lib/inngest/client', () => ({
  sendInngestEvent: vi.fn().mockResolvedValue(undefined),
  sendInngestEvents: vi.fn().mockResolvedValue(undefined),
}));

// Redirect the SUT's withOrgContext / withSystemContext to share the test
// transaction (postgres-js disallows nested transactions, so the production
// helpers must be intercepted before the SUT calls them). The mocks are
// installed at module level and configured per test.
vi.mock('@/lib/db/context', async () => ({
  withSystemContext: vi.fn(),
  withOrgContext: vi.fn(),
}));

import { runRpoSnapshot } from '@/app/api/cron/rpo-snapshot/route';
import type { RpoClient } from '@/lib/compliance/rpo/client';
import { withOrgContext, withSystemContext } from '@/lib/db/context';
import {
  contactLists,
  contacts,
  optOutRegistry,
  organizations,
  rpoSnapshots,
} from '@/lib/db/schema';
import { verifyRpoCompliance } from '@/lib/inngest/campaigns/dispatch';
import { type DbTx as TestDbTx, withTestDb } from '@/test/db';


const ORG = 'd0000000-0000-0000-0000-000000000001';
const LIST = 'd0000000-0000-0000-0000-000000000002';
const CONTACT_BLOCKED = 'd0000000-0000-0000-0000-000000000010';
const CONTACT_CLEAR = 'd0000000-0000-0000-0000-000000000011';
const CONTACT_UNVERIFIABLE = 'd0000000-0000-0000-0000-000000000012';

const PHONE_BLOCKED = '+393331110001';
const PHONE_CLEAR = '+393331110002';
const PHONE_UNVERIFIABLE = '+393331110003';

const skipWhenNoDb = !process.env['TEST_DATABASE_URL'];

async function setOrgContext(tx: TestDbTx, orgId: string): Promise<void> {
  await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
}

async function clearOrgContext(tx: TestDbTx): Promise<void> {
  await tx.execute(sql`SELECT set_config('app.current_org_id', '', true)`);
}

function bindContextsTo(tx: TestDbTx): void {
  vi.mocked(withSystemContext).mockImplementation((fn) =>
    fn(tx as unknown as Parameters<typeof fn>[0]),
  );
  vi.mocked(withOrgContext).mockImplementation(async (orgId, fn) => {
    await setOrgContext(tx, orgId as string);
    try {
      return await fn(tx as unknown as Parameters<typeof fn>[0]);
    } finally {
      await clearOrgContext(tx);
    }
  });
}

async function seedOrgWithList(tx: TestDbTx): Promise<void> {
  await tx.insert(organizations).values({
    id: ORG,
    name: 'RPO Compliance Org',
    country: 'IT',
    timezone: 'Europe/Rome',
  });
  await tx.insert(contactLists).values({
    id: LIST,
    org_id: ORG,
    name: 'Compliance List',
    source: 'api',
    total_count: 0,
    valid_count: 0,
  });
}

describe('runRpoSnapshot integration', () => {
  it.skipIf(skipWhenNoDb)(
    'updates rpo_snapshots and contacts.rpo_status for B2C contacts and flips newly-blocked to opt_out',
    async () => {
      await withTestDb(async (tx) => {
        await seedOrgWithList(tx);
        await tx.insert(contacts).values([
          {
            id: CONTACT_BLOCKED,
            org_id: ORG,
            contact_list_id: LIST,
            phone_e164: PHONE_BLOCKED,
            consent_basis: 'consent',
            contact_type: 'b2c',
            rpo_status: 'unchecked',
            opt_out: false,
          },
          {
            id: CONTACT_CLEAR,
            org_id: ORG,
            contact_list_id: LIST,
            phone_e164: PHONE_CLEAR,
            consent_basis: 'consent',
            contact_type: 'b2c',
            rpo_status: 'unchecked',
            opt_out: false,
          },
        ]);

        bindContextsTo(tx);

        // Deterministic RPO client: blocks PHONE_BLOCKED, clears the rest.
        const stubClient: RpoClient = {
          bulkCheck: vi.fn(async (numbers: string[]) => {
            const out = new Map<string, boolean>();
            for (const p of numbers) out.set(p, p === PHONE_BLOCKED);
            return out;
          }),
          singleCheck: vi.fn(),
        };

        const result = await runRpoSnapshot(stubClient);

        expect(stubClient.bulkCheck).toHaveBeenCalled();
        expect(result.totalChecked).toBeGreaterThanOrEqual(2);
        expect(result.totalBlocked).toBeGreaterThanOrEqual(1);

        // Snapshot table reflects both phones.
        await clearOrgContext(tx);
        const snapshots = await tx.select().from(rpoSnapshots);
        const blockedSnap = snapshots.find((s) => s.phone_e164 === PHONE_BLOCKED);
        const clearSnap = snapshots.find((s) => s.phone_e164 === PHONE_CLEAR);
        expect(blockedSnap?.is_blocked).toBe(true);
        expect(clearSnap?.is_blocked).toBe(false);

        // Contact rows get the new status.
        const updated = await tx.select().from(contacts).where(eq(contacts.org_id, ORG));
        const blocked = updated.find((c) => c.id === CONTACT_BLOCKED);
        const clear = updated.find((c) => c.id === CONTACT_CLEAR);
        expect(blocked?.rpo_status).toBe('blocked');
        expect(blocked?.opt_out).toBe(true);
        expect(blocked?.opt_out_reason).toBe('rpo_block');
        expect(clear?.rpo_status).toBe('clear');
        expect(clear?.opt_out).toBe(false);

        // The newly-blocked transition writes into the unified registry.
        const optOuts = await tx
          .select()
          .from(optOutRegistry)
          .where(eq(optOutRegistry.phone_e164, PHONE_BLOCKED));
        expect(optOuts).toHaveLength(1);
        expect(optOuts[0]?.source).toBe('rpo_block');
      });
    },
  );
});

describe('verifyRpoCompliance integration — fail-closed', () => {
  it.skipIf(skipWhenNoDb)(
    'returns "unverifiable" when the live API throws and no snapshot exists',
    async () => {
      await withTestDb(async (tx) => {
        await seedOrgWithList(tx);
        // Stale (never-checked) B2C contact, no snapshot row.
        await tx.insert(contacts).values({
          id: CONTACT_UNVERIFIABLE,
          org_id: ORG,
          contact_list_id: LIST,
          phone_e164: PHONE_UNVERIFIABLE,
          consent_basis: 'consent',
          contact_type: 'b2c',
          rpo_status: 'unchecked',
          opt_out: false,
        });

        bindContextsTo(tx);

        const throwingClient: RpoClient = {
          bulkCheck: vi.fn(),
          singleCheck: vi.fn(async () => {
            throw new Error('intermediary unreachable');
          }),
        };

        const outcome = await verifyRpoCompliance(ORG, CONTACT_UNVERIFIABLE, throwingClient);

        expect(outcome.decision).toBe('unverifiable');
        expect(outcome.phoneE164).toBe(PHONE_UNVERIFIABLE);
        expect(throwingClient.singleCheck).toHaveBeenCalledWith(PHONE_UNVERIFIABLE);
      });
    },
  );

  it.skipIf(skipWhenNoDb)(
    'falls back to a stale snapshot when the live API throws but a snapshot is available',
    async () => {
      await withTestDb(async (tx) => {
        await seedOrgWithList(tx);
        await tx.insert(contacts).values({
          id: CONTACT_UNVERIFIABLE,
          org_id: ORG,
          contact_list_id: LIST,
          phone_e164: PHONE_UNVERIFIABLE,
          consent_basis: 'consent',
          contact_type: 'b2c',
          rpo_status: 'unchecked',
          opt_out: false,
        });
        await tx.insert(rpoSnapshots).values({
          phone_e164: PHONE_UNVERIFIABLE,
          is_blocked: true,
          last_checked_at: new Date('2026-01-01T00:00:00.000Z'),
        });

        bindContextsTo(tx);

        const throwingClient: RpoClient = {
          bulkCheck: vi.fn(),
          singleCheck: vi.fn(async () => {
            throw new Error('intermediary 503');
          }),
        };

        const outcome = await verifyRpoCompliance(ORG, CONTACT_UNVERIFIABLE, throwingClient);

        expect(outcome.decision).toBe('blocked');
        expect(outcome.phoneE164).toBe(PHONE_UNVERIFIABLE);
      });
    },
  );
});

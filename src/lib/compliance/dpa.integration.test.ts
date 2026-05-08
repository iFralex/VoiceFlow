/**
 * Integration test for the DPA acceptance gate (plan 11 task 18).
 *
 * Verifies the round-trip between `recordDpaAcceptance` and `getDpaStatus`
 * against the real `audit_log` schema:
 *   - a fresh org has no acceptance row → `never_accepted` (the in-app banner
 *     blocks the next session until the operator re-accepts)
 *   - an acceptance row matching `CURRENT_DPA_VERSION` → `current`
 *   - an acceptance row for an older version → `outdated` (the banner blocks
 *     the next session, including the campaign-launch path users navigate to,
 *     until the operator re-accepts the bumped version)
 *
 * The "outdated" state is the gate that the in-app DpaBanner enforces —
 * `getDpaStatus` is the single source of truth for whether the gate is
 * tripped. This test pins the contract.
 *
 * Each test runs inside a `withTestDb` transaction that is always rolled back.
 *
 * Prerequisites:
 *   docker compose -f infra/test/docker-compose.yml up -d
 *   DATABASE_DIRECT_URL=postgresql://postgres:postgres@localhost:5433/vox_auto_test \
 *     pnpm db:migrate
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/vox_auto_test
 */

import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/context', async () => ({
  withSystemContext: vi.fn(),
  withOrgContext: vi.fn(),
}));

import {
  CURRENT_DPA_VERSION,
  getDpaStatus,
  recordDpaAcceptance,
} from '@/lib/compliance/dpa';
import { withOrgContext, withSystemContext } from '@/lib/db/context';
import { auditLog, organizations } from '@/lib/db/schema';
import { type DbTx as TestDbTx, withTestDb } from '@/test/db';

const ORG = 'b1000000-0000-0000-0000-000000000001';
const ACTOR_USER = 'b1000000-0000-0000-0000-0000000000aa';

const skipWhenNoDb = !process.env['TEST_DATABASE_URL'];

function bindContextsTo(tx: TestDbTx): void {
  vi.mocked(withSystemContext).mockImplementation((fn) =>
    fn(tx as unknown as Parameters<typeof fn>[0]),
  );
  vi.mocked(withOrgContext).mockImplementation(async (_orgId, fn) =>
    fn(tx as unknown as Parameters<typeof fn>[0]),
  );
}

async function seedOrg(tx: TestDbTx): Promise<void> {
  await tx.insert(organizations).values({
    id: ORG,
    name: 'DPA Org',
    country: 'IT',
    timezone: 'Europe/Rome',
  });
}

describe('DPA acceptance gate integration', () => {
  it.skipIf(skipWhenNoDb)(
    'reports never_accepted for an org with no acceptance row',
    async () => {
      await withTestDb(async (tx) => {
        await seedOrg(tx);
        bindContextsTo(tx);

        const status = await getDpaStatus(ORG);
        expect(status.state).toBe('never_accepted');
        if (status.state === 'never_accepted') {
          expect(status.currentVersion).toBe(CURRENT_DPA_VERSION);
        }
      });
    },
  );

  it.skipIf(skipWhenNoDb)(
    'reports current after recording an acceptance for the current version',
    async () => {
      await withTestDb(async (tx) => {
        await seedOrg(tx);
        bindContextsTo(tx);

        await recordDpaAcceptance({
          orgId: ORG,
          userId: ACTOR_USER,
          ip: '203.0.113.1',
          userAgent: 'Mozilla/5.0',
        });

        const status = await getDpaStatus(ORG);
        expect(status.state).toBe('current');
        if (status.state === 'current') {
          expect(status.record.version).toBe(CURRENT_DPA_VERSION);
          expect(status.record.acceptedByUserId).toBe(ACTOR_USER);
          expect(status.record.ip).toBe('203.0.113.1');
        }
      });
    },
  );

  it.skipIf(skipWhenNoDb)(
    'reports outdated when only an older-version acceptance exists — gate blocks campaign launch path',
    async () => {
      await withTestDb(async (tx) => {
        await seedOrg(tx);
        bindContextsTo(tx);

        // Simulate an org that accepted a previous DPA version. Insert
        // directly so we can pin a stale version regardless of the
        // CURRENT_DPA_VERSION constant's current value.
        const olderVersion = '2020-01-01';
        expect(olderVersion).not.toBe(CURRENT_DPA_VERSION);

        await tx.insert(auditLog).values({
          org_id: ORG,
          actor_user_id: ACTOR_USER,
          actor_type: 'user',
          action: 'compliance.dpa_accepted',
          subject_type: 'organization',
          subject_id: ORG,
          metadata: {
            version: olderVersion,
            accepted_at: '2020-01-01T00:00:00.000Z',
            ip: '203.0.113.9',
            user_agent: 'Mozilla/5.0 (legacy)',
          },
        });

        const status = await getDpaStatus(ORG);
        expect(status.state).toBe('outdated');
        if (status.state === 'outdated') {
          expect(status.record.version).toBe(olderVersion);
          expect(status.currentVersion).toBe(CURRENT_DPA_VERSION);
        }
      });
    },
  );

  it.skipIf(skipWhenNoDb)(
    'returns the most recent acceptance when an org has multiple history rows',
    async () => {
      await withTestDb(async (tx) => {
        await seedOrg(tx);
        bindContextsTo(tx);

        // Older acceptance.
        await tx.insert(auditLog).values({
          org_id: ORG,
          actor_user_id: ACTOR_USER,
          actor_type: 'user',
          action: 'compliance.dpa_accepted',
          subject_type: 'organization',
          subject_id: ORG,
          metadata: {
            version: '2020-01-01',
            accepted_at: '2020-01-01T00:00:00.000Z',
            ip: null,
            user_agent: null,
          },
          created_at: new Date('2020-01-01T00:00:00.000Z'),
        });

        // Most recent re-acceptance for the current version.
        await tx.execute(
          sql`SELECT pg_sleep(0.001)`,
        ); // ensure ordering by created_at differs even on fast inserts
        await recordDpaAcceptance({
          orgId: ORG,
          userId: ACTOR_USER,
          ip: '203.0.113.5',
          userAgent: 'Mozilla/5.0',
        });

        const status = await getDpaStatus(ORG);
        expect(status.state).toBe('current');
      });
    },
  );
});

/**
 * Integration test for the retention purge cron's legal-hold guard
 * (plan 11 task 18 / task 13 deferred test).
 *
 * Verifies that `runRetentionPurge` honours `contacts.legal_hold_until`:
 *   - a contact whose hold is in the future is *not* hard-deleted even if
 *     `deleted_at` is well past the 30-day grace period
 *   - the held contact's recording / transcript paths are *not* cleared even
 *     when `created_at` is past the org's retention cutoffs
 *   - a contact whose hold has expired (past timestamp) is purged normally
 *   - a contact with no hold is purged normally
 *
 * Each test runs inside a `withTestDb` transaction that is always rolled back.
 *
 * Prerequisites:
 *   docker compose -f infra/test/docker-compose.yml up -d
 *   DATABASE_DIRECT_URL=postgresql://postgres:postgres@localhost:5433/vox_auto_test \
 *     pnpm db:migrate
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/vox_auto_test
 */

import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRemove } = vi.hoisted(() => ({ mockRemove: vi.fn() }));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    storage: {
      from: vi.fn(() => ({ remove: mockRemove })),
    },
  },
}));

vi.mock('@/lib/db/context', async () => ({
  withSystemContext: vi.fn(),
  withOrgContext: vi.fn(),
}));

import { runRetentionPurge } from '@/app/api/cron/retention-purge/route';
import { withOrgContext, withSystemContext } from '@/lib/db/context';
import {
  calls,
  contactLists,
  contacts,
  organizations,
} from '@/lib/db/schema';
import { type DbTx as TestDbTx, withTestDb } from '@/test/db';

const ORG = 'a1000000-0000-0000-0000-000000000001';
const LIST = 'a1000000-0000-0000-0000-000000000002';

const CONTACT_PURGEABLE = 'a1000000-0000-0000-0000-000000000010';
const CONTACT_HELD = 'a1000000-0000-0000-0000-000000000011';
const CONTACT_HOLD_EXPIRED = 'a1000000-0000-0000-0000-000000000012';

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

beforeEach(() => {
  mockRemove.mockReset();
  mockRemove.mockResolvedValue({ data: [], error: null });
});

describe('runRetentionPurge integration — legal hold', () => {
  it.skipIf(skipWhenNoDb)(
    'preserves contacts under an active hold while purging unheld and expired-hold contacts',
    async () => {
      await withTestDb(async (tx) => {
        const now = new Date('2026-05-08T03:00:00.000Z');
        // 60 days ago — well past the 30-day soft-delete grace cutoff.
        const longAgo = new Date('2026-03-08T00:00:00.000Z');

        await tx.insert(organizations).values({
          id: ORG,
          name: 'Retention Org',
          country: 'IT',
          timezone: 'Europe/Rome',
          // Use the platform default — exercises the resolveRecordingDays fallback path.
        });
        await tx.insert(contactLists).values({
          id: LIST,
          org_id: ORG,
          name: 'List',
          source: 'api',
          total_count: 0,
          valid_count: 0,
        });
        await tx.insert(contacts).values([
          {
            id: CONTACT_PURGEABLE,
            org_id: ORG,
            contact_list_id: LIST,
            phone_e164: '+393331110100',
            consent_basis: 'consent',
            deleted_at: longAgo,
            legal_hold_until: null,
          },
          {
            id: CONTACT_HELD,
            org_id: ORG,
            contact_list_id: LIST,
            phone_e164: '+393331110101',
            consent_basis: 'consent',
            deleted_at: longAgo,
            // Active hold — well into the future.
            legal_hold_until: new Date('2030-01-01T00:00:00.000Z'),
          },
          {
            id: CONTACT_HOLD_EXPIRED,
            org_id: ORG,
            contact_list_id: LIST,
            phone_e164: '+393331110102',
            consent_basis: 'consent',
            deleted_at: longAgo,
            // Expired hold — past timestamp lets the contact purge normally.
            legal_hold_until: new Date('2025-01-01T00:00:00.000Z'),
          },
        ]);

        // Calls older than the recording / transcript cutoffs (default
        // recordingDays=365, transcriptDays=730). Two years back covers both.
        const veryOld = new Date('2024-01-01T00:00:00.000Z');
        await tx.insert(calls).values([
          {
            org_id: ORG,
            contact_id: CONTACT_PURGEABLE,
            provider: 'vapi',
            status: 'completed',
            recording_path: `${ORG}/purgeable-rec.mp3`,
            transcript_path: `${ORG}/purgeable-tx.json`,
            created_at: veryOld,
          },
          {
            org_id: ORG,
            contact_id: CONTACT_HELD,
            provider: 'vapi',
            status: 'completed',
            recording_path: `${ORG}/held-rec.mp3`,
            transcript_path: `${ORG}/held-tx.json`,
            created_at: veryOld,
          },
        ]);

        bindContextsTo(tx);

        const result = await runRetentionPurge(now);

        expect(result.errors).toBe(0);
        // The purgeable contact's recording + transcript both cleared.
        expect(result.totalRecordingsDeleted).toBeGreaterThanOrEqual(1);
        expect(result.totalTranscriptsDeleted).toBeGreaterThanOrEqual(1);
        // Two of the three soft-deleted contacts get hard-deleted (held survives).
        expect(result.totalContactsHardDeleted).toBe(2);

        await clearOrgContext(tx);

        // Held contact still exists.
        const survivors = await tx
          .select()
          .from(contacts)
          .where(eq(contacts.org_id, ORG));
        const survivorIds = survivors.map((c) => c.id);
        expect(survivorIds).toContain(CONTACT_HELD);
        expect(survivorIds).not.toContain(CONTACT_PURGEABLE);
        expect(survivorIds).not.toContain(CONTACT_HOLD_EXPIRED);

        // Held contact's call still has its recording / transcript paths
        // because the purge skipped its rows.
        const heldCalls = await tx
          .select()
          .from(calls)
          .where(eq(calls.contact_id, CONTACT_HELD));
        expect(heldCalls).toHaveLength(1);
        expect(heldCalls[0]?.recording_path).toBe(`${ORG}/held-rec.mp3`);
        expect(heldCalls[0]?.transcript_path).toBe(`${ORG}/held-tx.json`);

        // Storage `.remove()` was invoked but with the held paths excluded —
        // the held call's paths must never reach the storage layer.
        const allRemovedPaths = mockRemove.mock.calls.flatMap(
          ([paths]) => paths as string[],
        );
        expect(allRemovedPaths).not.toContain(`${ORG}/held-rec.mp3`);
        expect(allRemovedPaths).not.toContain(`${ORG}/held-tx.json`);
      });
    },
  );
});

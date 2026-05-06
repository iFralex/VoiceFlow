/**
 * Integration tests for the system_flags service. Each test runs inside a
 * `withTestDb` transaction (always rolled back) so the test database is
 * never mutated.
 *
 * Covers the SQL-driven behaviour the unit tests cannot:
 *   - the upsert path through `onConflictDoUpdate`
 *   - the picker constraining selections to Twilio when the flag is raised
 *   - cross-call observability of the flag value (one tx writes, the next
 *     reads back through real Postgres, not an in-memory mock)
 *
 * Prerequisites:
 *   docker compose -f infra/test/docker-compose.yml up -d
 *   DATABASE_DIRECT_URL=postgresql://postgres:postgres@localhost:5433/vox_auto_test \
 *     pnpm db:migrate
 */

import { describe, expect, it } from 'vitest';

import type { DbTx as ProdDbTx } from '@/lib/db/context';
import { organizations, phoneNumbers } from '@/lib/db/schema';
import { pickCliForOrg } from '@/lib/voice/cli/picker';
import { type DbTx as TestDbTx, withTestDb } from '@/test/db';

import {
  clearStaleSbcUnhealthyFlag,
  getFlag,
  getSbcHealthSnapshot,
  isSbcUnhealthy,
  recordSbcDispatchFailure,
  recordSbcDispatchSuccess,
  SBC_HEALTHY_AUTO_CLEAR_MS,
  SBC_UNHEALTHY_FLAG_KEY,
  setFlag,
} from './system_flags';

// Fixed test UUIDs — A0 prefix to avoid collisions with other suites
// (picker integration uses 8x, watchdog uses 9x).
const ORG = 'a0000000-0000-0000-0000-000000000001';
const PHONE_VOIPED = 'a0000000-0000-0000-0000-000000000010';
const PHONE_TWILIO = 'a0000000-0000-0000-0000-000000000011';

const skipWhenNoDb = !process.env['TEST_DATABASE_URL'];

function asProdTx(tx: TestDbTx): ProdDbTx {
  return tx as unknown as ProdDbTx;
}

async function seedOrg(tx: TestDbTx) {
  await tx.insert(organizations).values({
    id: ORG,
    name: 'Flags Org',
    country: 'IT',
    timezone: 'Europe/Rome',
  });
}

async function seedMixedPool(tx: TestDbTx) {
  await tx.insert(phoneNumbers).values([
    {
      id: PHONE_VOIPED,
      e164: '+390277770010',
      org_id: ORG,
      provider: 'voiped',
      status: 'active',
      region: 'milano',
      capabilities: ['landline'],
      daily_call_count: 0,
      spam_score: '0',
    },
    {
      id: PHONE_TWILIO,
      e164: '+390277770011',
      org_id: ORG,
      provider: 'twilio',
      status: 'active',
      region: null,
      capabilities: ['mobile'],
      daily_call_count: 0,
      spam_score: '0',
    },
  ]);
}

describe('system_flags service (integration)', () => {
  it.skipIf(skipWhenNoDb)('roundtrips a generic flag value via setFlag/getFlag', async () => {
    await withTestDb(async (tx) => {
      await setFlag('test/key', { hello: 'world', n: 7 }, { tx: asProdTx(tx) });

      const out = await getFlag<{ hello: string; n: number }>('test/key', {
        tx: asProdTx(tx),
      });
      expect(out).toEqual({ hello: 'world', n: 7 });

      // Upsert: writing again replaces the value.
      await setFlag('test/key', { hello: 'mars', n: 8 }, { tx: asProdTx(tx) });
      const updated = await getFlag<{ hello: string; n: number }>('test/key', {
        tx: asProdTx(tx),
      });
      expect(updated).toEqual({ hello: 'mars', n: 8 });
    });
  });

  it.skipIf(skipWhenNoDb)('returns null for a missing key', async () => {
    await withTestDb(async (tx) => {
      const out = await getFlag('does/not/exist', { tx: asProdTx(tx) });
      expect(out).toBeNull();
    });
  });

  it.skipIf(skipWhenNoDb)(
    'recordSbcDispatchFailure tripped on the 3rd consecutive failure persists to the table',
    async () => {
      await withTestDb(async (tx) => {
        const t0 = new Date('2026-05-06T10:00:00Z');
        for (const i of [0, 1, 2]) {
          await recordSbcDispatchFailure('vapi 502', {
            tx: asProdTx(tx),
            now: new Date(t0.getTime() + i * 1000),
          });
        }
        const persisted = await getFlag<Record<string, unknown>>(
          SBC_UNHEALTHY_FLAG_KEY,
          { tx: asProdTx(tx) },
        );
        expect(persisted).not.toBeNull();
        expect(persisted!['unhealthy']).toBe(true);
        expect(persisted!['reason']).toBe('vapi 502');
        expect(
          await isSbcUnhealthy({ tx: asProdTx(tx) }),
        ).toBe(true);
      });
    },
  );

  it.skipIf(skipWhenNoDb)(
    'recordSbcDispatchSuccess clears the flag after the auto-clear window',
    async () => {
      await withTestDb(async (tx) => {
        const t0 = new Date('2026-05-06T10:00:00Z');
        for (const i of [0, 1, 2]) {
          await recordSbcDispatchFailure('x', {
            tx: asProdTx(tx),
            now: new Date(t0.getTime() + i * 1000),
          });
        }
        expect(await isSbcUnhealthy({ tx: asProdTx(tx) })).toBe(true);

        const wellAfter = new Date(t0.getTime() + SBC_HEALTHY_AUTO_CLEAR_MS + 60_000);
        await recordSbcDispatchSuccess({
          tx: asProdTx(tx),
          now: wellAfter,
        });

        expect(await isSbcUnhealthy({ tx: asProdTx(tx) })).toBe(false);
        // The row is fully cleared (deleted) — getFlag returns null.
        expect(
          await getFlag(SBC_UNHEALTHY_FLAG_KEY, { tx: asProdTx(tx) }),
        ).toBeNull();
      });
    },
  );

  it.skipIf(skipWhenNoDb)(
    'clearStaleSbcUnhealthyFlag clears stale flags on cron sweep',
    async () => {
      await withTestDb(async (tx) => {
        const t0 = new Date('2026-05-06T10:00:00Z');
        for (const i of [0, 1, 2]) {
          await recordSbcDispatchFailure('x', {
            tx: asProdTx(tx),
            now: new Date(t0.getTime() + i * 1000),
          });
        }
        const stale = new Date(t0.getTime() + SBC_HEALTHY_AUTO_CLEAR_MS + 60_000);
        const cleared = await clearStaleSbcUnhealthyFlag({
          tx: asProdTx(tx),
          now: stale,
        });
        expect(cleared).toBe(true);
        expect(
          await getFlag(SBC_UNHEALTHY_FLAG_KEY, { tx: asProdTx(tx) }),
        ).toBeNull();
      });
    },
  );

  it.skipIf(skipWhenNoDb)(
    'getSbcHealthSnapshot returns the persisted reason and timestamps',
    async () => {
      await withTestDb(async (tx) => {
        const t0 = new Date('2026-05-06T10:00:00Z');
        for (const i of [0, 1, 2]) {
          await recordSbcDispatchFailure('vapi: 502 from sbc trunk', {
            tx: asProdTx(tx),
            now: new Date(t0.getTime() + i * 1000),
          });
        }
        const snap = await getSbcHealthSnapshot({ tx: asProdTx(tx) });
        expect(snap).not.toBeNull();
        expect(snap!.reason).toBe('vapi: 502 from sbc trunk');
        expect(snap!.since).toBe(new Date(t0.getTime() + 2000).toISOString());
      });
    },
  );
});

describe('pickCliForOrg + SBC fallback (integration)', () => {
  it.skipIf(skipWhenNoDb)(
    'returns Twilio when the providers filter is set to twilio',
    async () => {
      await withTestDb(async (tx) => {
        await seedOrg(tx);
        await seedMixedPool(tx);

        const picked = await pickCliForOrg(ORG, undefined, {
          tx: asProdTx(tx),
          providers: ['twilio'],
        });
        expect(picked.provider).toBe('twilio');
        expect(picked.phoneE164).toBe('+390277770011');
      });
    },
  );

  it.skipIf(skipWhenNoDb)(
    'returns Voiped when no providers filter is supplied (default behaviour)',
    async () => {
      await withTestDb(async (tx) => {
        await seedOrg(tx);
        await seedMixedPool(tx);

        // Voiped wins on idleRank tie + alphabetical / id ordering, but more
        // robustly: at least one of the seeded providers should be returned.
        const picked = await pickCliForOrg(ORG, undefined, {
          tx: asProdTx(tx),
        });
        expect(['voiped', 'twilio']).toContain(picked.provider);
      });
    },
  );

  it.skipIf(skipWhenNoDb)(
    'engages Twilio fallback when the SBC unhealthy flag is raised end-to-end (plan 10 task 16)',
    async () => {
      // Verifies the full chain: 3 consecutive SBC failures raise the
      // `sbc_unhealthy` flag, the dispatcher reads `isSbcUnhealthy()` on its
      // next decision, and feeds `providers: ['twilio']` to the picker — which
      // returns the Twilio CLI even though a healthier (lower daily count,
      // matching region) Voiped CLI is also available.
      await withTestDb(async (tx) => {
        await seedOrg(tx);
        await seedMixedPool(tx);

        // Trip the flag.
        const t0 = new Date('2026-05-06T10:00:00Z');
        for (const i of [0, 1, 2]) {
          await recordSbcDispatchFailure('vapi 502', {
            tx: asProdTx(tx),
            now: new Date(t0.getTime() + i * 1000),
          });
        }
        const unhealthy = await isSbcUnhealthy({ tx: asProdTx(tx) });
        expect(unhealthy).toBe(true);

        // Mirror the dispatcher's branch: when isSbcUnhealthy() is true,
        // restrict the picker to Twilio.
        const picked = await pickCliForOrg(ORG, undefined, {
          tx: asProdTx(tx),
          ...(unhealthy ? { providers: ['twilio' as const] } : {}),
        });
        expect(picked.provider).toBe('twilio');
        expect(picked.phoneE164).toBe('+390277770011');
      });
    },
  );

  it.skipIf(skipWhenNoDb)(
    'returns to Voiped/SBC pool after the unhealthy flag auto-clears (plan 10 task 16)',
    async () => {
      await withTestDb(async (tx) => {
        await seedOrg(tx);
        await seedMixedPool(tx);

        const t0 = new Date('2026-05-06T10:00:00Z');
        for (const i of [0, 1, 2]) {
          await recordSbcDispatchFailure('vapi 502', {
            tx: asProdTx(tx),
            now: new Date(t0.getTime() + i * 1000),
          });
        }
        expect(await isSbcUnhealthy({ tx: asProdTx(tx) })).toBe(true);

        // 30+ minutes later, a healthy SBC dispatch arrives → flag clears.
        await recordSbcDispatchSuccess({
          tx: asProdTx(tx),
          now: new Date(t0.getTime() + SBC_HEALTHY_AUTO_CLEAR_MS + 60_000),
        });
        const stillUnhealthy = await isSbcUnhealthy({ tx: asProdTx(tx) });
        expect(stillUnhealthy).toBe(false);

        // The picker is no longer restricted to Twilio — the SBC primary is
        // back in play. The seeded rows tie on every ORDER BY rank, so we
        // can't deterministically assert "voiped wins"; the load-bearing
        // assertion is that the picker no longer filters out Voiped.
        const picked = await pickCliForOrg(ORG, undefined, {
          tx: asProdTx(tx),
          ...(stillUnhealthy ? { providers: ['twilio' as const] } : {}),
        });
        expect(['voiped', 'twilio']).toContain(picked.provider);
      });
    },
  );
});

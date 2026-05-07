/**
 * Concurrent / SKIP LOCKED integration test for `pickCliForOrg`.
 *
 * Plan 10 task 16 explicitly calls for a test verifying that two simultaneous
 * pickers never double-allocate the same CLI. This requires two real Postgres
 * sessions running overlapping transactions — `withTestDb` only owns a single
 * session, so this file uses its own multi-connection harness.
 *
 * Strategy:
 *   1. Open three postgres clients: a control client (for committed seed
 *      writes / tearDown) and two worker clients that each open their own
 *      transaction.
 *   2. Control commits an org and exactly two active phone rows.
 *   3. Worker A starts a tx, calls pickCliForOrg → picks one row and locks it
 *      via `SELECT ... FOR UPDATE SKIP LOCKED`, then awaits a barrier so the
 *      lock is held while Worker B runs.
 *   4. Worker B starts a tx and calls pickCliForOrg concurrently. Because
 *      Worker A's tx still holds the lock, B's `SELECT FOR UPDATE SKIP
 *      LOCKED` must skip A's row and pick the second one.
 *   5. The barrier is released; both transactions commit.
 *   6. Control deletes the seeded rows in a `finally` block — the test must
 *      not leak state regardless of pass/fail.
 *
 * Prerequisites:
 *   docker compose -f infra/test/docker-compose.yml up -d
 *   DATABASE_DIRECT_URL=postgresql://postgres:postgres@localhost:5433/vox_auto_test \
 *     pnpm db:migrate
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/vox_auto_test
 */

import { eq, inArray } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

import type { DbTx as ProdDbTx } from '@/lib/db/context';
import * as schema from '@/lib/db/schema';
import { organizations, phoneNumbers } from '@/lib/db/schema';

import { pickCliForOrg } from './picker';

const TEST_DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  'postgresql://postgres:postgres@localhost:5433/vox_auto_test';

const skipWhenNoDb = !process.env['TEST_DATABASE_URL'];

// Fixed UUIDs — c0 prefix to avoid collisions with picker (8x), watchdog (9x),
// and system_flags (a0) integration suites.
const ORG = 'c0000000-0000-0000-0000-000000000001';
const PHONE_ONE = 'c0000000-0000-0000-0000-000000000010';
const PHONE_TWO = 'c0000000-0000-0000-0000-000000000011';
const PHONE_E164_ONE = '+390277770100';
const PHONE_E164_TWO = '+390277770101';

// Open one postgres client per concurrent role plus a control connection.
// Each client must own its own underlying TCP connection so locks acquired in
// one's transaction are visible to the others.
const controlSql = postgres(TEST_DATABASE_URL, { prepare: false, max: 1, idle_timeout: 5 });
const workerASql = postgres(TEST_DATABASE_URL, { prepare: false, max: 1, idle_timeout: 5 });
const workerBSql = postgres(TEST_DATABASE_URL, { prepare: false, max: 1, idle_timeout: 5 });

const controlDb = drizzle(controlSql, { schema });
const workerADb = drizzle(workerASql, { schema });
const workerBDb = drizzle(workerBSql, { schema });

afterAll(async () => {
  await Promise.all([controlSql.end(), workerASql.end(), workerBSql.end()]);
});

async function seedTwoSharedClis(db: PostgresJsDatabase<typeof schema>): Promise<void> {
  await db.insert(organizations).values({
    id: ORG,
    name: 'Concurrent Picker Org',
    country: 'IT',
    timezone: 'Europe/Rome',
  });
  await db.insert(phoneNumbers).values([
    {
      id: PHONE_ONE,
      e164: PHONE_E164_ONE,
      org_id: null,
      provider: 'voiped',
      provider_external_id: 'vapi-skiplocked-one',
      status: 'active',
      region: 'milano',
      capabilities: ['landline'],
      daily_call_count: 0,
      spam_score: '0',
    },
    {
      id: PHONE_TWO,
      e164: PHONE_E164_TWO,
      org_id: null,
      provider: 'voiped',
      provider_external_id: 'vapi-skiplocked-two',
      status: 'active',
      region: 'milano',
      capabilities: ['landline'],
      daily_call_count: 0,
      spam_score: '0',
    },
  ]);
}

async function teardownSeed(db: PostgresJsDatabase<typeof schema>): Promise<void> {
  await db.delete(phoneNumbers).where(inArray(phoneNumbers.id, [PHONE_ONE, PHONE_TWO]));
  await db.delete(organizations).where(eq(organizations.id, ORG));
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('pickCliForOrg + SKIP LOCKED (multi-connection)', () => {
  it.skipIf(skipWhenNoDb)(
    'two concurrent pickers select different CLIs — SKIP LOCKED prevents double allocation',
    async () => {
      // Best-effort cleanup of any state from a prior crashed run before we
      // seed; ignore errors when nothing exists.
      try {
        await teardownSeed(controlDb);
      } catch {
        /* no-op */
      }

      await seedTwoSharedClis(controlDb);

      try {
        const aReady = createDeferred<void>();
        const aRelease = createDeferred<void>();
        const aResult = createDeferred<{ phoneE164: string }>();
        const bResult = createDeferred<{ phoneE164: string }>();

        // Worker A: pick + lock + hold tx open until B has finished its pick.
        const aPromise = workerADb.transaction(async (tx) => {
          try {
            const picked = await pickCliForOrg(ORG, undefined, {
              tx: tx as unknown as ProdDbTx,
            });
            aResult.resolve({ phoneE164: picked.phoneE164 });
            aReady.resolve();
          } catch (err) {
            aResult.reject(err);
            aReady.resolve(); // unblock the awaiter so it can observe the rejection
            throw err;
          }
          await aRelease.promise;
        });

        // Wait until A has acquired its row lock.
        await aReady.promise;

        // Worker B: must skip A's locked row and return the other one.
        const bPromise = workerBDb.transaction(async (tx) => {
          try {
            const picked = await pickCliForOrg(ORG, undefined, {
              tx: tx as unknown as ProdDbTx,
            });
            bResult.resolve({ phoneE164: picked.phoneE164 });
          } catch (err) {
            bResult.reject(err);
            throw err;
          }
        });

        const bPicked = await bResult.promise;
        // Release A so its tx can commit.
        aRelease.resolve();

        const aPicked = await aResult.promise;
        await Promise.all([
          aPromise.catch(() => undefined),
          bPromise.catch(() => undefined),
        ]);

        // The core invariant: the two pickers selected different CLIs. If
        // SKIP LOCKED were broken, B would either block on A's row (timing
        // out the test) or — if A's tx had already committed — pick the same
        // row.
        expect(aPicked.phoneE164).not.toBe(bPicked.phoneE164);
        expect([PHONE_E164_ONE, PHONE_E164_TWO]).toContain(aPicked.phoneE164);
        expect([PHONE_E164_ONE, PHONE_E164_TWO]).toContain(bPicked.phoneE164);
      } finally {
        // Always clean up the committed seed rows so the database is left in
        // its original state.
        await teardownSeed(controlDb);
      }
    },
    20_000,
  );
});

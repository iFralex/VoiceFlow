import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '@/lib/db/schema';

const TEST_DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  'postgresql://postgres:postgres@localhost:5432/vox_auto_test';

type TestDbInstance = ReturnType<typeof drizzle<typeof schema>>;
export type DbTx = Parameters<Parameters<TestDbInstance['transaction']>[0]>[0];

let _testDb: TestDbInstance | null = null;

function getTestDb(): TestDbInstance {
  if (!_testDb) {
    const client = postgres(TEST_DATABASE_URL, { prepare: false, max: 1, idle_timeout: 5 });
    _testDb = drizzle(client, { schema });
  }
  return _testDb;
}

class RollbackSignal extends Error {
  constructor() {
    super('__test_rollback__');
  }
}

/**
 * Runs `fn` inside a Postgres transaction that is always rolled back at the end,
 * leaving the test database in a clean state regardless of what the test does.
 *
 * Requires the test database to be running (see infra/test/docker-compose.yml).
 * Set TEST_DATABASE_URL to override the default connection string.
 */
export async function withTestDb<T>(fn: (tx: DbTx) => Promise<T>): Promise<T> {
  const db = getTestDb();
  let result!: T;

  try {
    await db.transaction(async (tx) => {
      result = await fn(tx);
      // Always rollback — throw a sentinel that we catch below
      throw new RollbackSignal();
    });
  } catch (err) {
    if (err instanceof RollbackSignal) {
      return result;
    }
    throw err;
  }

  // Unreachable — transaction always throws RollbackSignal or an actual error
  return result;
}

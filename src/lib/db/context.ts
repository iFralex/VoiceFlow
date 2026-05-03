import { sql } from 'drizzle-orm';

import { db } from './client';

export type { DB } from './client';

// The type of the transactional client passed to db.transaction callbacks.
// It exposes the same query API as the full db client but is scoped to the
// active transaction and lacks the $client connection property.
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Runs `fn` inside a transaction with `app.current_org_id` set via SET LOCAL.
 * The GUC is automatically cleared when the transaction ends (committed or
 * rolled back), enforcing per-request org isolation per spec §7.3.
 */
export async function withOrgContext<T>(
  orgId: string,
  fn: (tx: DbTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
    return fn(tx);
  });
}

/**
 * Runs `fn` inside a transaction without setting `app.current_org_id`.
 * Intended for service-role operations that intentionally cross org boundaries
 * (cron jobs, retention sweeps, RPO bulk checks). Must only be called from
 * the service layer — never from request handlers.
 */
export async function withSystemContext<T>(fn: (tx: DbTx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => fn(tx));
}

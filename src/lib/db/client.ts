import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { headers } from 'next/headers';
import postgres from 'postgres';

import { env } from '@/lib/env';

import * as schema from './schema';

const queryClient = postgres(env.DATABASE_URL, { prepare: false, max: 10, idle_timeout: 20 });
export const db = drizzle(queryClient, { schema });
export type DB = typeof db;

// Duplicated here to avoid a circular dependency with context.ts (which imports from this file).
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Returns a request-scoped `withOrgContext` bound to the org resolved by
 * middleware. Reads `x-org-id` from the incoming request headers (injected by
 * `src/middleware.ts`). Use this in Server Components and Server Actions
 * inside `(app)/` instead of calling `withOrgContext` with an explicit orgId.
 *
 * @throws if the `x-org-id` header is absent (middleware did not run).
 */
export async function dbForRequest(): Promise<{
  orgId: string;
  withOrgContext: <T>(fn: (tx: DbTx) => Promise<T>) => Promise<T>;
}> {
  const h = await headers();
  const orgId = h.get('x-org-id');
  if (!orgId) {
    throw new Error('Missing x-org-id header: dbForRequest() requires middleware auth context');
  }
  return {
    orgId,
    withOrgContext: <T>(fn: (tx: DbTx) => Promise<T>): Promise<T> =>
      db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
        return fn(tx);
      }),
  };
}

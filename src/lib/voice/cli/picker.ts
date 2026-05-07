import { and, asc, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';

import { type DbTx, withSystemContext } from '@/lib/db/context';
import type { phoneProviderEnum } from '@/lib/db/schema';
import { calls, phoneNumbers } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { inferRegionFromPhone } from '@/lib/utils/phone-region';

/**
 * Thrown when the picker cannot find any active CLI for the org. Every active
 * candidate is either at its daily cap, at its hourly cap, or already locked by
 * a concurrent picker. Plan 09's dispatcher catches this and reschedules the
 * call after a back-off (currently 30 minutes — see plan 10 task 4).
 */
export class NoAvailableCliError extends Error {
  constructor(public readonly orgId: string) {
    super(`No CLI available for org ${orgId}: every active candidate is at cap or locked`);
    this.name = 'NoAvailableCliError';
  }
}

export interface PickedCli {
  phoneNumberId: string;
  phoneE164: string;
  providerExternalId: string | null;
  provider: (typeof phoneProviderEnum)['enumValues'][number];
}

export interface PickCliOptions {
  /** Override the per-CLI daily cap (defaults to env.CLI_DAILY_CAP_DEFAULT). */
  dailyCap?: number;
  /** Override the per-CLI hourly cap (defaults to env.CLI_HOURLY_CAP_DEFAULT). */
  hourlyCap?: number;
  /**
   * Restrict candidates to one or more providers. Plan 10 task 13 uses this
   * to route around a degraded SBC trunk by passing `['twilio']` whenever the
   * `sbc_unhealthy` system flag is raised.
   */
  providers?: ReadonlyArray<(typeof phoneProviderEnum)['enumValues'][number]>;
  /**
   * Run inside an existing transaction instead of opening a new
   * `withSystemContext`. Used by the dispatcher (and tests) to share a
   * transaction with surrounding operations.
   */
  tx?: DbTx;
}

/**
 * Picks an active CLI for the given org from the phone-number pool.
 *
 * Selection order:
 *   1. Org-dedicated CLIs first (rows where `org_id = orgId`).
 *   2. Shared-pool CLIs (`org_id IS NULL`).
 *   3. Within each tier: regional match preferred (when `contactPhone` resolves
 *      to one of the seeded Italian metros), then anti-spam idle preference
 *      (numbers idle ≥30 min — including never-used — sort before recently-used
 *      ones), then lowest `daily_call_count`, then lowest `spam_score`, then
 *      idle longest (`last_used_at` ascending, nulls first).
 *
 * Concurrency: the candidate row is selected with `FOR UPDATE SKIP LOCKED` and
 * limit 1, so simultaneous pickers never double-allocate the same CLI. Rows
 * that are already locked are silently skipped, falling through to the next
 * candidate.
 *
 * Caps: candidates whose `daily_call_count` already meets `dailyCap`, or whose
 * count of dispatched calls (`from_number = $candidate.e164`,
 * `started_at >= NOW() - INTERVAL '1 hour'`) already meets `hourlyCap`, are
 * filtered out before ordering. When no candidate survives the filter, the
 * picker throws `NoAvailableCliError`.
 *
 * Side effect: increments `daily_call_count` and stamps `last_used_at = NOW()`
 * on the picked row inside the same transaction. The hourly count is inferred
 * from the `calls` table — the dispatcher (plan 09) is responsible for writing
 * `calls.from_number` so that subsequent picks see the dispatch in the
 * sliding-window count.
 */
export async function pickCliForOrg(
  orgId: string,
  contactPhone?: string,
  options: PickCliOptions = {},
): Promise<PickedCli> {
  const dailyCap = options.dailyCap ?? env.CLI_DAILY_CAP_DEFAULT;
  const hourlyCap = options.hourlyCap ?? env.CLI_HOURLY_CAP_DEFAULT;

  if (options.tx) {
    return doPick(options.tx, orgId, contactPhone, dailyCap, hourlyCap, options.providers);
  }
  return withSystemContext((tx) =>
    doPick(tx, orgId, contactPhone, dailyCap, hourlyCap, options.providers),
  );
}

async function doPick(
  tx: DbTx,
  orgId: string,
  contactPhone: string | undefined,
  dailyCap: number,
  hourlyCap: number,
  providers: ReadonlyArray<(typeof phoneProviderEnum)['enumValues'][number]> | undefined,
): Promise<PickedCli> {
  const region = inferRegionFromPhone(contactPhone);

  // Correlated subquery: count of outbound calls dispatched from this CLI in
  // the past hour. The CLI picker only enforces the cap; the dispatcher writes
  // `calls.from_number` so that future picks see the activity. Inbound IVR rows
  // share the pool DID as `from_number`, so the direction filter keeps the
  // hourly cap scoped to outbound traffic.
  const hourlyCount = sql<number>`(
    SELECT COUNT(*)::int FROM ${calls} c
    WHERE c.from_number = ${phoneNumbers.e164}
      AND c.direction = 'outbound'
      AND c.started_at IS NOT NULL
      AND c.started_at >= NOW() - INTERVAL '1 hour'
  )`;

  // Ownership rank: org-dedicated rows (org_id = orgId) sort before shared
  // rows (org_id IS NULL). Cast to int so it composes with the other ranks in
  // the ORDER BY.
  const ownershipRank = sql<number>`CASE WHEN ${phoneNumbers.org_id} = ${orgId} THEN 0 ELSE 1 END`;

  // Region match rank: only meaningful when we inferred a region from the
  // contact's phone. When region is null, every row gets the same rank so the
  // tiebreaker falls through to daily_call_count.
  const regionRank = region
    ? sql<number>`CASE WHEN ${phoneNumbers.region} = ${region} THEN 0 ELSE 1 END`
    : sql<number>`1`;

  // Anti-spam idle preference (plan 10 task 6): rows whose `last_used_at` is
  // older than 30 minutes (or NULL — never used) sort before rows used within
  // the last 30 minutes. When every candidate is "recent" they all share rank
  // 1 and the final `last_used_at ASC NULLS FIRST` tiebreaker still picks the
  // oldest, satisfying the "if all are recent, accept oldest" requirement.
  const idleRank = sql<number>`CASE
      WHEN ${phoneNumbers.last_used_at} IS NULL
        OR ${phoneNumbers.last_used_at} <= NOW() - INTERVAL '30 minutes'
      THEN 0 ELSE 1 END`;

  const [candidate] = await tx
    .select({
      id: phoneNumbers.id,
      e164: phoneNumbers.e164,
      provider: phoneNumbers.provider,
      provider_external_id: phoneNumbers.provider_external_id,
    })
    .from(phoneNumbers)
    .where(
      and(
        eq(phoneNumbers.status, 'active'),
        // Seed rows ship with provider_external_id=null until the founder
        // populates each row's Vapi phoneNumberId post-import. Excluding them
        // at the picker keeps NoAvailableCliError as the saturation signal
        // instead of a generic dispatch error from createCall.
        isNotNull(phoneNumbers.provider_external_id),
        or(eq(phoneNumbers.org_id, orgId), isNull(phoneNumbers.org_id)),
        lt(phoneNumbers.daily_call_count, dailyCap),
        sql`${hourlyCount} < ${hourlyCap}`,
        ...(providers && providers.length > 0
          ? [inArray(phoneNumbers.provider, [...providers])]
          : []),
      ),
    )
    .orderBy(
      ownershipRank,
      regionRank,
      idleRank,
      asc(phoneNumbers.daily_call_count),
      asc(phoneNumbers.spam_score),
      sql`${phoneNumbers.last_used_at} ASC NULLS FIRST`,
    )
    .limit(1)
    .for('update', { skipLocked: true });

  if (!candidate) {
    throw new NoAvailableCliError(orgId);
  }

  await tx
    .update(phoneNumbers)
    .set({
      daily_call_count: sql`${phoneNumbers.daily_call_count} + 1`,
      last_used_at: sql`NOW()`,
    })
    .where(eq(phoneNumbers.id, candidate.id));

  return {
    phoneNumberId: candidate.id,
    phoneE164: candidate.e164,
    providerExternalId: candidate.provider_external_id,
    provider: candidate.provider,
  };
}

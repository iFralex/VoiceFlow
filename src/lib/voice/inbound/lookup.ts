import { and, desc, eq, sql } from 'drizzle-orm';

import { type DbTx, withSystemContext } from '@/lib/db/context';
import { calls, contacts } from '@/lib/db/schema';

/**
 * One outbound call matched by `findRecentOutboundCallsToNumber`. The shape is
 * shaped to feed directly into the inbound-IVR opt-out tool (plan 10 task 11),
 * which iterates over results and calls `markOptOut(orgId, phoneE164, ...)`
 * once per distinct org.
 */
export interface RecentOutboundCall {
  orgId: string;
  callId: string;
  contactId: string;
  dialedAt: Date;
}

export interface FindRecentOutboundCallsOptions {
  /** Lookback window in days (default 30). */
  withinDays?: number;
  /**
   * Run inside an existing transaction instead of opening a new
   * `withSystemContext`. Used by the inbound webhook handler (plan 10 task 11)
   * to share a transaction with surrounding opt-out writes, and by tests.
   */
  tx?: DbTx;
}

const DEFAULT_WITHIN_DAYS = 30;

/**
 * Returns recent outbound calls dialed to `phoneE164`, across every org.
 *
 * The inbound IVR opt-out flow (plan 10 task 11) needs to enrol the inbound
 * caller in the opt-out registry of every org that recently called them — even
 * though the caller hit a single shared-pool DID, multiple orgs may have used
 * that DID to call them in the past 30 days. This helper gathers the matching
 * call rows so the webhook handler can deduplicate by org and write one
 * opt-out per org.
 *
 * Crosses org boundaries by design, so it runs inside `withSystemContext` —
 * never `withOrgContext`.
 *
 * Filters:
 *   - `direction = 'outbound'` (so inbound rows do not match themselves)
 *   - `started_at >= NOW() - withinDays * INTERVAL '1 day'`
 *   - the contact's `phone_e164` equals `phoneE164` exactly (callers must
 *     normalise to E.164 before looking up)
 *
 * Ordered by `started_at DESC` so the freshest call comes first; the caller is
 * responsible for deduping by `orgId` if it wants exactly-one result per org.
 */
export async function findRecentOutboundCallsToNumber(
  phoneE164: string,
  options: FindRecentOutboundCallsOptions = {},
): Promise<RecentOutboundCall[]> {
  const withinDays = options.withinDays ?? DEFAULT_WITHIN_DAYS;

  if (options.tx) {
    return doLookup(options.tx, phoneE164, withinDays);
  }
  return withSystemContext((tx) => doLookup(tx, phoneE164, withinDays));
}

async function doLookup(
  tx: DbTx,
  phoneE164: string,
  withinDays: number,
): Promise<RecentOutboundCall[]> {
  const rows = await tx
    .select({
      orgId: calls.org_id,
      callId: calls.id,
      contactId: calls.contact_id,
      dialedAt: calls.started_at,
    })
    .from(calls)
    .innerJoin(contacts, eq(contacts.id, calls.contact_id))
    .where(
      and(
        eq(calls.direction, 'outbound'),
        eq(contacts.phone_e164, phoneE164),
        sql`${calls.started_at} >= NOW() - make_interval(days => ${withinDays})`,
      ),
    )
    .orderBy(desc(calls.started_at));

  return rows
    .filter((r): r is RecentOutboundCall & { dialedAt: Date } => r.dialedAt !== null)
    .map((r) => ({
      orgId: r.orgId,
      callId: r.callId,
      contactId: r.contactId,
      dialedAt: r.dialedAt,
    }));
}

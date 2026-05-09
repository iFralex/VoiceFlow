import { and, asc, count, desc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import { withOrgContext } from '@/lib/db/context';
import { calls, contacts } from '@/lib/db/schema';

export type CampaignCallOutcome =
  | 'interested'
  | 'not_interested'
  | 'appointment_booked'
  | 'wrong_number'
  | 'callback_requested'
  | 'voicemail_left'
  | 'voicemail_no_message'
  | 'do_not_call';

export type CampaignCallStatus =
  | 'pending'
  | 'dialing'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'no_answer'
  | 'voicemail'
  | 'busy';

export type CampaignResultRow = {
  id: string;
  contactId: string | null;
  contactName: string;
  phoneE164: string | null;
  status: CampaignCallStatus;
  outcome: CampaignCallOutcome | null;
  billableSeconds: number | null;
  costCents: number | null;
  startedAtIso: string | null;
  endedAtIso: string | null;
  createdAtIso: string;
};

export type CampaignResultsFilters = {
  outcomes?: CampaignCallOutcome[];
  /** Inclusive lower bound on billable_seconds */
  durationMinSeconds?: number;
  /** Inclusive upper bound on billable_seconds */
  durationMaxSeconds?: number;
  /** Inclusive lower bound on call started_at (falls back to created_at when null) */
  startedAfter?: Date;
  /** Inclusive upper bound on call started_at (falls back to created_at when null) */
  startedBefore?: Date;
};

export type CampaignResultsPage = {
  page: number;
  pageSize: number;
  sort?: 'started_desc' | 'started_asc' | 'duration_desc' | 'duration_asc' | 'cost_desc' | 'cost_asc';
};

export type CampaignResultsResponse = {
  rows: CampaignResultRow[];
  total: number;
};

const MAX_PAGE_SIZE = 200;

function buildWhereClause(orgId: string, campaignId: string, filters: CampaignResultsFilters): SQL {
  const clauses: SQL[] = [
    eq(calls.org_id, orgId),
    isNotNull(calls.campaign_id),
    eq(calls.campaign_id, campaignId),
  ];

  if (filters.outcomes && filters.outcomes.length > 0) {
    clauses.push(inArray(calls.outcome, filters.outcomes));
  }

  if (typeof filters.durationMinSeconds === 'number') {
    clauses.push(gte(calls.billable_seconds, filters.durationMinSeconds));
  }
  if (typeof filters.durationMaxSeconds === 'number') {
    clauses.push(lte(calls.billable_seconds, filters.durationMaxSeconds));
  }

  if (filters.startedAfter) {
    clauses.push(
      sql`COALESCE(${calls.started_at}, ${calls.created_at}) >= ${filters.startedAfter.toISOString()}`,
    );
  }
  if (filters.startedBefore) {
    clauses.push(
      sql`COALESCE(${calls.started_at}, ${calls.created_at}) <= ${filters.startedBefore.toISOString()}`,
    );
  }

  return and(...clauses)!;
}

/**
 * Lists call results for a campaign with filtering and server-side pagination.
 *
 * Returns the page of rows plus the total matching count so the data table can
 * compute page count without a second round-trip from the client.
 */
export async function listCampaignResults(
  orgId: string,
  campaignId: string,
  filters: CampaignResultsFilters,
  page: CampaignResultsPage,
): Promise<CampaignResultsResponse> {
  const pageIndex = Math.max(0, Math.floor(page.page));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(page.pageSize)));
  const offset = pageIndex * pageSize;
  const sort = page.sort ?? 'started_desc';

  const whereClause = buildWhereClause(orgId, campaignId, filters);

  const orderBy = (() => {
    switch (sort) {
      case 'started_asc':
        return [
          asc(sql`COALESCE(${calls.started_at}, ${calls.created_at})`),
          asc(calls.id),
        ];
      case 'duration_desc':
        return [desc(calls.billable_seconds), desc(calls.created_at)];
      case 'duration_asc':
        return [asc(calls.billable_seconds), asc(calls.created_at)];
      case 'cost_desc':
        return [desc(calls.cost_cents), desc(calls.created_at)];
      case 'cost_asc':
        return [asc(calls.cost_cents), asc(calls.created_at)];
      case 'started_desc':
      default:
        return [
          desc(sql`COALESCE(${calls.started_at}, ${calls.created_at})`),
          desc(calls.id),
        ];
    }
  })();

  return withOrgContext(orgId, async (tx) => {
    const [rows, totalRows] = await Promise.all([
      tx
        .select({
          id: calls.id,
          contactId: calls.contact_id,
          status: calls.status,
          outcome: calls.outcome,
          billableSeconds: calls.billable_seconds,
          costCents: calls.cost_cents,
          startedAt: calls.started_at,
          endedAt: calls.ended_at,
          createdAt: calls.created_at,
          firstName: contacts.first_name,
          lastName: contacts.last_name,
          phoneE164: contacts.phone_e164,
        })
        .from(calls)
        .leftJoin(contacts, eq(calls.contact_id, contacts.id))
        .where(whereClause)
        .orderBy(...orderBy)
        .limit(pageSize)
        .offset(offset),
      tx
        .select({ cnt: count() })
        .from(calls)
        .where(whereClause),
    ]);

    const items: CampaignResultRow[] = rows.map((r) => {
      const fullName = [r.firstName, r.lastName].filter(Boolean).join(' ').trim();
      return {
        id: r.id,
        contactId: r.contactId,
        contactName: fullName || (r.phoneE164 ?? ''),
        phoneE164: r.phoneE164,
        status: r.status as CampaignCallStatus,
        outcome: (r.outcome as CampaignCallOutcome | null) ?? null,
        billableSeconds: r.billableSeconds,
        costCents: r.costCents,
        startedAtIso: r.startedAt?.toISOString() ?? null,
        endedAtIso: r.endedAt?.toISOString() ?? null,
        createdAtIso: r.createdAt.toISOString(),
      };
    });

    return {
      rows: items,
      total: totalRows[0]?.cnt ?? 0,
    };
  });
}

import { and, eq, gte, isNull, lt } from 'drizzle-orm';

import { withSystemContext } from '@/lib/db/context';
import { calls } from '@/lib/db/schema/calls';
import {
  type QaChecklist,
  QA_REVIEW_STATUSES,
  type QaReviewStatus,
  isQaReviewStatus,
  qaReviews,
} from '@/lib/db/schema/qa_reviews';

export type { QaReviewStatus, QaChecklist };
export { QA_REVIEW_STATUSES, isQaReviewStatus };

export interface QaReviewRow {
  id: bigint;
  callId: string;
  orgId: string;
  campaignId: string | null;
  status: QaReviewStatus;
  checklist: QaChecklist | null;
  note: string | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  sampledAt: Date;
  recordingPath: string | null;
  transcriptPath: string | null;
  callCreatedAt: Date;
  callOutcome: string | null;
  billableSeconds: number | null;
}

export interface QaWeeklyStats {
  total: number;
  pending: number;
  ok: number;
  needsImprovement: number;
  checklistStats: {
    disclosure_verified: { pass: number; fail: number };
    transcript_readable: { pass: number; fail: number };
    outcome_correct: { pass: number; fail: number };
    no_offensive: { pass: number; fail: number };
    no_privacy_leak: { pass: number; fail: number };
  };
}

/**
 * Samples ~1% of completed calls for a given UTC date into qa_reviews.
 * Idempotent: skips calls that already have a qa_review row.
 * Returns the number of new rows inserted.
 */
export async function sampleCallsForQa(date: Date): Promise<number> {
  const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  return withSystemContext(async (tx) => {
    const eligible = await tx
      .select({
        id: calls.id,
        org_id: calls.org_id,
        campaign_id: calls.campaign_id,
      })
      .from(calls)
      .leftJoin(qaReviews, eq(qaReviews.call_id, calls.id))
      .where(
        and(
          eq(calls.status, 'completed'),
          gte(calls.created_at, dayStart),
          lt(calls.created_at, dayEnd),
          isNull(qaReviews.id),
        ),
      );

    if (eligible.length === 0) return 0;

    const sampleSize = Math.max(1, Math.ceil(eligible.length * 0.01));
    // Deterministic shuffle via sort with random keys generated once per call
    const keyed = eligible.map((c) => ({ c, k: Math.random() }));
    keyed.sort((a, b) => a.k - b.k);
    const sampled = keyed.slice(0, sampleSize).map((x) => x.c);

    await tx
      .insert(qaReviews)
      .values(
        sampled.map((c) => ({
          call_id: c.id,
          org_id: c.org_id,
          campaign_id: c.campaign_id ?? null,
          status: 'pending_review' as const,
        })),
      )
      .onConflictDoNothing();

    return sampled.length;
  });
}

export async function listQaReviews(filter: QaReviewStatus | 'all'): Promise<QaReviewRow[]> {
  return withSystemContext(async (tx) => {
    const rows = await tx
      .select({
        id: qaReviews.id,
        call_id: qaReviews.call_id,
        org_id: qaReviews.org_id,
        campaign_id: qaReviews.campaign_id,
        status: qaReviews.status,
        checklist: qaReviews.checklist,
        note: qaReviews.note,
        reviewed_at: qaReviews.reviewed_at,
        reviewed_by: qaReviews.reviewed_by,
        sampled_at: qaReviews.sampled_at,
        recording_path: calls.recording_path,
        transcript_path: calls.transcript_path,
        call_created_at: calls.created_at,
        call_outcome: calls.outcome,
        billable_seconds: calls.billable_seconds,
      })
      .from(qaReviews)
      .innerJoin(calls, eq(calls.id, qaReviews.call_id))
      .where(filter === 'all' ? undefined : eq(qaReviews.status, filter))
      .orderBy(qaReviews.sampled_at)
      .limit(200);

    return rows.map((r) => ({
      id: r.id,
      callId: r.call_id,
      orgId: r.org_id,
      campaignId: r.campaign_id,
      status: r.status as QaReviewStatus,
      checklist: r.checklist,
      note: r.note,
      reviewedAt: r.reviewed_at,
      reviewedBy: r.reviewed_by,
      sampledAt: r.sampled_at,
      recordingPath: r.recording_path,
      transcriptPath: r.transcript_path,
      callCreatedAt: r.call_created_at,
      callOutcome: r.call_outcome,
      billableSeconds: r.billable_seconds,
    }));
  });
}

export async function updateQaReview(params: {
  reviewId: bigint;
  status: QaReviewStatus;
  checklist: QaChecklist;
  note: string | null;
  reviewedBy: string | null;
}): Promise<{ ok: boolean }> {
  return withSystemContext(async (tx) => {
    const updated = await tx
      .update(qaReviews)
      .set({
        status: params.status,
        checklist: params.checklist,
        note: params.note,
        reviewed_by: params.reviewedBy,
        reviewed_at: new Date(),
      })
      .where(eq(qaReviews.id, params.reviewId))
      .returning({ id: qaReviews.id });

    return { ok: updated.length > 0 };
  });
}

export async function getWeeklyStats(): Promise<QaWeeklyStats> {
  const weekAgo = new Date();
  weekAgo.setUTCDate(weekAgo.getUTCDate() - 7);

  return withSystemContext(async (tx) => {
    const rows = await tx
      .select({ status: qaReviews.status, checklist: qaReviews.checklist })
      .from(qaReviews)
      .where(gte(qaReviews.sampled_at, weekAgo));

    const stats: QaWeeklyStats = {
      total: rows.length,
      pending: 0,
      ok: 0,
      needsImprovement: 0,
      checklistStats: {
        disclosure_verified: { pass: 0, fail: 0 },
        transcript_readable: { pass: 0, fail: 0 },
        outcome_correct: { pass: 0, fail: 0 },
        no_offensive: { pass: 0, fail: 0 },
        no_privacy_leak: { pass: 0, fail: 0 },
      },
    };

    for (const row of rows) {
      if (row.status === 'pending_review') stats.pending++;
      else if (row.status === 'ok') stats.ok++;
      else if (row.status === 'needs_improvement') stats.needsImprovement++;

      if (row.checklist) {
        const cl = row.checklist;
        const keys = Object.keys(stats.checklistStats) as Array<keyof typeof stats.checklistStats>;
        for (const key of keys) {
          const val = cl[key];
          if (val === true) stats.checklistStats[key].pass++;
          else if (val === false) stats.checklistStats[key].fail++;
        }
      }
    }

    return stats;
  });
}

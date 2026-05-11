/**
 * Hidden founder dashboard — plan 14 task 16.
 *
 * Quality-monitoring page that samples 1% of completed calls per day and
 * presents them for human review. Each review includes an inline audio player,
 * transcript link, QA checklist, and status update form.
 *
 * Auth: `?token=<INTERNAL_ADMIN_TOKEN>` query param compared with
 * `timingSafeEqual`. Wrong/missing token → notFound().
 *
 * Sampling is triggered on each page load for today's calls — the operation is
 * idempotent (skips calls already sampled). New samples appear at the bottom of
 * the pending filter.
 */

import { timingSafeEqual } from 'crypto';

import { notFound } from 'next/navigation';

import { env } from '@/lib/env';
import {
  getWeeklyStats,
  listQaReviews,
  QA_REVIEW_STATUSES,
  type QaReviewRow,
  type QaReviewStatus,
  isQaReviewStatus,
  sampleCallsForQa,
} from '@/lib/services/quality-reviews';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { CALL_MEDIA_BUCKET } from '@/lib/voice/persistence';

import { updateQaReviewFormAction } from './actions';

const SIGNED_URL_TTL_SECONDS = 60 * 60;

function isAuthorized(token: string | undefined | string[]): boolean {
  if (typeof token !== 'string' || token.length === 0) return false;
  const expected = env.INTERNAL_ADMIN_TOKEN;
  if (token.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function signedUrlOrNull(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabaseAdmin.storage
    .from(CALL_MEDIA_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

interface SignedRow extends QaReviewRow {
  recordingUrl: string | null;
  transcriptUrl: string | null;
}

async function attachSignedUrls(rows: QaReviewRow[]): Promise<SignedRow[]> {
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      recordingUrl: await signedUrlOrNull(row.recordingPath),
      transcriptUrl: await signedUrlOrNull(row.transcriptPath),
    })),
  );
}

function statusColor(status: QaReviewStatus): string {
  switch (status) {
    case 'pending_review':
      return '#f59e0b';
    case 'ok':
      return '#22c55e';
    case 'needs_improvement':
      return '#ef4444';
  }
}

function checkboxSelect(name: string, current: boolean | null): React.ReactNode {
  return (
    <select name={name} defaultValue={current === null ? '' : String(current)} style={{ padding: '2px 4px', fontSize: '0.85em' }}>
      <option value="">—</option>
      <option value="true">pass</option>
      <option value="false">fail</option>
    </select>
  );
}

interface PageProps {
  searchParams: Promise<{
    token?: string | string[];
    status?: string | string[];
  }>;
}

export const dynamic = 'force-dynamic';

export default async function QualityAdminPage({ searchParams }: PageProps) {
  const params = await searchParams;
  if (!isAuthorized(params.token)) {
    notFound();
  }
  const token = params.token as string;

  // Idempotently sample today's completed calls (1%)
  const newSamples = await sampleCallsForQa(new Date());

  const rawFilter: string = Array.isArray(params.status)
    ? (params.status[0] ?? '')
    : (params.status ?? '');
  function resolveFilter(f: string): QaReviewStatus | 'all' {
    if (f === 'all') return 'all';
    if (isQaReviewStatus(f)) return f;
    return 'pending_review';
  }
  const filter = resolveFilter(rawFilter);

  const [reviews, weeklyStats] = await Promise.all([
    listQaReviews(filter),
    getWeeklyStats(),
  ]);
  const signed = await attachSignedUrls(reviews);

  const filterOptions: ReadonlyArray<QaReviewStatus | 'all'> = [...QA_REVIEW_STATUSES, 'all'];

  const checklistLabels: Record<string, string> = {
    disclosure_verified: 'Disclosure OK',
    transcript_readable: 'Transcript readable',
    outcome_correct: 'Outcome correct',
    no_offensive: 'No offensive content',
    no_privacy_leak: 'No privacy leak',
  };

  return (
    <main style={{ padding: '2rem', fontFamily: 'monospace', maxWidth: 1500, margin: '0 auto' }}>
      <h1 style={{ marginBottom: '0.5rem' }}>Call quality monitoring</h1>
      <p style={{ color: '#666', marginBottom: '1.5rem' }}>
        1% sample of completed calls for human QA review per spec §15.5.
        {newSamples > 0 ? (
          <span style={{ color: '#22c55e', marginLeft: '0.5rem' }}>
            ✓ Sampled {newSamples} new call{newSamples !== 1 ? 's' : ''} today.
          </span>
        ) : (
          <span style={{ color: '#999', marginLeft: '0.5rem' }}>No new samples today.</span>
        )}
      </p>

      {/* Weekly aggregate stats */}
      <section style={{ marginBottom: '2rem', background: '#f9f9f9', padding: '1rem', borderRadius: '4px', border: '1px solid #e5e7eb' }}>
        <h2 style={{ marginBottom: '0.75rem', fontSize: '1rem' }}>Weekly stats (last 7 days)</h2>
        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
          <span>Total: <strong>{weeklyStats.total}</strong></span>
          <span style={{ color: '#f59e0b' }}>Pending: <strong>{weeklyStats.pending}</strong></span>
          <span style={{ color: '#22c55e' }}>OK: <strong>{weeklyStats.ok}</strong></span>
          <span style={{ color: '#ef4444' }}>Needs improvement: <strong>{weeklyStats.needsImprovement}</strong></span>
        </div>
        {weeklyStats.total > 0 && (
          <table style={{ borderCollapse: 'collapse', fontSize: '0.85em' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #ddd' }}>
                <th style={{ padding: '4px 8px', textAlign: 'left' }}>Checklist item</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', color: '#22c55e' }}>Pass</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', color: '#ef4444' }}>Fail</th>
              </tr>
            </thead>
            <tbody>
              {(Object.entries(checklistLabels) as [string, string][]).map(([key, label]) => {
                const s = weeklyStats.checklistStats[key as keyof typeof weeklyStats.checklistStats];
                return (
                  <tr key={key} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '4px 8px' }}>{label}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', color: '#22c55e' }}>{s.pass}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', color: '#ef4444' }}>{s.fail}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* Filter tabs */}
      <nav style={{ marginBottom: '1rem' }}>
        {filterOptions.map((opt) => {
          const active = opt === filter;
          const href = `/admin/quality?token=${encodeURIComponent(token)}&status=${opt}`;
          return (
            <a
              key={opt}
              href={href}
              style={{
                padding: '4px 10px',
                marginRight: '6px',
                borderRadius: '3px',
                background: active ? '#111' : '#eee',
                color: active ? 'white' : '#111',
                textDecoration: 'none',
                fontSize: '0.85em',
              }}
            >
              {opt}
            </a>
          );
        })}
      </nav>

      <p style={{ color: '#666', marginBottom: '1rem', fontSize: '0.9em' }}>
        {signed.length} {signed.length === 1 ? 'review' : 'reviews'} (filter: {filter})
      </p>

      {signed.length === 0 ? (
        <p style={{ color: '#666', marginTop: '2rem' }}>No reviews match this filter.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.82em' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #333', textAlign: 'left' }}>
              <th style={{ padding: '0.5rem' }}>Sampled</th>
              <th style={{ padding: '0.5rem' }}>Call / Org / Campaign</th>
              <th style={{ padding: '0.5rem' }}>Outcome</th>
              <th style={{ padding: '0.5rem' }}>Recording</th>
              <th style={{ padding: '0.5rem' }}>Transcript</th>
              <th style={{ padding: '0.5rem' }}>Status</th>
              <th style={{ padding: '0.5rem' }}>Review</th>
            </tr>
          </thead>
          <tbody>
            {signed.map((row) => (
              <tr key={String(row.id)} style={{ borderBottom: '1px solid #ddd', verticalAlign: 'top' }}>
                <td style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>
                  {row.sampledAt.toISOString().replace('T', ' ').slice(0, 19)}
                </td>
                <td style={{ padding: '0.5rem' }}>
                  <div>call: {row.callId}</div>
                  <div style={{ color: '#666' }}>org: {row.orgId}</div>
                  {row.campaignId ? (
                    <div style={{ color: '#666' }}>campaign: {row.campaignId}</div>
                  ) : null}
                  <div style={{ color: '#999', fontSize: '0.9em' }}>
                    {row.callCreatedAt.toISOString().replace('T', ' ').slice(0, 19)}
                  </div>
                </td>
                <td style={{ padding: '0.5rem' }}>
                  {row.callOutcome ?? '—'}
                  {row.billableSeconds !== null ? (
                    <div style={{ color: '#666' }}>{row.billableSeconds}s</div>
                  ) : null}
                </td>
                <td style={{ padding: '0.5rem' }}>
                  {row.recordingUrl ? (
                    <audio
                      controls
                      preload="none"
                      src={row.recordingUrl}
                      style={{ width: 220, maxWidth: '100%' }}
                    />
                  ) : (
                    <span style={{ color: '#999' }}>—</span>
                  )}
                </td>
                <td style={{ padding: '0.5rem' }}>
                  {row.transcriptUrl ? (
                    <a href={row.transcriptUrl} rel="noreferrer" target="_blank">
                      JSON
                    </a>
                  ) : (
                    <span style={{ color: '#999' }}>—</span>
                  )}
                </td>
                <td style={{ padding: '0.5rem' }}>
                  <span
                    style={{
                      background: statusColor(row.status),
                      color: 'white',
                      padding: '2px 6px',
                      borderRadius: '3px',
                      fontSize: '0.85em',
                    }}
                  >
                    {row.status}
                  </span>
                  {row.reviewedAt ? (
                    <div style={{ color: '#666', fontSize: '0.85em', marginTop: '4px' }}>
                      {row.reviewedAt.toISOString().replace('T', ' ').slice(0, 19)}
                      {row.reviewedBy ? ` · ${row.reviewedBy}` : null}
                    </div>
                  ) : null}
                  {row.note ? (
                    <div style={{ color: '#444', fontSize: '0.85em', marginTop: '4px', whiteSpace: 'pre-wrap', maxWidth: 200 }}>
                      {row.note}
                    </div>
                  ) : null}
                </td>
                <td style={{ padding: '0.5rem' }}>
                  <form action={updateQaReviewFormAction} style={{ display: 'grid', gap: 4, minWidth: 220 }}>
                    <input type="hidden" name="token" value={token} />
                    <input type="hidden" name="reviewId" value={String(row.id)} />

                    <select name="status" defaultValue={row.status} style={{ padding: '2px 4px' }}>
                      {QA_REVIEW_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>

                    <div style={{ fontSize: '0.85em', color: '#555', marginTop: 4 }}>Checklist:</div>
                    {(Object.entries(checklistLabels) as [string, string][]).map(([key, label]) => (
                      <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85em' }}>
                        {checkboxSelect(key, row.checklist?.[key as keyof typeof row.checklist] ?? null)}
                        <span>{label}</span>
                      </label>
                    ))}

                    <input
                      name="reviewer"
                      placeholder="reviewer (e.g. founder)"
                      defaultValue={row.reviewedBy ?? ''}
                      style={{ padding: '2px 4px', fontSize: '0.9em', marginTop: 4 }}
                    />
                    <textarea
                      name="note"
                      placeholder="note"
                      defaultValue={row.note ?? ''}
                      rows={2}
                      style={{ padding: '2px 4px', fontSize: '0.9em', width: 220 }}
                    />
                    <button type="submit" style={{ padding: '4px 8px', cursor: 'pointer' }}>
                      Save
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

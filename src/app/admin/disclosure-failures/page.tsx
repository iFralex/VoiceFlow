/**
 * Hidden founder dashboard — plan 11 task 8.
 *
 * Lists all calls with `metadata.disclosure_verified = false` (emitted by the
 * post-call classifier in src/lib/inngest/voice/classify.ts) so the founder /
 * compliance lead can triage AI Act disclosure failures per the runbook at
 * docs/runbooks/aiact-disclosure-failure.md.
 *
 * Auth: `?token=<INTERNAL_ADMIN_TOKEN>` query param compared with
 * `timingSafeEqual`. Wrong/missing token → notFound() so the route is
 * indistinguishable from a 404 to anyone fishing for admin endpoints.
 *
 * Each row exposes:
 *   - inline <audio> player streaming a 1-hour signed URL for the recording,
 *   - a link to the JSON transcript (signed URL, same TTL),
 *   - inline form to update triage status + free-text note.
 *
 * Triage state is stored in `calls.metadata` (see lib/compliance/aiact/triage)
 * and every transition writes a `compliance.disclosure_triaged` audit_log row.
 */

import { timingSafeEqual } from 'crypto';

import { notFound } from 'next/navigation';

import {
  DISCLOSURE_TRIAGE_STATUSES,
  type DisclosureFailureRow,
  type DisclosureTriageStatus,
  isDisclosureTriageStatus,
  listDisclosureFailures,
} from '@/lib/compliance/aiact/triage';
import { env } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { CALL_MEDIA_BUCKET } from '@/lib/voice/persistence';

import { triageDisclosureFailureFormAction } from './actions';

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

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

function statusColor(status: DisclosureTriageStatus): string {
  switch (status) {
    case 'pending':
      return '#ef4444';
    case 'reviewed':
      return '#3b82f6';
    case 'refunded':
      return '#22c55e';
    case 'escalated':
      return '#f59e0b';
    case 'resolved':
      return '#6b7280';
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

interface SignedRow extends DisclosureFailureRow {
  recordingUrl: string | null;
  transcriptUrl: string | null;
}

async function attachSignedUrls(rows: DisclosureFailureRow[]): Promise<SignedRow[]> {
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      recordingUrl: await signedUrlOrNull(row.recordingPath),
      transcriptUrl: await signedUrlOrNull(row.transcriptPath),
    })),
  );
}

interface PageProps {
  searchParams: Promise<{
    token?: string | string[];
    status?: string | string[];
  }>;
}

export const dynamic = 'force-dynamic';

export default async function DisclosureFailuresAdminPage({ searchParams }: PageProps) {
  const params = await searchParams;
  if (!isAuthorized(params.token)) {
    notFound();
  }
  const token = params.token as string;

  const rawFilter = Array.isArray(params.status) ? params.status[0] : params.status;
  // `?status=all` shows every row; missing or unknown → default to pending.
  const filter: DisclosureTriageStatus | 'all' =
    rawFilter === 'all'
      ? 'all'
      : isDisclosureTriageStatus(rawFilter)
        ? rawFilter
        : 'pending';

  const rows = await listDisclosureFailures(
    filter === 'all' ? {} : { status: filter },
  );
  const signed = await attachSignedUrls(rows);

  const filterOptions: ReadonlyArray<DisclosureTriageStatus | 'all'> = [
    'pending',
    'reviewed',
    'refunded',
    'escalated',
    'resolved',
    'all',
  ];

  return (
    <main style={{ padding: '2rem', fontFamily: 'monospace', maxWidth: 1400, margin: '0 auto' }}>
      {/* Suppress the Referer header to keep the admin token out of upstream
          access logs (Supabase Storage signed URLs, transcript JSON links) and
          out of any nav-target's referrer chain. */}
      <meta name="referrer" content="no-referrer" />
      <h1 style={{ marginBottom: '0.5rem' }}>AI Act disclosure failures</h1>
      <p style={{ color: '#666', marginBottom: '1rem' }}>
        Calls whose post-call classifier did not detect the phrase &ldquo;assistente vocale automatico&rdquo;
        in the first 30 seconds of the transcript. See{' '}
        <code>docs/runbooks/aiact-disclosure-failure.md</code> for the triage procedure.
      </p>

      <nav style={{ marginBottom: '1rem' }}>
        {filterOptions.map((opt) => {
          const active = opt === filter;
          const href = `/admin/disclosure-failures?token=${encodeURIComponent(token)}&status=${opt}`;
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

      <p style={{ color: '#666', marginBottom: '1rem' }}>
        {signed.length} {signed.length === 1 ? 'row' : 'rows'} (filter: {filter}).
      </p>

      {signed.length === 0 ? (
        <p style={{ color: '#666', marginTop: '2rem' }}>No disclosure failures match this filter.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85em' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #333', textAlign: 'left' }}>
              <th style={{ padding: '0.5rem' }}>Created</th>
              <th style={{ padding: '0.5rem' }}>Call / Org / Campaign</th>
              <th style={{ padding: '0.5rem' }}>Cost</th>
              <th style={{ padding: '0.5rem' }}>Recording</th>
              <th style={{ padding: '0.5rem' }}>Transcript</th>
              <th style={{ padding: '0.5rem' }}>Status</th>
              <th style={{ padding: '0.5rem' }}>Triage</th>
            </tr>
          </thead>
          <tbody>
            {signed.map((row) => (
              <tr key={row.callId} style={{ borderBottom: '1px solid #ddd', verticalAlign: 'top' }}>
                <td style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>
                  {row.createdAt.toISOString().replace('T', ' ').slice(0, 19)}
                </td>
                <td style={{ padding: '0.5rem', fontFamily: 'monospace' }}>
                  <div>call: {row.callId}</div>
                  <div style={{ color: '#666' }}>org: {row.orgId}</div>
                  {row.campaignId ? (
                    <div style={{ color: '#666' }}>campaign: {row.campaignId}</div>
                  ) : null}
                  {row.contactId ? (
                    <div style={{ color: '#666' }}>contact: {row.contactId}</div>
                  ) : null}
                </td>
                <td style={{ padding: '0.5rem' }}>
                  {row.costCents !== null ? `${(row.costCents / 100).toFixed(2)} €` : '—'}
                </td>
                <td style={{ padding: '0.5rem' }}>
                  {row.recordingUrl ? (
                    <audio
                      controls
                      preload="none"
                      src={row.recordingUrl}
                      style={{ width: 240, maxWidth: '100%' }}
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
                      background: statusColor(row.triageStatus),
                      color: 'white',
                      padding: '2px 6px',
                      borderRadius: '3px',
                      fontSize: '0.85em',
                    }}
                  >
                    {row.triageStatus}
                  </span>
                  {row.triagedAt ? (
                    <div style={{ color: '#666', fontSize: '0.85em', marginTop: '4px' }}>
                      {row.triagedAt.toISOString().replace('T', ' ').slice(0, 19)}
                      {row.triagedBy ? ` · ${row.triagedBy}` : null}
                    </div>
                  ) : null}
                  {row.triageNote ? (
                    <div
                      style={{
                        color: '#444',
                        fontSize: '0.85em',
                        marginTop: '4px',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {row.triageNote}
                    </div>
                  ) : null}
                </td>
                <td style={{ padding: '0.5rem' }}>
                  <form action={triageDisclosureFailureFormAction} style={{ display: 'grid', gap: 4 }}>
                    <input type="hidden" name="token" value={token} />
                    <input type="hidden" name="callId" value={row.callId} />
                    <input type="hidden" name="filterStatus" value={filter} />
                    <select name="status" defaultValue={row.triageStatus} style={{ padding: '2px 4px' }}>
                      {DISCLOSURE_TRIAGE_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <input
                      name="actor"
                      placeholder="actor (e.g. founder)"
                      defaultValue={row.triagedBy ?? ''}
                      style={{ padding: '2px 4px', fontSize: '0.9em' }}
                    />
                    <textarea
                      name="note"
                      placeholder="note"
                      defaultValue={row.triageNote ?? ''}
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

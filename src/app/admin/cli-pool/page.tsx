/**
 * Hidden founder dashboard — plan 10 task 7. Shows per-CLI 7-day metrics
 * (dialed, pickup rate, voicemail rate, complaint rate, current spam score,
 * status) so the founder can spot pool issues before the watchdog has had
 * time to react. Not linked from the main app; the URL is shared out of
 * band with founders only.
 *
 * Auth: `?token=<INTERNAL_ADMIN_TOKEN>` query param compared with
 * `timingSafeEqual`. Wrong/missing token → notFound() so the route is
 * indistinguishable from a 404 to anyone fishing for admin endpoints.
 */

import { timingSafeEqual } from 'crypto';

import { notFound } from 'next/navigation';

import { env } from '@/lib/env';
import { collectCliMetrics, type CliMetricsRow } from '@/lib/services/cli_watchdog';

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

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function statusBadge(status: CliMetricsRow['status']): string {
  switch (status) {
    case 'active':
      return '#22c55e';
    case 'cooling_down':
      return '#f59e0b';
    case 'retired':
      return '#ef4444';
  }
}

interface PageProps {
  searchParams: Promise<{ token?: string | string[] }>;
}

export const dynamic = 'force-dynamic';

export default async function CliPoolAdminPage({ searchParams }: PageProps) {
  const { token } = await searchParams;
  if (!isAuthorized(token)) {
    notFound();
  }

  const rows = await collectCliMetrics(7);
  rows.sort((a, b) => b.spamScore - a.spamScore);

  return (
    <main style={{ padding: '2rem', fontFamily: 'monospace' }}>
      <h1 style={{ marginBottom: '1rem' }}>CLI pool health (7-day window)</h1>
      <p style={{ color: '#666', marginBottom: '1rem' }}>
        {rows.length} numbers in pool. Sorted by spam score (worst first).
      </p>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #333', textAlign: 'left' }}>
            <th style={{ padding: '0.5rem' }}>E.164</th>
            <th style={{ padding: '0.5rem' }}>Provider</th>
            <th style={{ padding: '0.5rem' }}>Status</th>
            <th style={{ padding: '0.5rem' }}>Dialed</th>
            <th style={{ padding: '0.5rem' }}>Pickup</th>
            <th style={{ padding: '0.5rem' }}>Voicemail</th>
            <th style={{ padding: '0.5rem' }}>Complaint</th>
            <th style={{ padding: '0.5rem' }}>Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.phoneNumberId} style={{ borderBottom: '1px solid #ddd' }}>
              <td style={{ padding: '0.5rem' }}>{r.e164}</td>
              <td style={{ padding: '0.5rem' }}>{r.provider}</td>
              <td style={{ padding: '0.5rem' }}>
                <span
                  style={{
                    background: statusBadge(r.status),
                    color: 'white',
                    padding: '2px 6px',
                    borderRadius: '3px',
                    fontSize: '0.85em',
                  }}
                >
                  {r.status}
                </span>
              </td>
              <td style={{ padding: '0.5rem' }}>{r.dialed}</td>
              <td style={{ padding: '0.5rem' }}>{pct(r.pickupRate)}</td>
              <td style={{ padding: '0.5rem' }}>{pct(r.voicemailRate)}</td>
              <td style={{ padding: '0.5rem' }}>{pct(r.complaintRate)}</td>
              <td style={{ padding: '0.5rem', fontWeight: 'bold' }}>{r.spamScore}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

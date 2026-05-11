/**
 * Founder operations dashboard — plan 14 task 18.
 *
 * Consolidates platform-wide business metrics: active orgs, MRR-equivalent,
 * active campaigns, 24h call volume + outcome breakdown, 24h credit consumed,
 * CLI pool health, Stripe payment volume, failed webhook deliveries, and GDPR
 * request count. All data is read from existing tables — no new schema needed.
 *
 * Auth: `?token=<INTERNAL_ADMIN_TOKEN>` query param compared with
 * `timingSafeEqual`. Wrong/missing token → notFound().
 */

import { timingSafeEqual } from 'crypto';

import { notFound } from 'next/navigation';

import { env } from '@/lib/env';
import { getOperationsDashboardData } from '@/lib/services/operations-dashboard';

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

function euros(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

function pct(n: number, total: number): string {
  if (total === 0) return '—';
  return `${((n / total) * 100).toFixed(1)}%`;
}

interface PageProps {
  searchParams: Promise<{ token?: string | string[] }>;
}

export const dynamic = 'force-dynamic';

export default async function OperationsDashboardPage({ searchParams }: PageProps) {
  const { token } = await searchParams;
  if (!isAuthorized(token)) {
    notFound();
  }

  const data = await getOperationsDashboardData();

  const totalCli =
    data.cliPoolHealth.active + data.cliPoolHealth.cooling_down + data.cliPoolHealth.retired;

  const callOutcomeKeys = Object.keys(data.callVolume24h.byOutcome).sort();
  const callStatusKeys = Object.keys(data.callVolume24h.byStatus).sort();

  return (
    <main style={{ padding: '2rem', fontFamily: 'monospace', maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ marginBottom: '0.25rem' }}>Operations dashboard</h1>
      <p style={{ color: '#666', marginBottom: '2rem', fontSize: '0.85em' }}>
        Generated: {data.generatedAt.toISOString().replace('T', ' ').slice(0, 19)} UTC
      </p>

      {/* KPI row */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ marginBottom: '0.75rem', fontSize: '1rem' }}>Platform overview</h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '1rem',
          }}
        >
          {[
            { label: 'Active orgs', value: String(data.activeOrgsCount) },
            { label: 'Active campaigns', value: String(data.activeCampaignsCount) },
            {
              label: 'MRR-equiv (30d credit)',
              value: euros(data.mrrEquivalentCents),
              note: 'sum of charges',
            },
            {
              label: 'Credit consumed (24h)',
              value: euros(data.credit24hCents),
            },
            {
              label: 'Stripe volume (30d)',
              value: euros(data.stripeVolumeLast30dCents),
              note: 'succeeded payments',
            },
            {
              label: 'Failed webhooks (24h)',
              value: String(data.failedWebhookDeliveries24h),
              alert: data.failedWebhookDeliveries24h > 0,
            },
            {
              label: 'GDPR requests (30d)',
              value: String(data.gdprRequestsLast30d),
            },
          ].map(({ label, value, note, alert }) => (
            <div
              key={label}
              style={{
                background: '#f9f9f9',
                border: `1px solid ${alert ? '#fca5a5' : '#e5e7eb'}`,
                borderRadius: '4px',
                padding: '0.75rem 1rem',
              }}
            >
              <div style={{ color: '#666', fontSize: '0.8em', marginBottom: '0.25rem' }}>
                {label}
              </div>
              <div
                style={{
                  fontSize: '1.4em',
                  fontWeight: 'bold',
                  color: alert ? '#ef4444' : '#111',
                }}
              >
                {value}
              </div>
              {note ? (
                <div style={{ color: '#999', fontSize: '0.75em', marginTop: '0.15rem' }}>
                  {note}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {/* Call volume 24h */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ marginBottom: '0.75rem', fontSize: '1rem' }}>
          Call volume — last 24h ({data.callVolume24h.total} total)
        </h2>
        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', color: '#555' }}>
              By status
            </h3>
            {callStatusKeys.length === 0 ? (
              <p style={{ color: '#999' }}>No calls in last 24h.</p>
            ) : (
              <table style={{ borderCollapse: 'collapse', fontSize: '0.9em' }}>
                <tbody>
                  {callStatusKeys.map((s) => (
                    <tr key={s} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '3px 8px 3px 0' }}>{s}</td>
                      <td style={{ padding: '3px 0 3px 8px', textAlign: 'right', fontWeight: 'bold' }}>
                        {data.callVolume24h.byStatus[s]}
                      </td>
                      <td style={{ padding: '3px 0 3px 8px', color: '#666' }}>
                        {pct(data.callVolume24h.byStatus[s]!, data.callVolume24h.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div>
            <h3 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', color: '#555' }}>
              By outcome
            </h3>
            {callOutcomeKeys.length === 0 ? (
              <p style={{ color: '#999' }}>No outcomes recorded.</p>
            ) : (
              <table style={{ borderCollapse: 'collapse', fontSize: '0.9em' }}>
                <tbody>
                  {callOutcomeKeys.map((o) => (
                    <tr key={o} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '3px 8px 3px 0' }}>{o}</td>
                      <td style={{ padding: '3px 0 3px 8px', textAlign: 'right', fontWeight: 'bold' }}>
                        {data.callVolume24h.byOutcome[o]}
                      </td>
                      <td style={{ padding: '3px 0 3px 8px', color: '#666' }}>
                        {pct(data.callVolume24h.byOutcome[o]!, data.callVolume24h.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>

      {/* CLI pool health */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ marginBottom: '0.75rem', fontSize: '1rem' }}>
          CLI pool health ({totalCli} total numbers)
        </h2>
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          {(
            [
              ['active', '#22c55e'],
              ['cooling_down', '#f59e0b'],
              ['retired', '#ef4444'],
            ] as const
          ).map(([status, color]) => (
            <div key={status} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span
                style={{
                  background: color,
                  color: 'white',
                  padding: '2px 8px',
                  borderRadius: '3px',
                  fontSize: '0.85em',
                }}
              >
                {status}
              </span>
              <span style={{ fontWeight: 'bold', fontSize: '1.1em' }}>
                {data.cliPoolHealth[status]}
              </span>
              <span style={{ color: '#666', fontSize: '0.85em' }}>
                {pct(data.cliPoolHealth[status], totalCli)}
              </span>
            </div>
          ))}
        </div>
        {data.cliPoolHealth.cooling_down > totalCli * 0.5 ? (
          <p style={{ color: '#f59e0b', marginTop: '0.5rem', fontSize: '0.85em' }}>
            Warning: more than 50% of CLIs are cooling down — pool capacity may be constrained.
          </p>
        ) : null}
      </section>

      {/* Links to other admin pages */}
      <section>
        <h2 style={{ marginBottom: '0.5rem', fontSize: '1rem' }}>Related dashboards</h2>
        <nav style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {[
            ['CLI pool detail', '/admin/cli-pool'],
            ['Call quality', '/admin/quality'],
            ['Disclosure failures', '/admin/disclosure-failures'],
          ].map(([label, path]) => (
            <a
              key={path}
              href={`${path}?token=${encodeURIComponent(token as string)}`}
              style={{
                padding: '4px 10px',
                background: '#eee',
                borderRadius: '3px',
                textDecoration: 'none',
                color: '#111',
                fontSize: '0.85em',
              }}
            >
              {label}
            </a>
          ))}
        </nav>
      </section>
    </main>
  );
}

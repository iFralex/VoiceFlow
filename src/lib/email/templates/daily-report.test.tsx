import { describe, expect, it } from 'vitest';

import {
  type DailyReportEmailProps,
  renderDailyReportEmail,
} from './daily-report';

function buildProps(
  overrides: Partial<DailyReportEmailProps> = {},
): DailyReportEmailProps {
  return {
    locale: 'it',
    recipientName: 'Mario',
    orgName: 'Acme Auto',
    reportDate: new Date('2026-05-08T00:00:00Z'),
    dashboardUrl: 'https://app.example.com/dashboard',
    preferencesUrl: 'https://app.example.com/settings/notifications',
    kpis: { callsCompleted: 42, qualifiedLeads: 9, appointmentsBooked: 3 },
    topCampaigns: [
      {
        id: 'c1',
        name: 'Riattivazione lead Maggio',
        completed: 30,
        total: 100,
        appointmentsBooked: 2,
      },
      {
        id: 'c2',
        name: 'Conferma appuntamenti',
        completed: 12,
        total: 12,
        appointmentsBooked: 1,
      },
    ],
    recentAppointments: [
      {
        id: 'a1',
        contactName: 'Luca Bianchi',
        scheduledAt: new Date('2026-05-12T09:30:00Z'),
        campaignName: 'Riattivazione lead Maggio',
      },
    ],
    ...overrides,
  };
}

describe('renderDailyReportEmail', () => {
  it('returns subject, html and text for the Italian locale', async () => {
    const result = await renderDailyReportEmail(buildProps());

    expect(result.subject).toContain('Report giornaliero');
    expect(result.subject).toContain('42 chiamate');
    expect(result.html).toContain('<html');
    expect(result.html).toContain('Riepilogo della giornata');
    expect(result.html).toContain('Riattivazione lead Maggio');
    expect(result.html).toContain('Luca Bianchi');
    expect(result.html).toContain('https://app.example.com/dashboard');
    expect(result.html).toContain('https://app.example.com/settings/notifications');
    expect(result.text.toLowerCase()).toContain('riepilogo della giornata');
    expect(result.text).toContain('Acme Auto');
  });

  it('uses English strings when locale is en', async () => {
    const result = await renderDailyReportEmail(buildProps({ locale: 'en' }));

    expect(result.subject).toContain('Daily report');
    expect(result.subject).toContain('42 calls');
    expect(result.html).toMatch(/Yesterday(&#x27;|')s summary/);
    expect(result.html).toContain('Open dashboard');
    expect(result.html).toContain('Manage notification preferences');
    expect(result.html).not.toContain('Vai alla dashboard');
  });

  it('renders empty-state copy when there are no campaigns or appointments', async () => {
    const result = await renderDailyReportEmail(
      buildProps({ topCampaigns: [], recentAppointments: [] }),
    );

    expect(result.html).toContain('Nessuna campagna attiva.');
    expect(result.html).toContain('Nessun appuntamento fissato.');
  });

  it('caps appointments at 10 rows', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `a-${i}`,
      contactName: `Contact ${i}`,
      scheduledAt: new Date('2026-05-12T09:30:00Z'),
      campaignName: 'Campaign',
    }));

    const result = await renderDailyReportEmail(
      buildProps({ recentAppointments: many }),
    );

    expect(result.html).toContain('Contact 0');
    expect(result.html).toContain('Contact 9');
    expect(result.html).not.toContain('Contact 10');
  });

  it('caps top campaigns at 5 rows', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `c-${i}`,
      name: `Campaign ${i}`,
      completed: i,
      total: 10,
      appointmentsBooked: 0,
    }));

    const result = await renderDailyReportEmail(
      buildProps({ topCampaigns: many }),
    );

    expect(result.html).toContain('Campaign 0');
    expect(result.html).toContain('Campaign 4');
    expect(result.html).not.toContain('Campaign 5');
  });

  it('falls back to org name when recipient name is blank', async () => {
    const result = await renderDailyReportEmail(
      buildProps({ recipientName: '   ' }),
    );

    expect(result.html).toContain('Ciao Acme Auto');
  });
});

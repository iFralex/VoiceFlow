import { describe, expect, it } from 'vitest';

import { renderWeeklySummaryEmail, type WeeklySummaryEmailProps } from './weekly-summary';

function buildProps(overrides: Partial<WeeklySummaryEmailProps> = {}): WeeklySummaryEmailProps {
  return {
    locale: 'it',
    recipientName: 'Mario Rossi',
    orgName: 'Acme Auto',
    weekStart: new Date('2026-05-04T00:00:00Z'),
    weekEnd: new Date('2026-05-10T23:59:59Z'),
    totalCalls: 150,
    completedCalls: 120,
    failedCalls: 30,
    qualifiedLeads: 25,
    appointments: 10,
    topCampaigns: [
      { id: 'c1', name: 'Campagna Maggio', appointments: 5, calls: 60, qualifiedLeads: 12 },
    ],
    alerts: [],
    dashboardUrl: 'https://app.example.com/dashboard',
    preferencesUrl: 'https://app.example.com/settings/notifications',
    appUrl: 'https://app.example.com',
    ...overrides,
  };
}

describe('renderWeeklySummaryEmail', () => {
  it('renders Italian subject and html without error', async () => {
    const result = await renderWeeklySummaryEmail(buildProps());
    expect(result.subject).toContain('riepilogo settimanale');
    expect(result.html).toContain('<html');
    expect(result.html).toContain('KPI settimanali');
    expect(result.html).toContain('Chiamate totali');
  });

  it('uses English strings when locale is en', async () => {
    const result = await renderWeeklySummaryEmail(buildProps({ locale: 'en' }));
    expect(result.subject).toContain('weekly summary');
    expect(result.html).toContain('Weekly KPIs');
    expect(result.html).toContain('Total calls');
    expect(result.html).not.toContain('KPI settimanali');
    expect(result.html).not.toContain('Chiamate totali');
  });

  it('includes top campaign name in output', async () => {
    const result = await renderWeeklySummaryEmail(buildProps());
    expect(result.html).toContain('Campagna Maggio');
    expect(result.html).toContain('Top campagne');
  });

  it('shows no-alerts message when alerts array is empty (Italian)', async () => {
    const result = await renderWeeklySummaryEmail(buildProps({ alerts: [] }));
    expect(result.html).toContain('Nessun avviso per questa settimana');
  });

  it('shows no-alerts message when alerts array is empty (English)', async () => {
    const result = await renderWeeklySummaryEmail(buildProps({ locale: 'en', alerts: [] }));
    expect(result.html).toContain('No alerts this week');
  });

  it('renders alert message in Italian when alerts are present', async () => {
    const result = await renderWeeklySummaryEmail(
      buildProps({ alerts: [{ type: 'warning', campaignName: 'Spring 2024', failed: 10, total: 20 }] }),
    );
    expect(result.html).toContain('Spring 2024');
    expect(result.html).toContain('10/20');
    expect(result.html).not.toContain('Nessun avviso');
  });

  it('renders alert message in English when locale is en', async () => {
    const result = await renderWeeklySummaryEmail(
      buildProps({ locale: 'en', alerts: [{ type: 'warning', campaignName: 'Spring 2024', failed: 10, total: 20 }] }),
    );
    expect(result.html).toContain('Spring 2024');
    expect(result.html).toContain('high failure rate');
  });

  it('includes dashboard CTA with correct link', async () => {
    const result = await renderWeeklySummaryEmail(buildProps());
    expect(result.html).toContain('https://app.example.com/dashboard');
    expect(result.html).toContain('Vai alla dashboard');
  });

  it('includes English dashboard CTA when locale is en', async () => {
    const result = await renderWeeklySummaryEmail(buildProps({ locale: 'en' }));
    expect(result.html).toContain('Go to dashboard');
  });

  it('includes preferences URL in footer', async () => {
    const result = await renderWeeklySummaryEmail(buildProps());
    expect(result.html).toContain('https://app.example.com/settings/notifications');
    expect(result.html).toContain('Gestisci le preferenze di notifica');
  });

  it('falls back to org name when recipientName is blank', async () => {
    const result = await renderWeeklySummaryEmail(buildProps({ recipientName: '' }));
    expect(result.html).toContain('Ciao Acme Auto');
  });

  it('greets by recipient name when provided', async () => {
    const result = await renderWeeklySummaryEmail(buildProps({ recipientName: 'Mario Rossi' }));
    expect(result.html).toContain('Ciao Mario Rossi');
  });

  it('produces non-empty plain text output', async () => {
    const result = await renderWeeklySummaryEmail(buildProps());
    expect(result.text.length).toBeGreaterThan(10);
    expect(result.text.toLowerCase()).toContain('acme auto');
  });
});

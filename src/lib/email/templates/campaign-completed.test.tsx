import { describe, expect, it } from 'vitest';

import { CampaignCompletedEmail, renderCampaignCompletedEmail } from './campaign-completed';

const baseProps = {
  locale: 'it' as const,
  orgName: 'Concessionaria Roma',
  campaignName: 'Campagna Primavera 2024',
  totalCalls: 120,
  completedCalls: 98,
  failedCalls: 22,
  qualifiedLeads: 15,
  appointments: 8,
  totalCostCents: 4800,
  avgDurationSeconds: 185,
  campaignUrl: 'https://app.voiceflow.it/campaigns/abc123',
  reportDownloadUrl: 'https://app.voiceflow.it/campaigns/abc123/report?token=xyz',
  preferencesUrl: 'https://app.voiceflow.it/settings/notifications',
};

describe('CampaignCompletedEmail', () => {
  it('renders without throwing', () => {
    expect(() => <CampaignCompletedEmail {...baseProps} />).not.toThrow();
  });

  it('renders in English without throwing', () => {
    expect(() => <CampaignCompletedEmail {...baseProps} locale="en" />).not.toThrow();
  });
});

describe('renderCampaignCompletedEmail', () => {
  it('includes campaign name in Italian subject', async () => {
    const { subject } = await renderCampaignCompletedEmail(baseProps);
    expect(subject).toBe('Campagna conclusa — Campagna Primavera 2024');
  });

  it('includes campaign name in English subject', async () => {
    const { subject } = await renderCampaignCompletedEmail({ ...baseProps, locale: 'en' });
    expect(subject).toBe('Campaign completed — Campagna Primavera 2024');
  });

  it('includes KPI values in HTML body', async () => {
    const { html } = await renderCampaignCompletedEmail(baseProps);
    expect(html).toContain('120');
    expect(html).toContain('98');
    expect(html).toContain('22');
    expect(html).toContain('15');
    expect(html).toContain('8');
  });

  it('includes report download URL in HTML body', async () => {
    const { html } = await renderCampaignCompletedEmail(baseProps);
    expect(html).toContain(baseProps.reportDownloadUrl);
  });

  it('includes campaign URL in HTML body', async () => {
    const { html } = await renderCampaignCompletedEmail(baseProps);
    expect(html).toContain(baseProps.campaignUrl);
  });

  it('includes preferences URL in HTML body', async () => {
    const { html } = await renderCampaignCompletedEmail(baseProps);
    expect(html).toContain(baseProps.preferencesUrl);
  });

  it('formats cost as currency (Italian)', async () => {
    const { html } = await renderCampaignCompletedEmail(baseProps);
    expect(html).toContain('48');
  });

  it('formats avg duration', async () => {
    const { html } = await renderCampaignCompletedEmail(baseProps);
    expect(html).toContain('3 min');
  });

  it('greets with recipientName when provided', async () => {
    const { html } = await renderCampaignCompletedEmail({ ...baseProps, recipientName: 'Mario' });
    expect(html).toContain('Mario');
  });

  it('falls back to orgName in greeting when recipientName is absent', async () => {
    const { html } = await renderCampaignCompletedEmail(baseProps);
    expect(html).toContain(baseProps.orgName);
  });

  it('produces plain-text output', async () => {
    const { text } = await renderCampaignCompletedEmail(baseProps);
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('120');
  });

  it('uses lang="it" for Italian locale', async () => {
    const { html } = await renderCampaignCompletedEmail(baseProps);
    expect(html).toContain('lang="it"');
  });

  it('uses lang="en" for English locale', async () => {
    const { html } = await renderCampaignCompletedEmail({ ...baseProps, locale: 'en' });
    expect(html).toContain('lang="en"');
  });

  it('includes appUrl as logo link when provided', async () => {
    const { html } = await renderCampaignCompletedEmail({
      ...baseProps,
      appUrl: 'https://app.voiceflow.it',
    });
    expect(html).toContain('https://app.voiceflow.it');
  });

  it('shows Italian download CTA text', async () => {
    const { html } = await renderCampaignCompletedEmail(baseProps);
    expect(html).toContain('Scarica report');
  });

  it('shows English download CTA text', async () => {
    const { html } = await renderCampaignCompletedEmail({ ...baseProps, locale: 'en' });
    expect(html).toContain('Download report');
  });
});

import { describe, expect, it } from 'vitest';

import { LowBalanceEmail, renderLowBalanceEmail } from './low-balance';

const baseProps = {
  locale: 'it' as const,
  orgName: 'Concessionaria Roma',
  remainingMinutes: 45,
  avgDailyMinutes: 30,
  estimatedDaysRemaining: 1,
  topupUrl: 'https://app.voiceflow.it/credit/topup',
  preferencesUrl: 'https://app.voiceflow.it/settings/notifications',
};

describe('LowBalanceEmail', () => {
  it('renders without throwing', () => {
    expect(() => <LowBalanceEmail {...baseProps} />).not.toThrow();
  });

  it('renders in English without throwing', () => {
    expect(() => <LowBalanceEmail {...baseProps} locale="en" />).not.toThrow();
  });
});

describe('renderLowBalanceEmail', () => {
  it('includes remaining minutes in Italian subject', async () => {
    const { subject } = await renderLowBalanceEmail(baseProps);
    expect(subject).toBe('Credito basso — restano 45 minuti');
  });

  it('includes remaining minutes in English subject', async () => {
    const { subject } = await renderLowBalanceEmail({ ...baseProps, locale: 'en' });
    expect(subject).toBe('Low balance — 45 minutes remaining');
  });

  it('includes remaining minutes in HTML body', async () => {
    const { html } = await renderLowBalanceEmail(baseProps);
    expect(html).toContain('45');
  });

  it('includes topup URL in HTML body', async () => {
    const { html } = await renderLowBalanceEmail(baseProps);
    expect(html).toContain(baseProps.topupUrl);
  });

  it('includes preferences URL in HTML body', async () => {
    const { html } = await renderLowBalanceEmail(baseProps);
    expect(html).toContain(baseProps.preferencesUrl);
  });

  it('shows avg daily consumption', async () => {
    const { html } = await renderLowBalanceEmail(baseProps);
    expect(html).toContain('30');
  });

  it('shows estimated days remaining', async () => {
    const { html } = await renderLowBalanceEmail({ ...baseProps, estimatedDaysRemaining: 2 });
    const { html: html2 } = await renderLowBalanceEmail({ ...baseProps, locale: 'en', estimatedDaysRemaining: 2 });
    expect(html).toContain('2');
    expect(html2).toContain('2');
  });

  it('shows "meno di un giorno" when estimated < 1 for Italian', async () => {
    const { html } = await renderLowBalanceEmail({ ...baseProps, estimatedDaysRemaining: 0 });
    expect(html.toLowerCase()).toContain('meno di un giorno');
  });

  it('shows "Less than a day" when estimated < 1 for English', async () => {
    const { html } = await renderLowBalanceEmail({
      ...baseProps,
      locale: 'en',
      estimatedDaysRemaining: 0,
    });
    expect(html).toContain('Less than a day');
  });

  it('greets with recipientName when provided', async () => {
    const { html } = await renderLowBalanceEmail({ ...baseProps, recipientName: 'Mario' });
    expect(html).toContain('Mario');
  });

  it('falls back to orgName in greeting when recipientName is absent', async () => {
    const { html } = await renderLowBalanceEmail(baseProps);
    expect(html).toContain(baseProps.orgName);
  });

  it('produces plain-text output', async () => {
    const { text } = await renderLowBalanceEmail(baseProps);
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('45');
  });

  it('uses lang="it" for Italian locale', async () => {
    const { html } = await renderLowBalanceEmail(baseProps);
    expect(html).toContain('lang="it"');
  });

  it('uses lang="en" for English locale', async () => {
    const { html } = await renderLowBalanceEmail({ ...baseProps, locale: 'en' });
    expect(html).toContain('lang="en"');
  });

  it('includes appUrl as logo link when provided', async () => {
    const { html } = await renderLowBalanceEmail({
      ...baseProps,
      appUrl: 'https://app.voiceflow.it',
    });
    expect(html).toContain('https://app.voiceflow.it');
  });
});

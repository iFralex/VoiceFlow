import { describe, expect, it } from 'vitest';

import {
  type QualifiedLeadEmailProps,
  renderQualifiedLeadEmail,
} from './qualified-lead';

function buildProps(
  overrides: Partial<QualifiedLeadEmailProps> = {},
): QualifiedLeadEmailProps {
  return {
    locale: 'it',
    recipientName: 'Mario Rossi',
    orgName: 'Acme Auto',
    contactName: 'Luca Bianchi',
    contactPhone: '+39 02 1234567',
    contactEmail: 'luca.bianchi@example.com',
    aiSummary:
      'Il cliente ha espresso forte interesse per un SUV elettrico. Ha richiesto informazioni sul finanziamento.',
    recommendedNextAction: 'Chiamare entro 24 ore per proporre un test drive.',
    campaignName: 'Campagna Primavera 2026',
    callDetailUrl: 'https://app.example.com/calls/call-456',
    preferencesUrl: 'https://app.example.com/settings/notifications',
    appUrl: 'https://app.example.com',
    ...overrides,
  };
}

describe('renderQualifiedLeadEmail', () => {
  it('returns subject, html and text for the Italian locale', async () => {
    const result = await renderQualifiedLeadEmail(buildProps());

    expect(result.subject).toContain('Nuovo lead qualificato');
    expect(result.subject).toContain('Luca Bianchi');
    expect(result.html).toContain('<html');
    expect(result.html).toContain('Luca Bianchi');
    expect(result.html).toContain('+39 02 1234567');
    expect(result.html).toContain('luca.bianchi@example.com');
    expect(result.html).toContain('Campagna Primavera 2026');
    expect(result.html).toContain('https://app.example.com/calls/call-456');
    expect(result.html).toContain('https://app.example.com/settings/notifications');
    expect(result.html).toContain('Richiama il contatto');
    expect(result.text.toLowerCase()).toContain('luca bianchi');
  });

  it('uses English strings when locale is en', async () => {
    const result = await renderQualifiedLeadEmail(buildProps({ locale: 'en' }));

    expect(result.subject).toContain('New qualified lead');
    expect(result.subject).toContain('Luca Bianchi');
    expect(result.html).toContain('Call the contact');
    expect(result.html).toContain('Manage notification preferences');
    expect(result.html).not.toContain('Richiama il contatto');
    expect(result.html).not.toContain('Nuovo lead qualificato');
  });

  it('includes click-to-call tel: link for contact phone', async () => {
    const result = await renderQualifiedLeadEmail(buildProps());

    expect(result.html).toContain('tel:+39 02 1234567');
  });

  it('includes AI summary when provided', async () => {
    const result = await renderQualifiedLeadEmail(buildProps());

    expect(result.html).toContain('Sintesi AI');
    expect(result.html).toContain('forte interesse per un SUV elettrico');
  });

  it('omits AI summary section when not provided', async () => {
    const { aiSummary: _omit, ...rest } = buildProps();
    const result = await renderQualifiedLeadEmail(rest);

    expect(result.html).not.toContain('Sintesi AI');
  });

  it('includes recommended next action when provided', async () => {
    const result = await renderQualifiedLeadEmail(buildProps());

    expect(result.html).toContain('Prossimo passo consigliato');
    expect(result.html).toContain('Chiamare entro 24 ore');
  });

  it('omits next action section when not provided', async () => {
    const { recommendedNextAction: _omit, ...rest } = buildProps();
    const result = await renderQualifiedLeadEmail(rest);

    expect(result.html).not.toContain('Prossimo passo consigliato');
  });

  it('shows email fallback when contact email is absent', async () => {
    const { contactEmail: _omit, ...rest } = buildProps();
    const result = await renderQualifiedLeadEmail(rest);

    expect(result.html).toContain('Non disponibile');
  });

  it('falls back to org name when recipient name is blank', async () => {
    const result = await renderQualifiedLeadEmail(
      buildProps({ recipientName: '   ' }),
    );

    expect(result.html).toContain('Ciao Acme Auto');
  });

  it('renders footer with call detail and preferences links', async () => {
    const result = await renderQualifiedLeadEmail(buildProps());

    expect(result.html).toContain('Gestisci le preferenze di notifica');
    expect(result.html).toContain('Vedi dettaglio chiamata');
    expect(result.html).toContain('Acme Auto');
  });
});

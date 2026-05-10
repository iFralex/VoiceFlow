import { describe, expect, it } from 'vitest';

import {
  type AppointmentBookedEmailProps,
  renderAppointmentBookedEmail,
} from './appointment-booked';

function buildProps(
  overrides: Partial<AppointmentBookedEmailProps> = {},
): AppointmentBookedEmailProps {
  return {
    locale: 'it',
    recipientName: 'Mario Rossi',
    orgName: 'Acme Auto',
    contactName: 'Luca Bianchi',
    scheduledAt: new Date('2026-05-20T10:30:00Z'),
    serviceType: 'Tagliando',
    campaignName: 'Campagna Primavera 2026',
    transcriptSnippet:
      "Ho parlato con il signor Bianchi e abbiamo concordato un appuntamento per il tagliando.",
    callDetailUrl: 'https://app.example.com/calls/call-123',
    preferencesUrl: 'https://app.example.com/settings/notifications',
    appUrl: 'https://app.example.com',
    ...overrides,
  };
}

describe('renderAppointmentBookedEmail', () => {
  it('returns subject, html and text for the Italian locale', async () => {
    const result = await renderAppointmentBookedEmail(buildProps());

    expect(result.subject).toContain('Appuntamento fissato');
    expect(result.subject).toContain('Luca Bianchi');
    expect(result.html).toContain('<html');
    expect(result.html).toContain('Luca Bianchi');
    expect(result.html).toContain('Tagliando');
    expect(result.html).toContain('Campagna Primavera 2026');
    expect(result.html).toContain('https://app.example.com/calls/call-123');
    expect(result.html).toContain('https://app.example.com/settings/notifications');
    expect(result.html).toContain('Apri scheda chiamata');
    expect(result.text.toLowerCase()).toContain('luca bianchi');
  });

  it('uses English strings when locale is en', async () => {
    const result = await renderAppointmentBookedEmail(buildProps({ locale: 'en' }));

    expect(result.subject).toContain('Appointment booked');
    expect(result.subject).toContain('Luca Bianchi');
    expect(result.html).toContain('Open call record');
    expect(result.html).toContain('Manage notification preferences');
    expect(result.html).not.toContain('Apri scheda chiamata');
    expect(result.html).not.toContain('Appuntamento fissato');
  });

  it('includes transcript snippet when provided', async () => {
    const result = await renderAppointmentBookedEmail(buildProps());

    expect(result.html).toContain('Estratto dalla chiamata');
    expect(result.html).toContain(
      "Ho parlato con il signor Bianchi",
    );
  });

  it('omits transcript section when snippet is absent', async () => {
    const base = buildProps();
    const { transcriptSnippet: _omit, ...rest } = base;
    const result = await renderAppointmentBookedEmail(rest);

    expect(result.html).not.toContain('Estratto dalla chiamata');
  });

  it('shows fallback service type when serviceType is not provided', async () => {
    const base = buildProps();
    const { serviceType: _omit, ...rest } = base;
    const result = await renderAppointmentBookedEmail(rest);

    expect(result.html).toContain('Non specificato');
  });

  it('falls back to org name when recipient name is blank', async () => {
    const result = await renderAppointmentBookedEmail(
      buildProps({ recipientName: '   ' }),
    );

    expect(result.html).toContain('Ciao Acme Auto');
  });

  it('renders footer with call detail and preferences links', async () => {
    const result = await renderAppointmentBookedEmail(buildProps());

    expect(result.html).toContain('Gestisci le preferenze di notifica');
    expect(result.html).toContain('Vedi dettaglio chiamata');
    expect(result.html).toContain('Acme Auto');
  });
});

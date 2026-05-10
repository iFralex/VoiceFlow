import { describe, expect, it } from 'vitest';

import {
  renderSuspiciousLoginEmail,
  summariseUserAgent,
  type SuspiciousLoginEmailProps,
} from './suspicious-login';

function buildProps(overrides: Partial<SuspiciousLoginEmailProps> = {}): SuspiciousLoginEmailProps {
  return {
    locale: 'it',
    userEmail: 'mario.rossi@example.com',
    occurredAt: new Date('2026-05-10T14:30:00Z'),
    ip: '192.168.1.100',
    city: 'Milano',
    userAgentSummary: 'Chrome su Windows 10',
    revokeUrl: 'https://app.example.com/auth/revoke-all',
    appUrl: 'https://app.example.com',
    ...overrides,
  };
}

describe('renderSuspiciousLoginEmail', () => {
  it('renders Italian subject and html without error', async () => {
    const result = await renderSuspiciousLoginEmail(buildProps());
    expect(result.subject).toBe('Nuovo accesso al tuo account VoiceFlow');
    expect(result.html).toContain('<html');
    expect(result.html).toContain('Nuovo accesso rilevato');
  });

  it('uses English strings when locale is en', async () => {
    const result = await renderSuspiciousLoginEmail(buildProps({ locale: 'en' }));
    expect(result.subject).toBe('New sign-in to your VoiceFlow account');
    expect(result.html).toContain('New sign-in detected');
    expect(result.html).not.toContain('Nuovo accesso');
  });

  it('includes Italian CTA to revoke sessions', async () => {
    const result = await renderSuspiciousLoginEmail(buildProps());
    expect(result.html).toContain('Non ero io');
    expect(result.html).toContain('https://app.example.com/auth/revoke-all');
  });

  it('includes English CTA to revoke sessions', async () => {
    const result = await renderSuspiciousLoginEmail(buildProps({ locale: 'en' }));
    // Apostrophe is HTML-encoded in the rendered output
    expect(result.html).toContain('secure my account');
    expect(result.html).not.toContain('Non ero io');
  });

  it('includes IP and city together when city is provided', async () => {
    const result = await renderSuspiciousLoginEmail(buildProps());
    expect(result.html).toContain('192.168.1.100');
    expect(result.html).toContain('Milano');
  });

  it('shows IP only when city is absent', async () => {
    const base = buildProps();
    const { city: _omit, ...rest } = base;
    const result = await renderSuspiciousLoginEmail(rest);
    expect(result.html).toContain('192.168.1.100');
    expect(result.html).not.toContain('Milano');
  });

  it('includes user email in the body', async () => {
    const result = await renderSuspiciousLoginEmail(buildProps());
    expect(result.html).toContain('mario.rossi@example.com');
  });

  it('includes user agent summary', async () => {
    const result = await renderSuspiciousLoginEmail(buildProps());
    expect(result.html).toContain('Chrome su Windows 10');
  });

  it('produces non-empty plain text output', async () => {
    const result = await renderSuspiciousLoginEmail(buildProps());
    expect(result.text.length).toBeGreaterThan(10);
    expect(result.text.toLowerCase()).toContain('192.168.1.100');
  });
});

describe('summariseUserAgent', () => {
  it('identifies Chrome on Windows 10/11', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const summary = summariseUserAgent(ua);
    expect(summary).toContain('Chrome');
    expect(summary).toContain('Windows');
  });

  it('identifies Firefox on macOS', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:109.0) Gecko/20100101 Firefox/109.0';
    const summary = summariseUserAgent(ua);
    expect(summary).toContain('Firefox');
    expect(summary).toContain('macOS');
  });

  it('identifies Safari on iOS', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    const summary = summariseUserAgent(ua);
    expect(summary).toContain('Safari');
  });

  it('identifies Edge browser', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';
    const summary = summariseUserAgent(ua);
    expect(summary).toContain('Edge');
  });

  it('returns empty string for empty input', () => {
    expect(summariseUserAgent('')).toBe('');
  });
});

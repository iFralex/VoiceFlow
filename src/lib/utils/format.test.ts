import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  formatCurrency,
  formatDuration,
  formatPhone,
  formatRelativeTime,
} from './format';

// ---------------------------------------------------------------------------
// Helpers to produce expected values using the same Intl APIs as the
// implementation. This ensures locale parameters are wired correctly even in
// environments that fall back to English due to limited ICU data.
// ---------------------------------------------------------------------------

function expectedCurrency(cents: number, locale: string): string {
  const intlLocale = locale === 'it' ? 'it-IT' : locale === 'en' ? 'en-GB' : locale;
  return new Intl.NumberFormat(intlLocale, {
    style: 'currency',
    currency: 'EUR',
  }).format(cents / 100);
}

function expectedRelativeTime(
  diffMs: number,
  locale: string,
): string {
  const intlLocale = locale === 'it' ? 'it-IT' : locale === 'en' ? 'en-GB' : locale;
  const rtf = new Intl.RelativeTimeFormat(intlLocale, { numeric: 'auto' });
  const absDiff = Math.abs(diffMs);
  if (absDiff < 60_000) return rtf.format(Math.round(diffMs / 1_000), 'second');
  if (absDiff < 3_600_000) return rtf.format(Math.round(diffMs / 60_000), 'minute');
  if (absDiff < 86_400_000) return rtf.format(Math.round(diffMs / 3_600_000), 'hour');
  return rtf.format(Math.round(diffMs / 86_400_000), 'day');
}

// ---------------------------------------------------------------------------
// formatCurrency
// ---------------------------------------------------------------------------
describe('formatCurrency', () => {
  it('formats cents as euros in the Italian locale', () => {
    expect(formatCurrency(1099, 'it')).toBe(expectedCurrency(1099, 'it'));
  });

  it('formats cents as euros in the English locale', () => {
    expect(formatCurrency(1099, 'en')).toBe(expectedCurrency(1099, 'en'));
  });

  it('formats zero cents', () => {
    expect(formatCurrency(0, 'it')).toBe(expectedCurrency(0, 'it'));
    expect(formatCurrency(0, 'en')).toBe(expectedCurrency(0, 'en'));
  });

  it('formats a round euro amount', () => {
    expect(formatCurrency(5000, 'it')).toBe(expectedCurrency(5000, 'it'));
  });

  it('defaults to Italian locale', () => {
    expect(formatCurrency(100)).toBe(expectedCurrency(100, 'it'));
  });

  it('always includes the € symbol', () => {
    expect(formatCurrency(999, 'it')).toContain('€');
    expect(formatCurrency(999, 'en')).toContain('€');
  });

  it('includes the numeric amount', () => {
    // 1099 cents = €10.99; the number 10 must appear
    expect(formatCurrency(1099, 'it')).toContain('10');
    expect(formatCurrency(1099, 'en')).toContain('10');
  });
});

// ---------------------------------------------------------------------------
// formatPhone
// ---------------------------------------------------------------------------
describe('formatPhone', () => {
  it('formats an E.164 Italian mobile number', () => {
    expect(formatPhone('+393401234567')).toBe('+39 340 123 4567');
  });

  it('formats a 12-digit Italian number with country code (no +)', () => {
    expect(formatPhone('393401234567')).toBe('+39 340 123 4567');
  });

  it('formats a 10-digit Italian mobile number', () => {
    expect(formatPhone('3401234567')).toBe('+39 340 123 4567');
  });

  it('formats a 10-digit Italian mobile number with dashes', () => {
    expect(formatPhone('340-123-4567')).toBe('+39 340 123 4567');
  });

  it('returns the original string when the number cannot be parsed', () => {
    expect(formatPhone('not-a-phone')).toBe('not-a-phone');
  });

  it('returns the original string for an unrecognised digit count', () => {
    expect(formatPhone('+1234567')).toBe('+1234567');
  });
});

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------
describe('formatDuration', () => {
  it('formats durations under a minute as seconds only', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(1)).toBe('1s');
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(59)).toBe('59s');
  });

  it('formats exactly one minute', () => {
    expect(formatDuration(60)).toBe('1m');
  });

  it('formats minutes with remaining seconds', () => {
    expect(formatDuration(83)).toBe('1m 23s');
    expect(formatDuration(90)).toBe('1m 30s');
    expect(formatDuration(125)).toBe('2m 5s');
  });

  it('formats exact multiples of minutes without a seconds part', () => {
    expect(formatDuration(120)).toBe('2m');
    expect(formatDuration(300)).toBe('5m');
  });

  it('formats longer durations', () => {
    expect(formatDuration(3661)).toBe('61m 1s');
  });
});

// ---------------------------------------------------------------------------
// formatRelativeTime
// ---------------------------------------------------------------------------
describe('formatRelativeTime', () => {
  const NOW = new Date('2024-06-01T12:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats ~30 seconds ago in Italian', () => {
    const date = new Date('2024-06-01T11:59:30Z');
    const diffMs = date.getTime() - NOW.getTime(); // -30_000
    expect(formatRelativeTime(date, 'it')).toBe(expectedRelativeTime(diffMs, 'it'));
  });

  it('formats ~5 minutes ago in Italian', () => {
    const date = new Date('2024-06-01T11:55:00Z');
    const diffMs = date.getTime() - NOW.getTime();
    expect(formatRelativeTime(date, 'it')).toBe(expectedRelativeTime(diffMs, 'it'));
  });

  it('formats ~2 hours ago in Italian', () => {
    const date = new Date('2024-06-01T10:00:00Z');
    const diffMs = date.getTime() - NOW.getTime();
    expect(formatRelativeTime(date, 'it')).toBe(expectedRelativeTime(diffMs, 'it'));
  });

  it('formats ~2 days ago in Italian', () => {
    const date = new Date('2024-05-30T12:00:00Z');
    const diffMs = date.getTime() - NOW.getTime();
    expect(formatRelativeTime(date, 'it')).toBe(expectedRelativeTime(diffMs, 'it'));
  });

  it('formats ~30 seconds ago in English', () => {
    const date = new Date('2024-06-01T11:59:30Z');
    const diffMs = date.getTime() - NOW.getTime();
    expect(formatRelativeTime(date, 'en')).toBe(expectedRelativeTime(diffMs, 'en'));
  });

  it('formats ~5 minutes ago in English', () => {
    const date = new Date('2024-06-01T11:55:00Z');
    const diffMs = date.getTime() - NOW.getTime();
    expect(formatRelativeTime(date, 'en')).toBe(expectedRelativeTime(diffMs, 'en'));
  });

  it('formats ~2 hours ago in English', () => {
    const date = new Date('2024-06-01T10:00:00Z');
    const diffMs = date.getTime() - NOW.getTime();
    expect(formatRelativeTime(date, 'en')).toBe(expectedRelativeTime(diffMs, 'en'));
  });

  it('formats ~2 days ago in English', () => {
    const date = new Date('2024-05-30T12:00:00Z');
    const diffMs = date.getTime() - NOW.getTime();
    expect(formatRelativeTime(date, 'en')).toBe(expectedRelativeTime(diffMs, 'en'));
  });

  it('defaults to Italian locale', () => {
    const date = new Date('2024-06-01T10:00:00Z');
    const diffMs = date.getTime() - NOW.getTime();
    expect(formatRelativeTime(date)).toBe(expectedRelativeTime(diffMs, 'it'));
  });

  it('formats a future time in Italian', () => {
    const date = new Date('2024-06-01T14:00:00Z'); // 2 h in the future
    const diffMs = date.getTime() - NOW.getTime();
    expect(formatRelativeTime(date, 'it')).toBe(expectedRelativeTime(diffMs, 'it'));
  });

  it('uses the second unit for sub-minute differences', () => {
    const date = new Date('2024-06-01T11:59:45Z'); // 15 s ago
    const diffMs = date.getTime() - NOW.getTime();
    expect(formatRelativeTime(date, 'en')).toBe(expectedRelativeTime(diffMs, 'en'));
  });

  it('uses the minute unit for sub-hour differences', () => {
    const date = new Date('2024-06-01T11:30:00Z'); // 30 min ago
    const diffMs = date.getTime() - NOW.getTime();
    expect(formatRelativeTime(date, 'en')).toBe(expectedRelativeTime(diffMs, 'en'));
  });
});

import { describe, expect, it } from 'vitest';

import { parsePeriod, resolvePeriodRange } from '@/components/dashboard/period';

describe('parsePeriod', () => {
  it('returns the value when valid', () => {
    expect(parsePeriod('today')).toBe('today');
    expect(parsePeriod('7d')).toBe('7d');
    expect(parsePeriod('30d')).toBe('30d');
    expect(parsePeriod('month')).toBe('month');
    expect(parsePeriod('prev_month')).toBe('prev_month');
  });

  it('takes the first array element', () => {
    expect(parsePeriod(['30d', 'today'])).toBe('30d');
  });

  it('falls back to 7d for unknown / undefined values', () => {
    expect(parsePeriod(undefined)).toBe('7d');
    expect(parsePeriod('bogus')).toBe('7d');
    expect(parsePeriod([])).toBe('7d');
  });
});

describe('resolvePeriodRange', () => {
  const fixedNow = new Date('2026-05-15T14:30:00.000Z');

  it('returns today as a single-day range', () => {
    const r = resolvePeriodRange('today', fixedNow);
    expect(r.start.getHours()).toBe(0);
    expect(r.start.getMinutes()).toBe(0);
    expect(r.end.getHours()).toBe(23);
    // span is the same calendar day
    expect(r.start.getDate()).toBe(r.end.getDate());
  });

  it('7d covers a 7-day window ending today', () => {
    const r = resolvePeriodRange('7d', fixedNow);
    const days = Math.round(
      (r.end.getTime() - r.start.getTime()) / (1000 * 60 * 60 * 24),
    );
    expect(days).toBeGreaterThanOrEqual(6);
    expect(days).toBeLessThanOrEqual(7);
  });

  it('30d covers a 30-day window ending today', () => {
    const r = resolvePeriodRange('30d', fixedNow);
    const days = Math.round(
      (r.end.getTime() - r.start.getTime()) / (1000 * 60 * 60 * 24),
    );
    expect(days).toBeGreaterThanOrEqual(29);
    expect(days).toBeLessThanOrEqual(30);
  });

  it('month starts at day 1 of the current month', () => {
    const r = resolvePeriodRange('month', fixedNow);
    expect(r.start.getDate()).toBe(1);
    expect(r.start.getMonth()).toBe(fixedNow.getMonth());
  });

  it('prev_month spans the entire previous calendar month', () => {
    const r = resolvePeriodRange('prev_month', fixedNow);
    expect(r.start.getDate()).toBe(1);
    // end is the last instant before the 1st of this month
    expect(r.end.getMonth()).toBe(fixedNow.getMonth() - 1);
  });
});

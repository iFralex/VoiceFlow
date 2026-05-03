import { describe, expect, it } from 'vitest';

import { formatPhone } from './format';

describe('formatPhone', () => {
  it('formats a 10-digit number', () => {
    expect(formatPhone('2125551234')).toBe('+1 (212) 555-1234');
  });

  it('formats a 10-digit number with dashes', () => {
    expect(formatPhone('212-555-1234')).toBe('+1 (212) 555-1234');
  });

  it('formats an 11-digit number starting with 1', () => {
    expect(formatPhone('12125551234')).toBe('+1 (212) 555-1234');
  });

  it('returns the original string when the number cannot be parsed', () => {
    expect(formatPhone('not-a-phone')).toBe('not-a-phone');
  });
});

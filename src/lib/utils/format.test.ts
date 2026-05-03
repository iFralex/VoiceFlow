import { describe, expect, it } from 'vitest';

import { formatPhone } from './format';

describe('formatPhone', () => {
  it('formats a 10-digit Italian mobile number', () => {
    expect(formatPhone('3401234567')).toBe('+39 340 123 4567');
  });

  it('formats a 10-digit Italian mobile number with dashes', () => {
    expect(formatPhone('340-123-4567')).toBe('+39 340 123 4567');
  });

  it('formats a 12-digit Italian number with country code', () => {
    expect(formatPhone('393401234567')).toBe('+39 340 123 4567');
  });

  it('returns the original string when the number cannot be parsed', () => {
    expect(formatPhone('not-a-phone')).toBe('not-a-phone');
  });
});

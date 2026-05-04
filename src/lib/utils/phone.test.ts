import { describe, expect, it } from 'vitest';

import { classifyLineType, formatItalianDisplay, normaliseToE164 } from './phone';

// ---------------------------------------------------------------------------
// normaliseToE164
// ---------------------------------------------------------------------------
describe('normaliseToE164', () => {
  it('normalises a 10-digit Italian mobile number with IT fallback', () => {
    expect(normaliseToE164('3401234567')).toBe('+393401234567');
  });

  it('normalises an Italian mobile with "+39" prefix', () => {
    expect(normaliseToE164('+393401234567')).toBe('+393401234567');
  });

  it('normalises an Italian mobile with "0039" IDD prefix', () => {
    expect(normaliseToE164('00393401234567')).toBe('+393401234567');
  });

  it('strips whitespace before parsing', () => {
    expect(normaliseToE164('+39 340 123 4567')).toBe('+393401234567');
  });

  it('normalises a 12-digit Italian number starting with 39 (no + sign)', () => {
    expect(normaliseToE164('393401234567')).toBe('+393401234567');
  });

  it('normalises an Italian fixed line number (leading zero area code)', () => {
    // Milan area code 02
    expect(normaliseToE164('0212345678')).toBe('+390212345678');
  });

  it('normalises an Italian fixed line with "0039" IDD prefix', () => {
    expect(normaliseToE164('0039 02 12345678')).toBe('+390212345678');
  });

  it('returns null for a malformed input', () => {
    expect(normaliseToE164('not-a-phone')).toBeNull();
  });

  it('returns null for a number too short to be valid', () => {
    expect(normaliseToE164('123')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(normaliseToE164('')).toBeNull();
  });

  it('uses the IT default country when no country code is given', () => {
    // Without +39 or 0039 the library uses the IT default
    const result = normaliseToE164('3401234567');
    expect(result).toBe('+393401234567');
  });

  it('accepts an explicit country override', () => {
    // A US number
    const result = normaliseToE164('2025550173', 'US');
    expect(result).toBe('+12025550173');
  });
});

// ---------------------------------------------------------------------------
// classifyLineType
// ---------------------------------------------------------------------------
describe('classifyLineType', () => {
  it('classifies an Italian mobile number as mobile', () => {
    expect(classifyLineType('+393401234567')).toBe('mobile');
  });

  it('classifies a different Italian mobile prefix as mobile', () => {
    expect(classifyLineType('+393331234567')).toBe('mobile');
  });

  it('classifies an Italian fixed line as fixed', () => {
    // Milan: +39 02 …
    expect(classifyLineType('+390212345678')).toBe('fixed');
  });

  it('classifies a Rome fixed line as fixed', () => {
    // Rome area code 06
    expect(classifyLineType('+390612345678')).toBe('fixed');
  });

  it('returns unknown for a malformed / unparseable E.164 string', () => {
    expect(classifyLineType('not-e164')).toBe('unknown');
  });

  it('returns unknown for an empty string', () => {
    expect(classifyLineType('')).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// formatItalianDisplay
// ---------------------------------------------------------------------------
describe('formatItalianDisplay', () => {
  it('formats an Italian mobile in international display format', () => {
    expect(formatItalianDisplay('+393401234567')).toBe('+39 340 123 4567');
  });

  it('formats an Italian fixed line in international display format', () => {
    expect(formatItalianDisplay('+390212345678')).toBe('+39 02 1234 5678');
  });

  it('returns the original string for an unrecognised number', () => {
    const bad = 'not-a-number';
    expect(formatItalianDisplay(bad)).toBe(bad);
  });
});

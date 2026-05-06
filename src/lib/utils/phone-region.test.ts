import { describe, expect, it } from 'vitest';

import { inferRegionFromPhone } from './phone-region';

describe('inferRegionFromPhone', () => {
  it('returns milano for an E.164 starting with +3902', () => {
    expect(inferRegionFromPhone('+390212345678')).toBe('milano');
  });

  it('returns roma for an E.164 starting with +3906', () => {
    expect(inferRegionFromPhone('+390612345678')).toBe('roma');
  });

  it('returns torino for an E.164 starting with +39011', () => {
    expect(inferRegionFromPhone('+39011123456')).toBe('torino');
  });

  it('returns napoli for an E.164 starting with +39081', () => {
    expect(inferRegionFromPhone('+39081123456')).toBe('napoli');
  });

  it('returns bologna for an E.164 starting with +39051', () => {
    expect(inferRegionFromPhone('+39051123456')).toBe('bologna');
  });

  it('returns padova for an E.164 starting with +39049', () => {
    expect(inferRegionFromPhone('+39049123456')).toBe('padova');
  });

  it('returns venezia for an E.164 starting with +39041', () => {
    expect(inferRegionFromPhone('+39041123456')).toBe('venezia');
  });

  it('returns bari for an E.164 starting with +39080', () => {
    expect(inferRegionFromPhone('+39080123456')).toBe('bari');
  });

  it('returns palermo for an E.164 starting with +39091', () => {
    expect(inferRegionFromPhone('+39091123456')).toBe('palermo');
  });

  it('returns genova for an E.164 starting with +39010', () => {
    expect(inferRegionFromPhone('+39010123456')).toBe('genova');
  });

  it('returns firenze for an E.164 starting with +39055', () => {
    expect(inferRegionFromPhone('+39055123456')).toBe('firenze');
  });

  it('returns catania for an E.164 starting with +39095', () => {
    expect(inferRegionFromPhone('+39095123456')).toBe('catania');
  });

  it('returns undefined for Italian mobile numbers (3xx)', () => {
    expect(inferRegionFromPhone('+393401234567')).toBeUndefined();
    expect(inferRegionFromPhone('+393311234567')).toBeUndefined();
  });

  it('returns undefined for non-Italian numbers', () => {
    expect(inferRegionFromPhone('+14155551234')).toBeUndefined();
    expect(inferRegionFromPhone('+447400123456')).toBeUndefined();
  });

  it('returns undefined for empty/null/undefined input', () => {
    expect(inferRegionFromPhone('')).toBeUndefined();
    expect(inferRegionFromPhone(null)).toBeUndefined();
    expect(inferRegionFromPhone(undefined)).toBeUndefined();
  });

  it('accepts national format without the country prefix', () => {
    expect(inferRegionFromPhone('0212345678')).toBe('milano');
    expect(inferRegionFromPhone('0511234567')).toBe('bologna');
  });
});

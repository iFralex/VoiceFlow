import { describe, expect, it } from 'vitest';

import { phoneNumberSeedData } from './phone_numbers';

describe('phoneNumberSeedData', () => {
  it('contains 15 DIDs (10 Voiped + 5 Twilio)', () => {
    expect(phoneNumberSeedData).toHaveLength(15);
    expect(phoneNumberSeedData.filter((p) => p.provider === 'voiped')).toHaveLength(10);
    expect(phoneNumberSeedData.filter((p) => p.provider === 'twilio')).toHaveLength(5);
  });

  it('contains a mix of mobile and landline DIDs in the Voiped pool', () => {
    const voiped = phoneNumberSeedData.filter((p) => p.provider === 'voiped');
    const mobile = voiped.filter((p) => p.capabilities?.includes('mobile'));
    const landline = voiped.filter((p) => p.capabilities?.includes('landline'));
    expect(mobile).toHaveLength(3);
    expect(landline).toHaveLength(7);
  });

  it('spreads landlines across the major Italian metros', () => {
    const regions = new Set(
      phoneNumberSeedData
        .filter((p) => p.capabilities?.includes('landline'))
        .map((p) => p.region),
    );
    expect(regions).toContain('milano');
    expect(regions).toContain('roma');
    expect(regions).toContain('torino');
    expect(regions).toContain('napoli');
    expect(regions).toContain('bologna');
  });

  it('has every row scoped to the shared pool (org_id null)', () => {
    for (const row of phoneNumberSeedData) {
      expect(row.org_id ?? null).toBeNull();
    }
  });

  it('starts every row in active status with zero usage', () => {
    for (const row of phoneNumberSeedData) {
      expect(row.status).toBe('active');
      expect(row.daily_call_count).toBe(0);
      expect(row.spam_score).toBe('0');
    }
  });

  it('uses E.164 format (leading +39) for every DID', () => {
    for (const row of phoneNumberSeedData) {
      expect(row.e164).toMatch(/^\+39\d+$/);
    }
  });

  it('mobile DIDs have null region (no inferable area)', () => {
    const mobile = phoneNumberSeedData.filter((p) => p.capabilities?.includes('mobile'));
    for (const row of mobile) {
      expect(row.region ?? null).toBeNull();
    }
  });

  it('contains only unique e164 values', () => {
    const seen = new Set(phoneNumberSeedData.map((p) => p.e164));
    expect(seen.size).toBe(phoneNumberSeedData.length);
  });
});

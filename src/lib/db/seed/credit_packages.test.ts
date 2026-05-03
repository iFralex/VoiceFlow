import { describe, expect, it } from 'vitest';

import { creditPackageSeedData } from './credit_packages';

const EXPECTED_SLUGS = ['test', 'starter', 'growth', 'scale', 'enterprise'];

describe('credit_packages seed data', () => {
  it('contains exactly five packages', () => {
    expect(creditPackageSeedData).toHaveLength(5);
  });

  it('has all expected slugs', () => {
    const slugs = creditPackageSeedData.map((p) => p.slug);
    expect(slugs).toEqual(expect.arrayContaining(EXPECTED_SLUGS));
    expect(slugs).toHaveLength(EXPECTED_SLUGS.length);
  });

  it('test package has price 9900 cents (€99) and 200 minutes', () => {
    const p = creditPackageSeedData.find((x) => x.slug === 'test')!;
    expect(p.price_cents).toBe(9900);
    expect(p.included_minutes).toBe(200);
    expect(p.active).toBe(true);
  });

  it('starter package has price 29900 cents (€299) and 700 minutes', () => {
    const p = creditPackageSeedData.find((x) => x.slug === 'starter')!;
    expect(p.price_cents).toBe(29900);
    expect(p.included_minutes).toBe(700);
    expect(p.active).toBe(true);
  });

  it('growth package has price 79900 cents (€799) and 2000 minutes', () => {
    const p = creditPackageSeedData.find((x) => x.slug === 'growth')!;
    expect(p.price_cents).toBe(79900);
    expect(p.included_minutes).toBe(2000);
    expect(p.active).toBe(true);
  });

  it('scale package has price 199900 cents (€1999) and 5500 minutes', () => {
    const p = creditPackageSeedData.find((x) => x.slug === 'scale')!;
    expect(p.price_cents).toBe(199900);
    expect(p.included_minutes).toBe(5500);
    expect(p.active).toBe(true);
  });

  it('enterprise package is inactive (custom only)', () => {
    const p = creditPackageSeedData.find((x) => x.slug === 'enterprise')!;
    expect(p.active).toBe(false);
  });

  it('all packages have stripe_price_id as null initially', () => {
    for (const p of creditPackageSeedData) {
      expect(p.stripe_price_id).toBeNull();
    }
  });

  it('every package has a non-empty display_name', () => {
    for (const p of creditPackageSeedData) {
      expect(typeof p.display_name).toBe('string');
      expect(p.display_name!.length).toBeGreaterThan(0);
    }
  });

  it('every active package has price_cents > 0', () => {
    const activePackages = creditPackageSeedData.filter((p) => p.active);
    for (const p of activePackages) {
      expect(p.price_cents).toBeGreaterThan(0);
    }
  });

  it('every active package has included_minutes > 0', () => {
    const activePackages = creditPackageSeedData.filter((p) => p.active);
    for (const p of activePackages) {
      expect(p.included_minutes).toBeGreaterThan(0);
    }
  });

  it('active packages are in ascending price order', () => {
    const activePackages = creditPackageSeedData.filter((p) => p.active);
    for (let i = 1; i < activePackages.length; i++) {
      const prev = activePackages[i - 1]!;
      const curr = activePackages[i]!;
      expect(curr.price_cents).toBeGreaterThan(prev.price_cents!);
    }
  });
});

import { describe, expect, it } from 'vitest';

import stripeProductsJson from '../../stripe/products.json';

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

  it('stripe_price_id for each package matches products.json mapping', () => {
    const priceMap = new Map(
      stripeProductsJson.packages.map((p) => [p.slug, p.stripe_price_id]),
    );
    for (const p of creditPackageSeedData) {
      const expected = priceMap.get(p.slug) ?? null;
      expect(p.stripe_price_id).toBe(expected);
    }
  });

  it('enterprise package always has null stripe_price_id (custom pricing)', () => {
    const p = creditPackageSeedData.find((x) => x.slug === 'enterprise')!;
    expect(p.stripe_price_id).toBeNull();
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

describe('stripe/products.json structure', () => {
  it('defines exactly four Stripe packages (enterprise is custom, no Stripe product)', () => {
    expect(stripeProductsJson.packages).toHaveLength(4);
  });

  it('has entries for test, starter, growth, and scale slugs', () => {
    const slugs = stripeProductsJson.packages.map((p) => p.slug);
    expect(slugs).toEqual(expect.arrayContaining(['test', 'starter', 'growth', 'scale']));
  });

  it('every entry has the required metadata fields', () => {
    for (const p of stripeProductsJson.packages) {
      expect(p).toHaveProperty('slug');
      expect(p).toHaveProperty('stripe_product_id');
      expect(p).toHaveProperty('stripe_price_id');
      expect(p).toHaveProperty('price_cents');
      expect(p).toHaveProperty('currency', 'eur');
      expect(p).toHaveProperty('included_minutes');
      expect(p.metadata).toHaveProperty('package_slug', p.slug);
      expect(p.metadata).toHaveProperty('included_minutes', String(p.included_minutes));
    }
  });

  it('price_cents in products.json matches seed data for each package', () => {
    for (const product of stripeProductsJson.packages) {
      const seedPkg = creditPackageSeedData.find((p) => p.slug === product.slug);
      expect(seedPkg).toBeDefined();
      expect(seedPkg!.price_cents).toBe(product.price_cents);
      expect(seedPkg!.included_minutes).toBe(product.included_minutes);
    }
  });
});

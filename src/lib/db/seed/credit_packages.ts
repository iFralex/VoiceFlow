import stripeProductsJson from '../../stripe/products.json';
import { NewCreditPackage } from '../schema/credit_packages';

const stripePriceMap = new Map(
  stripeProductsJson.packages.map((p) => [p.slug, p.stripe_price_id]),
);

export const creditPackageSeedData: NewCreditPackage[] = [
  {
    slug: 'test',
    display_name: 'Test',
    price_cents: 9900,
    included_minutes: 200,
    stripe_price_id: stripePriceMap.get('test') ?? null,
    active: true,
  },
  {
    slug: 'starter',
    display_name: 'Starter',
    price_cents: 29900,
    included_minutes: 700,
    stripe_price_id: stripePriceMap.get('starter') ?? null,
    active: true,
  },
  {
    slug: 'growth',
    display_name: 'Growth',
    price_cents: 79900,
    included_minutes: 2000,
    stripe_price_id: stripePriceMap.get('growth') ?? null,
    active: true,
  },
  {
    slug: 'scale',
    display_name: 'Scale',
    price_cents: 199900,
    included_minutes: 5500,
    stripe_price_id: stripePriceMap.get('scale') ?? null,
    active: true,
  },
  {
    slug: 'enterprise',
    display_name: 'Enterprise',
    price_cents: 0,
    included_minutes: 0,
    stripe_price_id: null,
    active: false,
  },
];

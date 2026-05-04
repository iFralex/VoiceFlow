import { eq } from 'drizzle-orm';

import { withSystemContext } from '@/lib/db/context';
import { creditPackages } from '@/lib/db/schema';

import type { SerializedPackage } from './_components/topup-client';
import { TopupClient } from './_components/topup-client';

export default async function TopupPage() {
  const packages = await withSystemContext(async (tx) => {
    return tx
      .select({
        id: creditPackages.id,
        slug: creditPackages.slug,
        display_name: creditPackages.display_name,
        price_cents: creditPackages.price_cents,
        included_minutes: creditPackages.included_minutes,
      })
      .from(creditPackages)
      .where(eq(creditPackages.active, true))
      .orderBy(creditPackages.price_cents);
  });

  const serialized: SerializedPackage[] = packages.map((p) => ({
    id: p.id,
    slug: p.slug,
    display_name: p.display_name,
    price_cents: p.price_cents,
    included_minutes: p.included_minutes,
  }));

  return <TopupClient packages={serialized} />;
}

import { getAuthContext } from '@/lib/auth/context';
import { getBalanceWithBreakdown, getLedgerHistory } from '@/lib/services/credit';

import type { CreditPageClientProps } from './_components/credit-page-client';
import { CreditPageClient } from './_components/credit-page-client';

export default async function CreditPage() {
  const { orgId } = await getAuthContext();

  const [breakdown, ledger] = await Promise.all([
    getBalanceWithBreakdown(orgId),
    getLedgerHistory(orgId, {
      page: 1,
      pageSize: 20,
      entryType: null,
      dateFrom: null,
      dateTo: null,
    }),
  ]);

  const props: CreditPageClientProps = {
    balanceCents: breakdown.balanceCents,
    remainingMinutes: breakdown.remainingMinutes,
    pools: breakdown.pools.map((p) => ({
      packageName: p.packageName,
      includedMinutes: p.includedMinutes,
      priceCents: p.priceCents,
      purchasedAt: p.purchasedAt.toISOString(),
      invoiceUrl: p.invoiceUrl,
    })),
    initialEntries: ledger.entries.map((e) => ({
      ...e,
      created_at: e.created_at.toISOString(),
    })),
    initialTotal: ledger.total,
  };

  return <CreditPageClient {...props} />;
}

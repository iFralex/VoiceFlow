import { and, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { getAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/context';
import { payments } from '@/lib/db/schema';
import { getBalance } from '@/lib/services/credit';

import { SuccessClient } from './_components/success-client';

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function TopupSuccessPage({ searchParams }: Props) {
  const params = await searchParams;
  const sessionId = typeof params.session_id === 'string' ? params.session_id : null;

  if (!sessionId) {
    redirect('/credit/topup');
  }

  const { orgId } = await getAuthContext();

  const [payment] = await withOrgContext(orgId, async (tx) => {
    return tx
      .select({ id: payments.id, status: payments.status })
      .from(payments)
      .where(and(eq(payments.stripe_session_id, sessionId), eq(payments.org_id, orgId)))
      .limit(1);
  });

  let initialBalance: { balanceCents: number; remainingMinutes: number } | null = null;
  if (payment?.status === 'succeeded') {
    initialBalance = await getBalance(orgId);
  }

  return (
    <SuccessClient
      stripeSessionId={sessionId}
      paymentId={payment?.id ?? null}
      initialStatus={payment?.status ?? null}
      initialBalance={initialBalance}
    />
  );
}

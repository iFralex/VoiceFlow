'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { checkPaymentStatus } from '@/actions/billing';
import { Button } from '@/components/ui/button';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';

const POLL_INTERVAL_MS = 2000;
const TIMEOUT_MS = 30_000;

type Status = 'pending' | 'succeeded' | 'failed' | 'timeout' | 'not_found';

interface Balance {
  balanceCents: number;
  remainingMinutes: number;
}

interface Props {
  stripeSessionId: string;
  paymentId: string | null;
  initialStatus: 'pending' | 'succeeded' | 'failed' | 'refunded' | null;
  initialBalance: Balance | null;
}

export function SuccessClient({ stripeSessionId, paymentId, initialStatus, initialBalance }: Props) {
  const t = useTranslations('credit');

  const [status, setStatus] = useState<Status>(
    initialStatus === 'refunded' ? 'failed' : (initialStatus ?? 'not_found'),
  );
  const [balance, setBalance] = useState<Balance | null>(initialBalance);

  const timedOut = useRef(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Already resolved — nothing to do
    if (status === 'succeeded' || status === 'failed' || status === 'not_found') return;

    // --- Supabase Realtime subscription (primary) ---
    let channel: ReturnType<typeof getSupabaseBrowserClient>['channel'] extends ((...args: infer A) => infer R) ? R : never;
    if (paymentId) {
      const supabase = getSupabaseBrowserClient();
      channel = supabase
        .channel(`payment-${paymentId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'payments',
            filter: `id=eq.${paymentId}`,
          },
          (payload: { new: Record<string, unknown> }) => {
            const newStatus = payload.new['status'];
            if (newStatus === 'succeeded') {
              clearPolling();
              fetchBalance();
            } else if (newStatus === 'failed') {
              clearPolling();
              setStatus('failed');
            }
          },
        )
        .subscribe();
    }

    // --- Polling fallback (every 2s, max 30s) ---
    const startedAt = Date.now();

    pollingRef.current = setInterval(async () => {
      if (timedOut.current) return;

      if (Date.now() - startedAt >= TIMEOUT_MS) {
        timedOut.current = true;
        clearPolling();
        setStatus('timeout');
        return;
      }

      const result = await checkPaymentStatus(stripeSessionId);
      if (!result.ok) {
        // payment_not_found is non-fatal — webhook may not have fired yet
        return;
      }
      if (result.status === 'succeeded') {
        clearPolling();
        setBalance({ balanceCents: result.balanceCents ?? 0, remainingMinutes: result.remainingMinutes ?? 0 });
        setStatus('succeeded');
      } else if (result.status === 'failed') {
        clearPolling();
        setStatus('failed');
      }
    }, POLL_INTERVAL_MS);

    return () => {
      clearPolling();
      if (paymentId) {
        const supabase = getSupabaseBrowserClient();
        void supabase.removeChannel(supabase.channel(`payment-${paymentId}`));
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearPolling() {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }

  async function fetchBalance() {
    const result = await checkPaymentStatus(stripeSessionId);
    if (result.ok && result.status === 'succeeded') {
      setBalance({ balanceCents: result.balanceCents ?? 0, remainingMinutes: result.remainingMinutes ?? 0 });
    }
    setStatus('succeeded');
  }

  if (status === 'succeeded') {
    return (
      <div className="flex flex-col items-center gap-6 py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-8 w-8"
            aria-hidden="true"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{t('topup_success_title')}</h1>
          <p className="text-muted-foreground">{t('topup_success_subtitle')}</p>
          {balance !== null && (
            <p className="text-lg font-medium">
              {t('topup_success_balance', {
                minutes: balance.remainingMinutes.toLocaleString('it-IT'),
              })}
            </p>
          )}
        </div>

        <Button asChild>
          <Link href="/dashboard">{t('topup_success_cta')}</Link>
        </Button>
      </div>
    );
  }

  if (status === 'timeout') {
    return (
      <div className="flex flex-col items-center gap-6 py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-8 w-8"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{t('topup_timeout_title')}</h1>
          <p className="text-muted-foreground">{t('topup_timeout_message')}</p>
        </div>

        <Button variant="outline" asChild>
          <Link href="/credit/topup">{t('topup_back_to_topup')}</Link>
        </Button>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="flex flex-col items-center gap-6 py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-8 w-8"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{t('payment_cancelled')}</h1>
        </div>

        <Button variant="outline" asChild>
          <Link href="/credit/topup">{t('topup_back_to_topup')}</Link>
        </Button>
      </div>
    );
  }

  if (status === 'not_found') {
    return (
      <div className="flex flex-col items-center gap-6 py-16 text-center">
        <p className="text-muted-foreground">{t('topup_session_not_found')}</p>
        <Button variant="outline" asChild>
          <Link href="/credit/topup">{t('topup_back_to_topup')}</Link>
        </Button>
      </div>
    );
  }

  // pending — show spinner
  return (
    <div className="flex flex-col items-center gap-6 py-16 text-center">
      <div
        className="h-12 w-12 animate-spin rounded-full border-4 border-muted border-t-primary"
        aria-hidden="true"
      />
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t('topup_pending_title')}</h1>
        <p className="text-muted-foreground">{t('topup_pending_subtitle')}</p>
      </div>
    </div>
  );
}

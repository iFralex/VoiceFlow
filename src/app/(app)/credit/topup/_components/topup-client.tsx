'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { createTopupSession } from '@/actions/billing';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type SerializedPackage = {
  id: string;
  slug: string;
  display_name: string;
  price_cents: number;
  included_minutes: number;
};

interface TopupClientProps {
  packages: SerializedPackage[];
}

function formatPrice(cents: number): string {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatPerMinuteRate(priceCents: number, includedMinutes: number): string {
  const rateEur = priceCents / includedMinutes / 100;
  return rateEur.toFixed(2).replace('.', ',');
}

const RECOMMENDED_KEY_MAP: Record<string, string> = {
  test: 'recommended_test',
  starter: 'recommended_starter',
  growth: 'recommended_growth',
  scale: 'recommended_scale',
};

export function TopupClient({ packages }: TopupClientProps) {
  const t = useTranslations('credit');
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(
    packages[0]?.id ?? null,
  );
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (searchParams.get('cancelled') === '1') {
      toast.error(t('payment_cancelled'));
    }
  }, [searchParams, t]);

  function handleProceed() {
    if (!selectedId) return;
    startTransition(async () => {
      const result = await createTopupSession({ packageId: selectedId });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      if (result.url) {
        window.location.href = result.url;
      }
    });
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('topup_title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('topup_subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {packages.map((pkg) => {
          const isSelected = selectedId === pkg.id;
          const recommendedKey = RECOMMENDED_KEY_MAP[pkg.slug];
          const rateLabel = formatPerMinuteRate(pkg.price_cents, pkg.included_minutes);

          return (
            <button
              key={pkg.id}
              type="button"
              onClick={() => setSelectedId(pkg.id)}
              className={cn(
                'relative flex flex-col rounded-lg border p-5 text-left transition-colors',
                'hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isSelected
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'border-border bg-card',
              )}
              aria-pressed={isSelected}
            >
              {isSelected && (
                <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-primary" />
              )}

              <span className="text-base font-semibold">{pkg.display_name}</span>

              <span className="mt-3 text-3xl font-bold tracking-tight">
                {formatPrice(pkg.price_cents)}
              </span>

              <span className="mt-1 text-xs text-muted-foreground">
                {t('vat_included')}
              </span>

              <span className="mt-4 text-sm text-muted-foreground">
                {t('included_minutes_fmt', { minutes: pkg.included_minutes.toLocaleString('it-IT') })}
              </span>

              <span className="mt-1 text-sm font-medium text-primary">
                {t('per_minute', { rate: rateLabel })}
              </span>

              {recommendedKey && (
                <span className="mt-3 text-xs text-muted-foreground italic">
                  {t(recommendedKey as Parameters<typeof t>[0])}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <Button
        onClick={handleProceed}
        disabled={!selectedId || isPending}
        size="lg"
        className="min-w-48"
      >
        {isPending ? t('processing') : t('proceed_to_payment')}
      </Button>
    </div>
  );
}

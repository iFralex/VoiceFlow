'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { cn } from '@/lib/utils/index';

export type DashboardPeriod = 'today' | '7d' | '30d' | 'month' | 'prev_month';

export const DASHBOARD_PERIODS: DashboardPeriod[] = [
  'today',
  '7d',
  '30d',
  'month',
  'prev_month',
];

type PeriodSelectorProps = {
  value: DashboardPeriod;
  className?: string;
};

export function PeriodSelector({ value, className }: PeriodSelectorProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations('dashboard');

  const onChange = (next: DashboardPeriod) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === '7d') {
      params.delete('period');
    } else {
      params.set('period', next);
    }
    const qs = params.toString();
    router.replace(qs ? `/dashboard?${qs}` : '/dashboard');
  };

  return (
    <div
      role="tablist"
      aria-label={t('period_aria_label')}
      data-slot="period-selector"
      className={cn(
        'inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1 text-xs',
        className,
      )}
    >
      {DASHBOARD_PERIODS.map((p) => {
        const active = p === value;
        return (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={active}
            data-active={active}
            className={cn(
              'rounded-md px-2.5 py-1 font-medium transition-colors',
              active
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => onChange(p)}
          >
            {t(`period_${p}`)}
          </button>
        );
      })}
    </div>
  );
}

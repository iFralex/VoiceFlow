import * as React from 'react';

import { cn } from '@/lib/utils/index';

import { Sparkline } from './sparkline';

type KpiCardProps = {
  label: string;
  value: string;
  hint?: string;
  trend?: number[];
  trendLabel?: string;
  className?: string;
};

export function KpiCard({ label, value, hint, trend, trendLabel, className }: KpiCardProps) {
  return (
    <div
      data-slot="kpi-card"
      className={cn(
        'bg-card ring-foreground/10 flex flex-col gap-2 rounded-xl p-4 ring-1',
        className,
      )}
    >
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <div className="flex items-end justify-between gap-3">
        <p className="text-2xl font-semibold tracking-tight" data-slot="kpi-value">
          {value}
        </p>
        {trend && (
          <Sparkline
            values={trend}
            {...(trendLabel ? { ariaLabel: trendLabel } : {})}
            className="shrink-0"
          />
        )}
      </div>
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

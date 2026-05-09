'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { StatusBadge } from '@/components/ui/status-badge';
import type { CampaignStatus } from '@/components/ui/status-badge';
import { cn } from '@/lib/utils/index';

export type ActiveCampaignRow = {
  id: string;
  name: string;
  status: CampaignStatus;
  total: number;
  completed: number;
  appointmentsBooked: number;
};

type Props = {
  campaigns: ActiveCampaignRow[];
  className?: string;
};

export function ActiveCampaigns({ campaigns, className }: Props) {
  const t = useTranslations('dashboard');

  return (
    <section
      data-slot="active-campaigns"
      className={cn('flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10', className)}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t('active_campaigns_title')}</h2>
        <Link
          href="/campaigns"
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {t('see_all')}
        </Link>
      </div>
      {campaigns.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          {t('active_campaigns_empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {campaigns.map((c) => {
            const pct = c.total > 0 ? Math.round((c.completed / c.total) * 100) : 0;
            return (
              <li key={c.id} data-slot="active-campaign-row" data-campaign-id={c.id}>
                <Link
                  href={`/campaigns/${c.id}`}
                  className="flex flex-col gap-1.5 rounded-md border border-border/60 px-3 py-2 hover:bg-muted/50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{c.name}</span>
                    <StatusBadge status={c.status} />
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>
                      {t('campaign_progress', {
                        completed: c.completed,
                        total: c.total,
                      })}
                    </span>
                    <span aria-hidden>•</span>
                    <span>
                      {t('campaign_appointments', { count: c.appointmentsBooked })}
                    </span>
                    <span className="ml-auto font-medium tabular-nums">
                      {pct}%
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

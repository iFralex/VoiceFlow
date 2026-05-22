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
      className={cn(
        'bg-card ring-foreground/10 flex flex-col gap-3 rounded-xl p-4 ring-1',
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t('active_campaigns_title')}</h2>
        <Link
          href="/campaigns"
          className="text-muted-foreground hover:text-foreground text-xs font-medium"
        >
          {t('see_all')}
        </Link>
      </div>
      {campaigns.length === 0 ? (
        <p className="text-muted-foreground py-4 text-center text-sm">
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
                  className="border-border/60 hover:bg-muted/50 flex flex-col gap-1.5 rounded-md border px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{c.name}</span>
                    <StatusBadge status={c.status} />
                  </div>
                  <div className="text-muted-foreground flex items-center gap-3 text-xs">
                    <span>
                      {t('campaign_progress', {
                        completed: c.completed,
                        total: c.total,
                      })}
                    </span>
                    <span aria-hidden>•</span>
                    <span>{t('campaign_appointments', { count: c.appointmentsBooked })}</span>
                    <span className="ml-auto font-medium tabular-nums">{pct}%</span>
                  </div>
                  <div
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
                  >
                    <div className="bg-primary h-full" style={{ width: `${pct}%` }} />
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

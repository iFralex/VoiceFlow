'use client';

import { AlertTriangle, BellRing, ShieldAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { cn } from '@/lib/utils/index';

export type DashboardAlert =
  | { id: string; kind: 'low_credit'; balanceMinutes: number }
  | { id: string; kind: 'cli_cooldown'; count: number }
  | { id: string; kind: 'disclosure_failure'; count: number };

type Props = {
  alerts: DashboardAlert[];
  className?: string;
};

const ICONS = {
  low_credit: BellRing,
  cli_cooldown: AlertTriangle,
  disclosure_failure: ShieldAlert,
} as const;

const SEVERITY: Record<DashboardAlert['kind'], 'warning' | 'danger'> = {
  low_credit: 'warning',
  cli_cooldown: 'warning',
  disclosure_failure: 'danger',
};

export function AlertsList({ alerts, className }: Props) {
  const t = useTranslations('dashboard');

  return (
    <section
      data-slot="alerts-list"
      className={cn('flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10', className)}
    >
      <h2 className="text-sm font-semibold">{t('alerts_title')}</h2>
      {alerts.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          {t('alerts_empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {alerts.map((a) => {
            const Icon = ICONS[a.kind];
            const sev = SEVERITY[a.kind];
            const message =
              a.kind === 'low_credit'
                ? t('alert_low_credit', { minutes: a.balanceMinutes })
                : a.kind === 'cli_cooldown'
                ? t('alert_cli_cooldown', { count: a.count })
                : t('alert_disclosure_failure', { count: a.count });
            return (
              <li
                key={a.id}
                data-slot="alert-row"
                data-severity={sev}
                className={cn(
                  'flex items-start gap-2 rounded-md border px-3 py-2 text-sm',
                  sev === 'danger'
                    ? 'border-[hsl(var(--status-danger)/0.3)] bg-[hsl(var(--status-danger)/0.06)]'
                    : 'border-[hsl(var(--status-warning)/0.3)] bg-[hsl(var(--status-warning)/0.06)]',
                )}
              >
                <Icon
                  className={cn(
                    'mt-0.5 h-4 w-4 shrink-0',
                    sev === 'danger'
                      ? 'text-[hsl(var(--status-danger))]'
                      : 'text-[hsl(var(--status-warning))]',
                  )}
                  aria-hidden
                />
                <span>{message}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Icons } from '@/components/ui/icon';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils/index';

export interface CreditBalance {
  /** Total remaining minutes available to the org */
  remainingMinutes: number;
  /** Reserved minutes (in active calls) */
  reservedMinutes?: number;
  /** Total minutes ever purchased */
  totalMinutes?: number;
}

interface CreditPillProps {
  balance: CreditBalance;
  className?: string;
}

type StatusTier = 'green' | 'amber' | 'red';

function getStatusTier(remainingMinutes: number): StatusTier {
  if (remainingMinutes >= 60) return 'green';
  if (remainingMinutes >= 10) return 'amber';
  return 'red';
}

const STATUS_CLASSES: Record<StatusTier, string> = {
  green: 'text-[hsl(var(--status-success))] bg-[hsl(var(--status-success))]/10 hover:bg-[hsl(var(--status-success))]/20',
  amber: 'text-[hsl(var(--status-warning))] bg-[hsl(var(--status-warning))]/10 hover:bg-[hsl(var(--status-warning))]/20',
  red: 'text-[hsl(var(--status-danger))] bg-[hsl(var(--status-danger))]/10 hover:bg-[hsl(var(--status-danger))]/20',
};

export function CreditPill({ balance, className }: CreditPillProps) {
  const { remainingMinutes, reservedMinutes = 0, totalMinutes } = balance;
  const tier = getStatusTier(remainingMinutes);
  const t = useTranslations('credit');

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          data-testid="credit-pill"
          data-status={tier}
          aria-label={t('pill_aria_label', { minutes: remainingMinutes })}
          className={cn(
            'h-8 gap-1.5 rounded-full px-3 text-xs font-medium transition-colors',
            STATUS_CLASSES[tier],
            className,
          )}
        >
          <Icons.CreditCard size={13} />
          <span>{remainingMinutes} min</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-64 p-0" data-testid="credit-popover">
        <div className="px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground">{t('credit_balance_label')}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{remainingMinutes} min</p>
        </div>

        <Separator />

        <div className="px-4 py-3 space-y-1.5 text-sm">
          {reservedMinutes > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span>{t('reserved_active_calls')}</span>
              <span className="tabular-nums">{reservedMinutes} min</span>
            </div>
          )}
          {totalMinutes !== undefined && (
            <div className="flex justify-between text-muted-foreground">
              <span>{t('total_purchased')}</span>
              <span className="tabular-nums">{totalMinutes} min</span>
            </div>
          )}
          <div className="flex justify-between font-medium">
            <span>{t('available')}</span>
            <span
              data-testid="credit-available"
              className={cn('tabular-nums', {
                'text-[hsl(var(--status-success))]': tier === 'green',
                'text-[hsl(var(--status-warning))]': tier === 'amber',
                'text-[hsl(var(--status-danger))]': tier === 'red',
              })}
            >
              {remainingMinutes} min
            </span>
          </div>
        </div>

        <Separator />

        <div className="p-3">
          <Button asChild size="sm" className="w-full">
            <Link href="/credit/topup">{t('top_up')}</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Skeleton placeholder shown while credit data loads */
export function CreditPillSkeleton() {
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled
      aria-hidden
      data-testid="credit-pill-skeleton"
      className="h-8 gap-1.5 rounded-full px-3 text-xs"
    >
      <Icons.CreditCard size={13} className="opacity-40" />
      <span className="opacity-40">— min</span>
    </Button>
  );
}

'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { cn } from '@/lib/utils/index';

// ─── Status enum types ────────────────────────────────────────────────────────

export type CampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'running'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'error';

export type CallStatus =
  | 'pending'
  | 'dialing'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'no_answer'
  | 'busy'
  | 'cancelled';

export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'refunded'
  | 'cancelled';

export type OptOutStatus = 'active' | 'opted_out' | 'pending_review';

export type RpoStatus = 'compliant' | 'warning' | 'blocked' | 'expired';

export type StatusKind =
  | CampaignStatus
  | CallStatus
  | PaymentStatus
  | OptOutStatus
  | RpoStatus;

// ─── Colour mapping ───────────────────────────────────────────────────────────

export const STATUS_MAP: Record<string, { colorClass: string }> = {
  // Campaign statuses
  draft: { colorClass: 'bg-[hsl(var(--status-neutral)/0.12)] text-[hsl(var(--status-neutral))] border-[hsl(var(--status-neutral)/0.3)]' },
  scheduled: { colorClass: 'bg-[hsl(var(--status-info)/0.12)] text-[hsl(var(--status-info))] border-[hsl(var(--status-info)/0.3)]' },
  running: { colorClass: 'bg-[hsl(var(--status-success)/0.12)] text-[hsl(var(--status-success))] border-[hsl(var(--status-success)/0.3)]' },
  paused: { colorClass: 'bg-[hsl(var(--status-warning)/0.12)] text-[hsl(var(--status-warning))] border-[hsl(var(--status-warning)/0.3)]' },
  completed: { colorClass: 'bg-[hsl(var(--status-success)/0.12)] text-[hsl(var(--status-success))] border-[hsl(var(--status-success)/0.3)]' },
  cancelled: { colorClass: 'bg-[hsl(var(--status-neutral)/0.12)] text-[hsl(var(--status-neutral))] border-[hsl(var(--status-neutral)/0.3)]' },
  error: { colorClass: 'bg-[hsl(var(--status-danger)/0.12)] text-[hsl(var(--status-danger))] border-[hsl(var(--status-danger)/0.3)]' },
  // Call statuses
  pending: { colorClass: 'bg-[hsl(var(--status-neutral)/0.12)] text-[hsl(var(--status-neutral))] border-[hsl(var(--status-neutral)/0.3)]' },
  dialing: { colorClass: 'bg-[hsl(var(--status-info)/0.12)] text-[hsl(var(--status-info))] border-[hsl(var(--status-info)/0.3)]' },
  in_progress: { colorClass: 'bg-[hsl(var(--status-success)/0.12)] text-[hsl(var(--status-success))] border-[hsl(var(--status-success)/0.3)]' },
  failed: { colorClass: 'bg-[hsl(var(--status-danger)/0.12)] text-[hsl(var(--status-danger))] border-[hsl(var(--status-danger)/0.3)]' },
  no_answer: { colorClass: 'bg-[hsl(var(--status-warning)/0.12)] text-[hsl(var(--status-warning))] border-[hsl(var(--status-warning)/0.3)]' },
  busy: { colorClass: 'bg-[hsl(var(--status-warning)/0.12)] text-[hsl(var(--status-warning))] border-[hsl(var(--status-warning)/0.3)]' },
  // Payment statuses
  processing: { colorClass: 'bg-[hsl(var(--status-info)/0.12)] text-[hsl(var(--status-info))] border-[hsl(var(--status-info)/0.3)]' },
  succeeded: { colorClass: 'bg-[hsl(var(--status-success)/0.12)] text-[hsl(var(--status-success))] border-[hsl(var(--status-success)/0.3)]' },
  refunded: { colorClass: 'bg-[hsl(var(--status-neutral)/0.12)] text-[hsl(var(--status-neutral))] border-[hsl(var(--status-neutral)/0.3)]' },
  // Opt-out statuses
  active: { colorClass: 'bg-[hsl(var(--status-success)/0.12)] text-[hsl(var(--status-success))] border-[hsl(var(--status-success)/0.3)]' },
  opted_out: { colorClass: 'bg-[hsl(var(--status-danger)/0.12)] text-[hsl(var(--status-danger))] border-[hsl(var(--status-danger)/0.3)]' },
  pending_review: { colorClass: 'bg-[hsl(var(--status-warning)/0.12)] text-[hsl(var(--status-warning))] border-[hsl(var(--status-warning)/0.3)]' },
  // RPO statuses
  compliant: { colorClass: 'bg-[hsl(var(--status-success)/0.12)] text-[hsl(var(--status-success))] border-[hsl(var(--status-success)/0.3)]' },
  warning: { colorClass: 'bg-[hsl(var(--status-warning)/0.12)] text-[hsl(var(--status-warning))] border-[hsl(var(--status-warning)/0.3)]' },
  blocked: { colorClass: 'bg-[hsl(var(--status-danger)/0.12)] text-[hsl(var(--status-danger))] border-[hsl(var(--status-danger)/0.3)]' },
  expired: { colorClass: 'bg-[hsl(var(--status-danger)/0.12)] text-[hsl(var(--status-danger))] border-[hsl(var(--status-danger)/0.3)]' },
};

// ─── Component ────────────────────────────────────────────────────────────────

type StatusBadgeProps = {
  status: StatusKind;
  /** Override the label derived from the status translation */
  label?: string;
  className?: string;
};

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const t = useTranslations('status');
  const config = STATUS_MAP[status as string];
  const displayLabel = label ?? t(status as string);
  const colorClass =
    config?.colorClass ??
    'bg-[hsl(var(--status-neutral)/0.12)] text-[hsl(var(--status-neutral))] border-[hsl(var(--status-neutral)/0.3)]';

  return (
    <span
      data-slot="status-badge"
      data-status={status}
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        colorClass,
        className,
      )}
    >
      {displayLabel}
    </span>
  );
}

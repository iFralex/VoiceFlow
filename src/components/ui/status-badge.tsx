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

// ─── Colour + label mapping ───────────────────────────────────────────────────

type StatusConfig = {
  label: string;
  colorClass: string;
};

const STATUS_MAP: Record<string, StatusConfig> = {
  // Campaign statuses
  draft: {
    label: 'Bozza',
    colorClass:
      'bg-[hsl(var(--status-neutral)/0.12)] text-[hsl(var(--status-neutral))] border-[hsl(var(--status-neutral)/0.3)]',
  },
  scheduled: {
    label: 'Pianificata',
    colorClass:
      'bg-[hsl(var(--status-info)/0.12)] text-[hsl(var(--status-info))] border-[hsl(var(--status-info)/0.3)]',
  },
  running: {
    label: 'In corso',
    colorClass:
      'bg-[hsl(var(--status-success)/0.12)] text-[hsl(var(--status-success))] border-[hsl(var(--status-success)/0.3)]',
  },
  paused: {
    label: 'In pausa',
    colorClass:
      'bg-[hsl(var(--status-warning)/0.12)] text-[hsl(var(--status-warning))] border-[hsl(var(--status-warning)/0.3)]',
  },
  completed: {
    label: 'Completata',
    colorClass:
      'bg-[hsl(var(--status-success)/0.12)] text-[hsl(var(--status-success))] border-[hsl(var(--status-success)/0.3)]',
  },
  cancelled: {
    label: 'Annullata',
    colorClass:
      'bg-[hsl(var(--status-neutral)/0.12)] text-[hsl(var(--status-neutral))] border-[hsl(var(--status-neutral)/0.3)]',
  },
  error: {
    label: 'Errore',
    colorClass:
      'bg-[hsl(var(--status-danger)/0.12)] text-[hsl(var(--status-danger))] border-[hsl(var(--status-danger)/0.3)]',
  },

  // Call statuses
  pending: {
    label: 'In attesa',
    colorClass:
      'bg-[hsl(var(--status-neutral)/0.12)] text-[hsl(var(--status-neutral))] border-[hsl(var(--status-neutral)/0.3)]',
  },
  dialing: {
    label: 'In chiamata',
    colorClass:
      'bg-[hsl(var(--status-info)/0.12)] text-[hsl(var(--status-info))] border-[hsl(var(--status-info)/0.3)]',
  },
  in_progress: {
    label: 'In corso',
    colorClass:
      'bg-[hsl(var(--status-success)/0.12)] text-[hsl(var(--status-success))] border-[hsl(var(--status-success)/0.3)]',
  },
  failed: {
    label: 'Fallita',
    colorClass:
      'bg-[hsl(var(--status-danger)/0.12)] text-[hsl(var(--status-danger))] border-[hsl(var(--status-danger)/0.3)]',
  },
  no_answer: {
    label: 'Senza risposta',
    colorClass:
      'bg-[hsl(var(--status-warning)/0.12)] text-[hsl(var(--status-warning))] border-[hsl(var(--status-warning)/0.3)]',
  },
  busy: {
    label: 'Occupato',
    colorClass:
      'bg-[hsl(var(--status-warning)/0.12)] text-[hsl(var(--status-warning))] border-[hsl(var(--status-warning)/0.3)]',
  },

  // Payment statuses
  processing: {
    label: 'In elaborazione',
    colorClass:
      'bg-[hsl(var(--status-info)/0.12)] text-[hsl(var(--status-info))] border-[hsl(var(--status-info)/0.3)]',
  },
  succeeded: {
    label: 'Completato',
    colorClass:
      'bg-[hsl(var(--status-success)/0.12)] text-[hsl(var(--status-success))] border-[hsl(var(--status-success)/0.3)]',
  },
  refunded: {
    label: 'Rimborsato',
    colorClass:
      'bg-[hsl(var(--status-neutral)/0.12)] text-[hsl(var(--status-neutral))] border-[hsl(var(--status-neutral)/0.3)]',
  },

  // Opt-out statuses
  active: {
    label: 'Attivo',
    colorClass:
      'bg-[hsl(var(--status-success)/0.12)] text-[hsl(var(--status-success))] border-[hsl(var(--status-success)/0.3)]',
  },
  opted_out: {
    label: 'Opt-out',
    colorClass:
      'bg-[hsl(var(--status-danger)/0.12)] text-[hsl(var(--status-danger))] border-[hsl(var(--status-danger)/0.3)]',
  },
  pending_review: {
    label: 'In revisione',
    colorClass:
      'bg-[hsl(var(--status-warning)/0.12)] text-[hsl(var(--status-warning))] border-[hsl(var(--status-warning)/0.3)]',
  },

  // RPO statuses
  compliant: {
    label: 'Conforme',
    colorClass:
      'bg-[hsl(var(--status-success)/0.12)] text-[hsl(var(--status-success))] border-[hsl(var(--status-success)/0.3)]',
  },
  warning: {
    label: 'Avviso',
    colorClass:
      'bg-[hsl(var(--status-warning)/0.12)] text-[hsl(var(--status-warning))] border-[hsl(var(--status-warning)/0.3)]',
  },
  blocked: {
    label: 'Bloccato',
    colorClass:
      'bg-[hsl(var(--status-danger)/0.12)] text-[hsl(var(--status-danger))] border-[hsl(var(--status-danger)/0.3)]',
  },
  expired: {
    label: 'Scaduto',
    colorClass:
      'bg-[hsl(var(--status-danger)/0.12)] text-[hsl(var(--status-danger))] border-[hsl(var(--status-danger)/0.3)]',
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

type StatusBadgeProps = {
  status: StatusKind;
  /** Override the label derived from the status map */
  label?: string;
  className?: string;
};

function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const config = STATUS_MAP[status as string];
  const displayLabel = label ?? config?.label ?? status;
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

export { StatusBadge, STATUS_MAP };

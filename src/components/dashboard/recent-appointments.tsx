'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { cn } from '@/lib/utils/index';

export type RecentAppointmentRow = {
  id: string;
  contactName: string;
  scheduledAt: string; // ISO
  campaignName: string;
  campaignId: string;
};

type Props = {
  appointments: RecentAppointmentRow[];
  className?: string;
};

export function RecentAppointments({ appointments, className }: Props) {
  const t = useTranslations('dashboard');

  return (
    <section
      data-slot="recent-appointments"
      className={cn(
        'bg-card ring-foreground/10 flex flex-col gap-3 rounded-xl p-4 ring-1',
        className,
      )}
    >
      <h2 className="text-sm font-semibold">{t('recent_appointments_title')}</h2>
      {appointments.length === 0 ? (
        <p className="text-muted-foreground py-4 text-center text-sm">
          {t('recent_appointments_empty')}
        </p>
      ) : (
        <ul className="divide-border/60 flex flex-col divide-y">
          {appointments.map((a) => (
            <li key={a.id} data-slot="recent-appointment-row" className="py-2 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate font-medium">{a.contactName}</span>
                <time
                  dateTime={a.scheduledAt}
                  className="text-muted-foreground shrink-0 text-xs tabular-nums"
                >
                  {formatDateTime(a.scheduledAt)}
                </time>
              </div>
              <Link
                href={`/campaigns/${a.campaignId}`}
                className="text-muted-foreground hover:text-foreground block truncate text-xs"
              >
                {a.campaignName}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const datePart = d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
    const timePart = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    return `${datePart} ${timePart}`;
  } catch {
    return iso;
  }
}

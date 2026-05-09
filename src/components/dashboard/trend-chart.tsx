'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { cn } from '@/lib/utils/index';

export type TrendPoint = {
  date: string;
  completed: number;
  appointmentBooked: number;
  notInterested: number;
  voicemail: number;
  failed: number;
};

type TrendChartProps = {
  data: TrendPoint[];
  height?: number;
  className?: string;
};

const SEGMENT_KEYS = [
  'appointmentBooked',
  'completed',
  'notInterested',
  'voicemail',
  'failed',
] as const;

const SEGMENT_COLORS: Record<(typeof SEGMENT_KEYS)[number], string> = {
  appointmentBooked: 'hsl(var(--status-info))',
  completed: 'hsl(var(--status-success))',
  notInterested: 'hsl(var(--status-neutral))',
  voicemail: 'hsl(var(--status-warning))',
  failed: 'hsl(var(--status-danger))',
};

export function TrendChart({ data, height = 220, className }: TrendChartProps) {
  const t = useTranslations('dashboard');

  if (data.length === 0) {
    return (
      <div
        data-slot="trend-chart-empty"
        className={cn(
          'flex items-center justify-center rounded-lg border border-border bg-card text-sm text-muted-foreground',
          className,
        )}
        style={{ height }}
      >
        {t('trend_no_data')}
      </div>
    );
  }

  const totals = data.map(
    (d) =>
      d.appointmentBooked + d.completed + d.notInterested + d.voicemail + d.failed,
  );
  const max = Math.max(1, ...totals);

  const padding = { top: 16, right: 16, bottom: 28, left: 32 };
  const innerHeight = height - padding.top - padding.bottom;
  const barGap = 4;

  return (
    <div
      data-slot="trend-chart"
      className={cn('rounded-lg border border-border bg-card p-4', className)}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{t('trend_title')}</h3>
        <ul className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {SEGMENT_KEYS.map((k) => (
            <li key={k} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-sm"
                style={{ background: SEGMENT_COLORS[k] }}
              />
              {t(`legend_${k}`)}
            </li>
          ))}
        </ul>
      </div>
      <svg
        role="img"
        aria-label={t('trend_aria_label', { count: data.length })}
        viewBox={`0 0 ${100 * data.length + padding.left + padding.right} ${height}`}
        className="h-auto w-full"
        preserveAspectRatio="none"
      >
        {/* y-axis baseline */}
        <line
          x1={padding.left}
          y1={padding.top + innerHeight}
          x2={100 * data.length + padding.left}
          y2={padding.top + innerHeight}
          stroke="currentColor"
          strokeOpacity={0.15}
        />
        {data.map((d, i) => {
          const segments = SEGMENT_KEYS.map((k) => ({ key: k, value: d[k] }));
          const total = segments.reduce((s, x) => s + x.value, 0);
          const barWidth = 100 - barGap * 2;
          const xLeft = padding.left + i * 100 + barGap;
          let yCursor = padding.top + innerHeight;
          return (
            <g key={d.date} data-slot="trend-bar" data-date={d.date}>
              {segments.map(({ key, value }) => {
                if (value === 0) return null;
                const segHeight = (value / max) * innerHeight;
                yCursor -= segHeight;
                return (
                  <rect
                    key={key}
                    data-slot="trend-segment"
                    data-segment={key}
                    x={xLeft}
                    y={yCursor}
                    width={barWidth}
                    height={Math.max(0.5, segHeight)}
                    fill={SEGMENT_COLORS[key]}
                  >
                    <title>{`${d.date} — ${key}: ${value}`}</title>
                  </rect>
                );
              })}
              <text
                x={xLeft + barWidth / 2}
                y={padding.top + innerHeight + 16}
                textAnchor="middle"
                fontSize={10}
                fill="currentColor"
                fillOpacity={0.55}
              >
                {formatDayLabel(d.date)}
              </text>
              <title>{`${d.date} — totale: ${total}`}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function formatDayLabel(iso: string): string {
  // expect YYYY-MM-DD; fall back to last 5 chars
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return iso.slice(5).replace('-', '/');
  }
  return iso.slice(-5);
}

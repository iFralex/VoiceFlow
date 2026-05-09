import * as React from 'react';

import { cn } from '@/lib/utils/index';

type SparklineProps = {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
  ariaLabel?: string;
};

export function Sparkline({
  values,
  width = 96,
  height = 28,
  className,
  ariaLabel,
}: SparklineProps) {
  if (values.length === 0) {
    return (
      <svg
        data-slot="sparkline"
        data-empty="true"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={cn('text-muted-foreground/40', className)}
        aria-hidden={!ariaLabel}
        aria-label={ariaLabel}
        role={ariaLabel ? 'img' : undefined}
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      </svg>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = values.length === 1 ? 0 : width / (values.length - 1);

  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return { x, y };
  });

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(' ');

  const areaPath = `${path} L ${points[points.length - 1]!.x.toFixed(2)} ${height} L 0 ${height} Z`;

  return (
    <svg
      data-slot="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('text-primary', className)}
      aria-hidden={!ariaLabel}
      aria-label={ariaLabel}
      role={ariaLabel ? 'img' : undefined}
    >
      <path d={areaPath} fill="currentColor" fillOpacity={0.12} />
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

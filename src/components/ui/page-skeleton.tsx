import * as React from 'react';

import { cn } from '@/lib/utils/index';

import { Skeleton } from './skeleton';

/** Skeleton for a KPI/stat card (number + label). */
export function KpiCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      data-slot="kpi-card-skeleton"
      className={cn(
        'flex flex-col gap-2 rounded-lg border border-border bg-card p-4',
        className,
      )}
    >
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-16" />
      <Skeleton className="h-3 w-32" />
    </div>
  );
}

/** A row of KPI cards (default 4). */
export function KpiRowSkeleton({
  count = 4,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      data-slot="kpi-row-skeleton"
      className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-4', className)}
    >
      {Array.from({ length: count }).map((_, i) => (
        <KpiCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Skeleton for a list page: toolbar + rows of items. */
export function ListPageSkeleton({
  rowCount = 8,
  className,
}: {
  rowCount?: number;
  className?: string;
}) {
  return (
    <div
      data-slot="list-page-skeleton"
      className={cn('flex flex-col gap-4', className)}
    >
      {/* toolbar */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="ml-auto h-8 w-24" />
        <Skeleton className="h-8 w-24" />
      </div>
      {/* rows */}
      <div className="rounded-lg border border-border">
        {Array.from({ length: rowCount }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
          >
            <Skeleton className="h-4 w-4 shrink-0" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="ml-auto h-4 w-20" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
      {/* pagination */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <div className="flex gap-1">
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-7 w-16" />
        </div>
      </div>
    </div>
  );
}

/** Skeleton for a detail/show page: header + body sections. */
export function DetailPageSkeleton({ className }: { className?: string }) {
  return (
    <div
      data-slot="detail-page-skeleton"
      className={cn('flex flex-col gap-6', className)}
    >
      {/* page header */}
      <div className="flex items-start gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="ml-auto flex gap-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-20" />
        </div>
      </div>
      {/* body cards */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 lg:col-span-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
        </div>
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
          <Skeleton className="h-4 w-24" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

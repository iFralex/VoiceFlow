import * as React from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { TableCell, TableRow } from '@/components/ui/table';

type DataTableSkeletonProps = {
  columnCount: number;
  rowCount?: number;
};

export function DataTableSkeleton({
  columnCount,
  rowCount = 5,
}: DataTableSkeletonProps) {
  return Array.from({ length: rowCount }).map((_, rowIndex) => (
    <TableRow key={rowIndex} data-slot="data-table-skeleton-row">
      {Array.from({ length: columnCount }).map((_, colIndex) => (
        <TableCell key={colIndex}>
          <Skeleton className="h-4 w-full" />
        </TableCell>
      ))}
    </TableRow>
  ));
}

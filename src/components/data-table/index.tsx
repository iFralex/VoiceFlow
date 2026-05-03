'use client';

import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type OnChangeFn,
  type PaginationState,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import * as React from 'react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { DataTableEmpty } from './empty';
import { DataTableError } from './error';
import { DataTablePagination } from './pagination';
import { DataTableSkeleton } from './skeleton';
import { DataTableToolbar } from './toolbar';

// ─── Types ────────────────────────────────────────────────────────────────────

export type { ColumnDef };

/**
 * Server-side pagination/sorting/filtering state passed back to the parent
 * so it can re-fetch with updated query params.
 */
export type DataTableServerState = {
  pagination: PaginationState;
  sorting: SortingState;
  columnFilters: ColumnFiltersState;
};

export type DataTableProps<TData> = {
  columns: ColumnDef<TData>[];
  data: TData[];

  /** Total row count for server-side pagination (omit for client-side) */
  rowCount?: number;

  /** Controlled server-side state */
  state?: Partial<DataTableServerState>;
  onStateChange?: (next: DataTableServerState) => void;

  /** Loading / error / empty */
  isLoading?: boolean;
  error?: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;

  /** Toolbar slot — rendered above the table */
  toolbar?: React.ReactNode;

  /** Whether to show the pagination footer */
  showPagination?: boolean;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function DataTable<TData>({
  columns,
  data,
  rowCount,
  state: externalState,
  onStateChange,
  isLoading = false,
  error = null,
  emptyTitle,
  emptyDescription,
  emptyAction,
  toolbar,
  showPagination = true,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = React.useState<SortingState>(
    externalState?.sorting ?? [],
  );
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    externalState?.columnFilters ?? [],
  );
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const [pagination, setPagination] = React.useState<PaginationState>(
    externalState?.pagination ?? { pageIndex: 0, pageSize: 20 },
  );

  // When externalState is provided (server-side mode), prefer it over stale
  // internal state so URL-driven navigation reflects immediately.
  const effectiveSorting = externalState?.sorting ?? sorting;
  const effectiveColumnFilters = externalState?.columnFilters ?? columnFilters;
  const effectivePagination = externalState?.pagination ?? pagination;

  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    const next =
      typeof updater === 'function' ? updater(effectiveSorting) : updater;
    setSorting(next);
    if (onStateChange) {
      onStateChange({ pagination: effectivePagination, sorting: next, columnFilters: effectiveColumnFilters });
    }
  };

  const handleColumnFiltersChange: OnChangeFn<ColumnFiltersState> = (
    updater,
  ) => {
    const next =
      typeof updater === 'function' ? updater(effectiveColumnFilters) : updater;
    setColumnFilters(next);
    if (onStateChange) {
      onStateChange({ pagination: effectivePagination, sorting: effectiveSorting, columnFilters: next });
    }
  };

  const handlePaginationChange: OnChangeFn<PaginationState> = (updater) => {
    const next =
      typeof updater === 'function' ? updater(effectivePagination) : updater;
    setPagination(next);
    if (onStateChange) {
      onStateChange({ pagination: next, sorting: effectiveSorting, columnFilters: effectiveColumnFilters });
    }
  };

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table returns functions; known React Compiler limitation
  const table = useReactTable({
    data,
    columns,
    ...(rowCount !== undefined ? { rowCount } : {}),
    state: {
      sorting: effectiveSorting,
      columnFilters: effectiveColumnFilters,
      columnVisibility,
      pagination: effectivePagination,
    },
    // Use manual pagination/sorting/filtering when rowCount is provided (server-side)
    manualPagination: rowCount !== undefined,
    manualSorting: rowCount !== undefined,
    manualFiltering: rowCount !== undefined,
    onSortingChange: handleSortingChange,
    onColumnFiltersChange: handleColumnFiltersChange,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: handlePaginationChange,
    getCoreRowModel: getCoreRowModel(),
    ...(rowCount === undefined ? {
      getPaginationRowModel: getPaginationRowModel(),
      getSortedRowModel: getSortedRowModel(),
      getFilteredRowModel: getFilteredRowModel(),
    } : {}),
  });

  return (
    <div className="flex flex-col gap-3">
      {toolbar !== undefined && (
        <DataTableToolbar table={table}>{toolbar}</DataTableToolbar>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} style={{ width: header.getSize() }}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <DataTableSkeleton columnCount={columns.length} rowCount={5} />
            ) : error ? (
              <DataTableError
                columnCount={columns.length}
                message={error}
              />
            ) : table.getRowModel().rows.length === 0 ? (
              <DataTableEmpty
                columnCount={columns.length}
                {...(emptyTitle !== undefined ? { title: emptyTitle } : {})}
                {...(emptyDescription !== undefined ? { description: emptyDescription } : {})}
                {...(emptyAction !== undefined ? { action: emptyAction } : {})}
              />
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? 'selected' : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {showPagination && <DataTablePagination table={table} />}
    </div>
  );
}

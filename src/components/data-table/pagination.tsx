'use client';

import { type Table } from '@tanstack/react-table';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Icons } from '@/components/ui/icon';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type DataTablePaginationProps<TData> = {
  table: Table<TData>;
};

const PAGE_SIZES = [10, 20, 50, 100];

export function DataTablePagination<TData>({
  table,
}: DataTablePaginationProps<TData>) {
  const t = useTranslations('table');
  const { pageIndex, pageSize } = table.getState().pagination;
  const pageCount = table.getPageCount();
  const selectedCount = table.getFilteredSelectedRowModel().rows.length;
  const totalCount = table.getFilteredRowModel().rows.length;

  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      {selectedCount > 0 ? (
        <p className="text-muted-foreground">
          {t('rows_selected', { selected: selectedCount, total: totalCount })}
        </p>
      ) : (
        <p className="text-muted-foreground">
          {t('total_rows', { total: totalCount })}
        </p>
      )}

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{t('rows_per_page')}</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) =>
              table.setPageSize(Number(value))
            }
          >
            <SelectTrigger className="h-8 w-16">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <span className="text-muted-foreground">
          {t('page_of', { page: pageIndex + 1, total: Math.max(pageCount, 1) })}
        </span>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => table.firstPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label={t('first_page')}
          >
            <Icons.ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label={t('prev_page')}
          >
            <Icons.ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            aria-label={t('next_page')}
          >
            <Icons.ChevronRight />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => table.lastPage()}
            disabled={!table.getCanNextPage()}
            aria-label={t('last_page')}
          >
            <Icons.ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

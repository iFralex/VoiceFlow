'use client';

import { type Table } from '@tanstack/react-table';

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
  const { pageIndex, pageSize } = table.getState().pagination;
  const pageCount = table.getPageCount();
  const selectedCount = table.getFilteredSelectedRowModel().rows.length;
  const totalCount = table.getFilteredRowModel().rows.length;

  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      {selectedCount > 0 ? (
        <p className="text-muted-foreground">
          {selectedCount} di {totalCount} riga/e selezionata/e
        </p>
      ) : (
        <p className="text-muted-foreground">
          {totalCount} riga/e totali
        </p>
      )}

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Righe per pagina</span>
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
          Pagina {pageIndex + 1} di {Math.max(pageCount, 1)}
        </span>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => table.firstPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label="Prima pagina"
          >
            <Icons.ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label="Pagina precedente"
          >
            <Icons.ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            aria-label="Pagina successiva"
          >
            <Icons.ChevronRight />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => table.lastPage()}
            disabled={!table.getCanNextPage()}
            aria-label="Ultima pagina"
          >
            <Icons.ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

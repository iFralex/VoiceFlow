import * as React from 'react';

import { Icons } from '@/components/ui/icon';
import { TableCell, TableRow } from '@/components/ui/table';

type DataTableErrorProps = {
  columnCount: number;
  message?: string;
};

export function DataTableError({
  columnCount,
  message = 'Si è verificato un errore durante il caricamento dei dati.',
}: DataTableErrorProps) {
  return (
    <TableRow>
      <TableCell colSpan={columnCount}>
        <div
          data-slot="data-table-error"
          className="flex flex-col items-center justify-center gap-2 py-12 text-center"
        >
          <Icons.AlertCircle
            size={24}
            className="text-[hsl(var(--status-danger))]"
          />
          <p className="text-sm font-medium text-foreground">
            Errore di caricamento
          </p>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
      </TableCell>
    </TableRow>
  );
}

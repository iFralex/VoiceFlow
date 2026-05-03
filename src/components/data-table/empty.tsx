import * as React from 'react';

import { TableCell, TableRow } from '@/components/ui/table';

type DataTableEmptyProps = {
  columnCount: number;
  title?: string;
  description?: string;
  action?: React.ReactNode;
};

export function DataTableEmpty({
  columnCount,
  title = 'Nessun risultato',
  description = 'Non ci sono dati da mostrare.',
  action,
}: DataTableEmptyProps) {
  return (
    <TableRow>
      <TableCell colSpan={columnCount}>
        <div
          data-slot="data-table-empty"
          className="flex flex-col items-center justify-center gap-2 py-12 text-center"
        >
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
          {action}
        </div>
      </TableCell>
    </TableRow>
  );
}

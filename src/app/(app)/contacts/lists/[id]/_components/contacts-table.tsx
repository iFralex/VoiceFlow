'use client';

import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type RowSelectionState,
} from '@tanstack/react-table';
import { MoreHorizontal, Trash2, UserX } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Papa from 'papaparse';
import { useCallback, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  bulkDeleteContacts,
  bulkMarkContactsOptOut,
  deleteContact,
  markContactOptOut,
} from '@/actions/contacts';
import { DataTablePagination } from '@/components/data-table/pagination';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import type { SerializedContact } from './list-detail-client';

interface Props {
  contacts: SerializedContact[];
  listId: string;
  orgId: string;
}

// Metadata viewer dialog
function MetadataDialog({
  contact,
  open,
  onClose,
}: {
  contact: SerializedContact | null;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('contacts');
  if (!contact) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('action_view_metadata')}</DialogTitle>
        </DialogHeader>
        <pre className="max-h-96 overflow-auto rounded bg-muted p-3 text-xs">
          {JSON.stringify(contact.metadata, null, 2)}
        </pre>
      </DialogContent>
    </Dialog>
  );
}

export function ContactsTable({ contacts, listId: _listId, orgId: _orgId }: Props) {
  const t = useTranslations('contacts');
  const router = useRouter();

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [searchValue, setSearchValue] = useState('');
  const [optOutFilter, setOptOutFilter] = useState<'all' | 'yes' | 'no'>('all');
  const [rpoFilter, setRpoFilter] = useState<'all' | 'clear' | 'blocked' | 'unchecked'>('all');
  const [hasEmailFilter, setHasEmailFilter] = useState(false);

  const [metadataContact, setMetadataContact] = useState<SerializedContact | null>(null);
  const [metadataOpen, setMetadataOpen] = useState(false);

  const [isPending, startTransition] = useTransition();

  // Filter contacts locally
  const filteredContacts = useMemo(() => {
    return contacts.filter((c) => {
      if (optOutFilter === 'yes' && !c.opt_out) return false;
      if (optOutFilter === 'no' && c.opt_out) return false;
      if (rpoFilter !== 'all' && c.rpo_status !== rpoFilter) return false;
      if (hasEmailFilter && !c.email) return false;
      if (searchValue) {
        const q = searchValue.toLowerCase();
        const name = [c.first_name, c.last_name].filter(Boolean).join(' ').toLowerCase();
        if (!name.includes(q) && !c.phone_e164.includes(q)) return false;
      }
      return true;
    });
  }, [contacts, optOutFilter, rpoFilter, hasEmailFilter, searchValue]);

  const columns: ColumnDef<SerializedContact>[] = useMemo(
    () => [
      {
        id: 'select',
        size: 40,
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected()
                ? true
                : table.getIsSomePageRowsSelected()
                  ? 'indeterminate'
                  : false
            }
            onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(v) => row.toggleSelected(!!v)}
            aria-label="Select row"
          />
        ),
        enableSorting: false,
        enableColumnFilter: false,
      },
      {
        id: 'name',
        header: t('col_name'),
        accessorFn: (row) =>
          [row.first_name, row.last_name].filter(Boolean).join(' ') || '—',
        cell: ({ getValue }) => (
          <span className="font-medium">{getValue() as string}</span>
        ),
      },
      {
        id: 'phone',
        header: t('col_phone'),
        accessorKey: 'phone_e164',
        cell: ({ getValue }) => (
          <span className="font-mono text-sm">{getValue() as string}</span>
        ),
      },
      {
        id: 'email',
        header: t('col_email'),
        accessorKey: 'email',
        cell: ({ getValue }) => {
          const v = getValue() as string | null;
          return v ? <span className="text-sm">{v}</span> : <span className="text-muted-foreground">—</span>;
        },
      },
      {
        id: 'opt_out',
        header: t('col_opt_out'),
        accessorKey: 'opt_out',
        cell: ({ getValue }) => {
          const v = getValue() as boolean;
          return v ? (
            <StatusBadge status="opted_out" label={t('status_opted_out')} />
          ) : (
            <StatusBadge status="active" label={t('status_active')} />
          );
        },
      },
      {
        id: 'rpo_status',
        header: t('col_rpo'),
        accessorKey: 'rpo_status',
        cell: ({ getValue }) => {
          const v = getValue() as string;
          if (v === 'clear') return <StatusBadge status="compliant" />;
          if (v === 'blocked') return <StatusBadge status="blocked" />;
          return <StatusBadge status="pending" label="Unchecked" />;
        },
      },
      {
        id: 'actions',
        size: 60,
        header: '',
        cell: ({ row }) => {
          const contact = row.original;
          return <ContactRowActions contact={contact} onMetadata={() => {
            setMetadataContact(contact);
            setMetadataOpen(true);
          }} onRefresh={() => router.refresh()} />;
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  );

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table returns functions; known React Compiler limitation
  const table = useReactTable({
    data: filteredContacts,
    columns,
    state: {
      rowSelection,
      columnFilters,
    },
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    initialState: {
      pagination: { pageIndex: 0, pageSize: 25 },
    },
  });

  const selectedRows = table.getSelectedRowModel().rows.map((r) => r.original);
  const selectedCount = selectedRows.length;

  function handleExportSelected() {
    const data = selectedCount > 0 ? selectedRows : filteredContacts;
    const csv = Papa.unparse(
      data.map((c) => ({
        phone: c.phone_e164,
        first_name: c.first_name ?? '',
        last_name: c.last_name ?? '',
        email: c.email ?? '',
        opt_out: c.opt_out ? 'yes' : 'no',
        rpo_status: c.rpo_status,
      })),
    );
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'contacts.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleBulkOptOut() {
    startTransition(async () => {
      const result = await bulkMarkContactsOptOut({
        contacts: selectedRows.map((r) => ({ contactId: r.id, phoneE164: r.phone_e164 })),
      });
      if (result.ok) {
        toast.success(t('bulk_opt_out_success', { count: String(selectedCount) }));
        setRowSelection({});
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleBulkDelete() {
    startTransition(async () => {
      const result = await bulkDeleteContacts({
        contactIds: selectedRows.map((r) => r.id),
      });
      if (result.ok) {
        toast.success(t('bulk_delete_success', { count: String(selectedCount) }));
        setRowSelection({});
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div className="space-y-3">
      {/* Filter toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder={t('filter_search')}
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          className="h-8 w-64"
        />

        <Select value={optOutFilter} onValueChange={(v) => setOptOutFilter(v as typeof optOutFilter)}>
          <SelectTrigger className="h-8 w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('filter_all_opt_out')}</SelectItem>
            <SelectItem value="yes">{t('filter_opt_out')}</SelectItem>
            <SelectItem value="no">{t('status_active')}</SelectItem>
          </SelectContent>
        </Select>

        <Select value={rpoFilter} onValueChange={(v) => setRpoFilter(v as typeof rpoFilter)}>
          <SelectTrigger className="h-8 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('filter_all_rpo')}</SelectItem>
            <SelectItem value="clear">{t('rpo_clear')}</SelectItem>
            <SelectItem value="blocked">{t('rpo_blocked')}</SelectItem>
            <SelectItem value="unchecked">{t('rpo_unchecked')}</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant={hasEmailFilter ? 'secondary' : 'outline'}
          size="sm"
          className="h-8"
          onClick={() => setHasEmailFilter((v) => !v)}
        >
          {t('filter_has_email')}
        </Button>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8" onClick={handleExportSelected}>
            {selectedCount > 0
              ? t('export_selected', { count: String(selectedCount) })
              : t('export_contacts')}
          </Button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedCount > 0 && (
        <div className="flex items-center gap-3 rounded-md border bg-muted/50 px-4 py-2">
          <span className="text-sm font-medium">
            {t('bulk_selected', { count: String(selectedCount) })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={handleBulkOptOut}
          >
            <UserX className="mr-1 size-3" />
            {t('bulk_mark_opt_out')}
          </Button>
          <ConfirmDialog
            trigger={
              <Button variant="outline" size="sm" disabled={isPending}>
                <Trash2 className="mr-1 size-3" />
                {t('bulk_delete')}
              </Button>
            }
            title={t('action_delete_title')}
            description={t('action_bulk_delete_description', { count: String(selectedCount) })}
            onConfirm={handleBulkDelete}
          />
        </div>
      )}

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  {filteredContacts.length === 0 && contacts.length > 0
                    ? t('no_contacts_match')
                    : t('no_contacts_in_list')}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? 'selected' : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <DataTablePagination table={table} />

      {/* Metadata viewer */}
      <MetadataDialog
        contact={metadataContact}
        open={metadataOpen}
        onClose={() => setMetadataOpen(false)}
      />
    </div>
  );
}

// Per-row actions dropdown
function ContactRowActions({
  contact,
  onMetadata,
  onRefresh,
}: {
  contact: SerializedContact;
  onMetadata: () => void;
  onRefresh: () => void;
}) {
  const t = useTranslations('contacts');
  const tc = useTranslations('common');
  const [isPending, startTransition] = useTransition();

  const handleOptOut = useCallback(() => {
    startTransition(async () => {
      const result = await markContactOptOut({
        contactId: contact.id,
        phoneE164: contact.phone_e164,
      });
      if (result.ok) {
        toast.success(t('action_opt_out_success'));
        onRefresh();
      } else {
        toast.error(result.message);
      }
    });
  }, [contact, t, onRefresh]);

  const handleDelete = useCallback(async () => {
    const result = await deleteContact({ contactId: contact.id });
    if (result.ok) {
      toast.success(t('action_delete_success'));
      onRefresh();
    } else {
      toast.error(result.message);
    }
  }, [contact, t, onRefresh]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7" disabled={isPending}>
          <MoreHorizontal className="size-4" />
          <span className="sr-only">{tc('open_menu')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onMetadata}>
          {t('action_view_metadata')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={handleOptOut}
          disabled={contact.opt_out || isPending}
        >
          {t('action_mark_opt_out')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <ConfirmDialog
          trigger={
            <DropdownMenuItem
              variant="destructive"
              onSelect={(e) => e.preventDefault()}
            >
              {t('action_delete')}
            </DropdownMenuItem>
          }
          title={t('action_delete_title')}
          description={t('action_delete_description')}
          onConfirm={handleDelete}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

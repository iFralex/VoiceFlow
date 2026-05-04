'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useState, useTransition } from 'react';

import { exportLedgerCsv, getLedgerPage } from '@/actions/billing';
import type { LedgerPageResult } from '@/actions/billing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { LedgerEntryType } from '@/lib/services/credit';

// ─── Types ────────────────────────────────────────────────────────────────────

type LedgerEntry = Extract<LedgerPageResult, { ok: true }>['entries'][number];

/** Serialised PackagePool — Date is an ISO string for the client boundary */
export type SerializedPool = {
  packageName: string;
  includedMinutes: number;
  priceCents: number;
  purchasedAt: string;
  invoiceUrl: string | null;
};

export type CreditPageClientProps = {
  balanceCents: number;
  remainingMinutes: number;
  pools: SerializedPool[];
  initialEntries: LedgerEntry[];
  initialTotal: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

function formatEuros(cents: number): string {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('it-IT', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}

function formatDateOnly(iso: string): string {
  return new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium' }).format(new Date(iso));
}

const ENTRY_TYPE_BADGE: Record<LedgerEntryType, string> = {
  topup: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  charge: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  reservation: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  release: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  refund: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200',
  adjustment: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function CreditPageClient({
  balanceCents,
  remainingMinutes,
  pools,
  initialEntries,
  initialTotal,
}: CreditPageClientProps) {
  const t = useTranslations('credit');

  // Filter state
  const [entryType, setEntryType] = useState<LedgerEntryType | 'all'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  // Data state
  const [entries, setEntries] = useState<LedgerEntry[]>(initialEntries);
  const [total, setTotal] = useState(initialTotal);

  const [isFetching, startFetch] = useTransition();
  const [isExporting, startExport] = useTransition();

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const fetchPage = useCallback(
    (
      nextPage: number,
      type: LedgerEntryType | 'all',
      from: string,
      to: string,
    ) => {
      startFetch(async () => {
        const result = await getLedgerPage({
          page: nextPage,
          pageSize: PAGE_SIZE,
          entryType: type === 'all' ? null : type,
          dateFrom: from ? new Date(from).toISOString() : null,
          dateTo: to ? new Date(to + 'T23:59:59').toISOString() : null,
        });
        if (result.ok) {
          setEntries(result.entries);
          setTotal(result.total);
          setPage(nextPage);
        }
      });
    },
    [],
  );

  function handleTypeChange(value: string) {
    const type = value as LedgerEntryType | 'all';
    setEntryType(type);
    fetchPage(1, type, dateFrom, dateTo);
  }

  function handleDateFromChange(value: string) {
    setDateFrom(value);
    fetchPage(1, entryType, value, dateTo);
  }

  function handleDateToChange(value: string) {
    setDateTo(value);
    fetchPage(1, entryType, dateFrom, value);
  }

  function handlePrevPage() {
    if (page > 1) fetchPage(page - 1, entryType, dateFrom, dateTo);
  }

  function handleNextPage() {
    if (page < totalPages) fetchPage(page + 1, entryType, dateFrom, dateTo);
  }

  function handleExportCsv() {
    startExport(async () => {
      const result = await exportLedgerCsv({
        entryType: entryType === 'all' ? null : entryType,
        dateFrom: dateFrom ? new Date(dateFrom).toISOString() : null,
        dateTo: dateTo ? new Date(dateTo + 'T23:59:59').toISOString() : null,
      });
      if (!result.ok || !result.csv) return;

      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `credito-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  return (
    <div className="space-y-8">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('page_title')}</h1>
        <Button asChild>
          <Link href="/credit/topup">{t('top_up_cta')}</Link>
        </Button>
      </div>

      {/* ── Balance card ── */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <p className="text-sm text-muted-foreground">{t('credit_balance_label')}</p>
        <p className="mt-2 text-5xl font-bold tracking-tight">
          {t('balance_minutes', { minutes: remainingMinutes.toLocaleString('it-IT') })}
        </p>
        <p className="mt-1 text-lg text-muted-foreground">
          {t('balance_cents', { euros: (balanceCents / 100).toFixed(2).replace('.', ',') })}
        </p>
      </div>

      {/* ── Package pools (shown when more than one pool) ── */}
      {pools.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold">{t('package_pools_title')}</h2>
          <ul className="space-y-2">
            {pools.map((pool, i) => (
              <li
                key={i}
                className="flex items-center justify-between rounded-lg border bg-card px-4 py-3 text-sm"
              >
                <div>
                  <span className="font-medium">{pool.packageName}</span>
                  <span className="ml-2 text-muted-foreground">
                    — {pool.includedMinutes.toLocaleString('it-IT')} min
                  </span>
                </div>
                <div className="text-right text-muted-foreground">
                  <span>{t('pool_purchased_on', { date: formatDateOnly(pool.purchasedAt) })}</span>
                  {pool.invoiceUrl && (
                    <a
                      href={pool.invoiceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-3 text-primary underline underline-offset-2"
                    >
                      {formatEuros(pool.priceCents)}
                    </a>
                  )}
                  {!pool.invoiceUrl && (
                    <span className="ml-3">{formatEuros(pool.priceCents)}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Ledger history ── */}
      <section>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <h2 className="text-base font-semibold">{t('ledger_title')}</h2>

          <div className="ml-auto flex flex-wrap items-end gap-3">
            {/* Entry type filter */}
            <div className="w-44">
              <Select value={entryType} onValueChange={handleTypeChange}>
                <SelectTrigger>
                  <SelectValue placeholder={t('filter_all_types')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('filter_all_types')}</SelectItem>
                  <SelectItem value="topup">{t('filter_type_topup')}</SelectItem>
                  <SelectItem value="charge">{t('filter_type_charge')}</SelectItem>
                  <SelectItem value="reservation">{t('filter_type_reservation')}</SelectItem>
                  <SelectItem value="release">{t('filter_type_release')}</SelectItem>
                  <SelectItem value="refund">{t('filter_type_refund')}</SelectItem>
                  <SelectItem value="adjustment">{t('filter_type_adjustment')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Date from */}
            <div className="flex items-center gap-1">
              <label className="text-xs text-muted-foreground">{t('filter_date_from')}</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => handleDateFromChange(e.target.value)}
                className="w-36"
              />
            </div>

            {/* Date to */}
            <div className="flex items-center gap-1">
              <label className="text-xs text-muted-foreground">{t('filter_date_to')}</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => handleDateToChange(e.target.value)}
                className="w-36"
              />
            </div>

            {/* CSV export */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCsv}
              disabled={isExporting}
            >
              {t('export_csv')}
            </Button>
          </div>
        </div>

        {/* Table */}
        <div
          className={cn(
            'overflow-x-auto rounded-lg border bg-card',
            isFetching && 'opacity-60 transition-opacity',
          )}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-3 text-left font-medium">{t('ledger_col_type')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('ledger_col_description')}</th>
                <th className="px-4 py-3 text-right font-medium">{t('ledger_col_delta')}</th>
                <th className="px-4 py-3 text-right font-medium">{t('ledger_col_balance')}</th>
                <th className="px-4 py-3 text-right font-medium">{t('ledger_col_date')}</th>
                <th className="px-4 py-3 text-right font-medium">{t('ledger_col_invoice')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    {t('ledger_no_entries')}
                  </td>
                </tr>
              )}
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                        ENTRY_TYPE_BADGE[entry.entry_type],
                      )}
                    >
                      {t(`filter_type_${entry.entry_type}` as Parameters<typeof t>[0])}
                    </span>
                  </td>
                  <td className="max-w-xs truncate px-4 py-3 text-muted-foreground">
                    {entry.description ?? '—'}
                  </td>
                  <td
                    className={cn(
                      'px-4 py-3 text-right font-mono font-medium tabular-nums',
                      entry.delta_cents > 0
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-red-600 dark:text-red-400',
                    )}
                  >
                    {entry.delta_cents > 0 ? '+' : ''}
                    {formatEuros(entry.delta_cents)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                    {formatEuros(entry.balance_after_cents)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-muted-foreground">
                    {formatDate(entry.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {entry.invoice_url ? (
                      <a
                        href={entry.invoice_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary underline underline-offset-2"
                      >
                        {t('invoice_link')}
                      </a>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {total} {total === 1 ? 'movimento' : 'movimenti'}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrevPage}
                disabled={page <= 1 || isFetching}
              >
                ←
              </Button>
              <span>
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleNextPage}
                disabled={page >= totalPages || isFetching}
              >
                →
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

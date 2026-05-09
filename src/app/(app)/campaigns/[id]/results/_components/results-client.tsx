'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Papa from 'papaparse';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
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
import type {
  CampaignCallOutcome,
  CampaignResultRow,
} from '@/lib/services/campaign-results';
import { cn } from '@/lib/utils/index';

// ─── Types ───────────────────────────────────────────────────────────────────

const ALL_OUTCOMES: CampaignCallOutcome[] = [
  'interested',
  'appointment_booked',
  'callback_requested',
  'not_interested',
  'wrong_number',
  'voicemail_left',
  'voicemail_no_message',
  'do_not_call',
];

export interface CampaignResultsClientProps {
  campaignId: string;
  campaignName: string;
  rows: CampaignResultRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: 'started_desc' | 'started_asc' | 'duration_desc' | 'duration_asc' | 'cost_desc' | 'cost_asc';
  outcomes: CampaignCallOutcome[];
  durationMinSeconds: number | null;
  durationMaxSeconds: number | null;
  dateFrom: string | null;
  dateTo: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCents(cents: number | null): string {
  if (cents == null) return '—';
  return (cents / 100).toLocaleString('it-IT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  });
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Maps outcomes to status-token CSS variables consistent with StatusBadge.
const OUTCOME_TOKEN: Record<CampaignCallOutcome, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  interested: 'success',
  appointment_booked: 'info',
  callback_requested: 'info',
  not_interested: 'neutral',
  wrong_number: 'warning',
  voicemail_left: 'neutral',
  voicemail_no_message: 'neutral',
  do_not_call: 'danger',
};

const OUTCOME_TOKEN_CLASS: Record<string, string> = {
  success:
    'bg-[hsl(var(--status-success)/0.12)] text-[hsl(var(--status-success))] border-[hsl(var(--status-success)/0.3)]',
  info:
    'bg-[hsl(var(--status-info)/0.12)] text-[hsl(var(--status-info))] border-[hsl(var(--status-info)/0.3)]',
  warning:
    'bg-[hsl(var(--status-warning)/0.12)] text-[hsl(var(--status-warning))] border-[hsl(var(--status-warning)/0.3)]',
  danger:
    'bg-[hsl(var(--status-danger)/0.12)] text-[hsl(var(--status-danger))] border-[hsl(var(--status-danger)/0.3)]',
  neutral:
    'bg-[hsl(var(--status-neutral)/0.12)] text-[hsl(var(--status-neutral))] border-[hsl(var(--status-neutral)/0.3)]',
};

function OutcomeBadge({ outcome }: { outcome: CampaignCallOutcome | null }) {
  const t = useTranslations('campaigns');
  if (!outcome) return <span className="text-muted-foreground">—</span>;
  const token = OUTCOME_TOKEN[outcome];
  return (
    <span
      data-slot="outcome-badge"
      data-outcome={outcome}
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        OUTCOME_TOKEN_CLASS[token],
      )}
    >
      {t(`outcome_${outcome}`)}
    </span>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CampaignResultsClient({
  campaignId,
  campaignName,
  rows,
  total,
  page,
  pageSize,
  sort,
  outcomes,
  durationMinSeconds,
  durationMaxSeconds,
  dateFrom,
  dateTo,
}: CampaignResultsClientProps) {
  const t = useTranslations('campaigns');
  const tt = useTranslations('table');
  const router = useRouter();
  const searchParams = useSearchParams();

  const [selected, setSelected] = React.useState<Record<string, boolean>>({});

  const selectedCount = Object.values(selected).filter(Boolean).length;
  const allSelected = rows.length > 0 && rows.every((r) => selected[r.id]);
  const someSelected = !allSelected && rows.some((r) => selected[r.id]);

  function toggleAll(value: boolean) {
    if (!value) {
      setSelected({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const r of rows) next[r.id] = true;
    setSelected(next);
  }

  function toggleRow(id: string, value: boolean) {
    setSelected((prev) => ({ ...prev, [id]: value }));
  }

  // ─── URL state helpers ─────────────────────────────────────────────────────

  function buildUrl(updates: Record<string, string | string[] | null>): string {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '' || (Array.isArray(v) && v.length === 0)) {
        params.delete(k);
      } else if (Array.isArray(v)) {
        params.set(k, v.join(','));
      } else {
        params.set(k, v);
      }
    }
    const qs = params.toString();
    return `/campaigns/${campaignId}/results${qs ? `?${qs}` : ''}`;
  }

  function applyFilter(updates: Record<string, string | string[] | null>) {
    // Reset to page 0 whenever filters change.
    router.push(buildUrl({ ...updates, page: '0' }));
  }

  function setOutcomeSelection(outcome: CampaignCallOutcome, on: boolean) {
    const next = on
      ? Array.from(new Set([...outcomes, outcome]))
      : outcomes.filter((o) => o !== outcome);
    applyFilter({ outcome: next });
  }

  function setSort(value: CampaignResultsClientProps['sort']) {
    router.push(buildUrl({ sort: value, page: '0' }));
  }

  function goToPage(nextPage: number) {
    router.push(buildUrl({ page: String(Math.max(0, nextPage)) }));
  }

  function clearFilters() {
    router.push(`/campaigns/${campaignId}/results`);
  }

  // ─── CSV export ────────────────────────────────────────────────────────────

  function handleExportSelected() {
    const idSet = new Set(Object.entries(selected).filter(([, v]) => v).map(([k]) => k));
    const data = idSet.size > 0 ? rows.filter((r) => idSet.has(r.id)) : rows;
    const csv = Papa.unparse(
      data.map((r) => ({
        contatto: r.contactName,
        telefono: r.phoneE164 ?? '',
        stato: r.status,
        esito: r.outcome ?? '',
        durata_secondi: r.billableSeconds ?? '',
        costo_eur: r.costCents != null ? (r.costCents / 100).toFixed(2) : '',
        ora_chiamata: r.startedAtIso ?? r.createdAtIso,
      })),
    );
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `campaign-${campaignId}-results.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasActiveFilter =
    outcomes.length > 0 ||
    durationMinSeconds != null ||
    durationMaxSeconds != null ||
    dateFrom != null ||
    dateTo != null;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <Link
          href={`/campaigns/${campaignId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          {t('back_to_campaigns')}
        </Link>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{campaignName}</h1>
          <p className="text-sm text-muted-foreground">{t('results_subtitle')}</p>
        </div>
      </div>

      {/* Filter toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Outcome multi-select */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8">
              {t('results_filter_outcome')}
              {outcomes.length > 0 && (
                <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">
                  {outcomes.length}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>{t('results_filter_outcome')}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {ALL_OUTCOMES.map((o) => (
              <DropdownMenuCheckboxItem
                key={o}
                checked={outcomes.includes(o)}
                onCheckedChange={(v) => setOutcomeSelection(o, !!v)}
              >
                {t(`outcome_${o}`)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Duration range */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t('results_filter_duration')}
          </span>
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            placeholder={t('results_filter_duration_min')}
            className="h-8 w-24"
            defaultValue={durationMinSeconds ?? ''}
            aria-label={t('results_filter_duration_min')}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              applyFilter({ durationMin: raw === '' ? null : raw });
            }}
          />
          <span className="text-xs text-muted-foreground">–</span>
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            placeholder={t('results_filter_duration_max')}
            className="h-8 w-24"
            defaultValue={durationMaxSeconds ?? ''}
            aria-label={t('results_filter_duration_max')}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              applyFilter({ durationMax: raw === '' ? null : raw });
            }}
          />
        </div>

        {/* Date range */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t('results_filter_date')}
          </span>
          <Input
            type="date"
            className="h-8 w-36"
            defaultValue={dateFrom ?? ''}
            aria-label={t('results_filter_date_from')}
            onChange={(e) => {
              const raw = e.target.value;
              applyFilter({ dateFrom: raw === '' ? null : raw });
            }}
          />
          <span className="text-xs text-muted-foreground">–</span>
          <Input
            type="date"
            className="h-8 w-36"
            defaultValue={dateTo ?? ''}
            aria-label={t('results_filter_date_to')}
            onChange={(e) => {
              const raw = e.target.value;
              applyFilter({ dateTo: raw === '' ? null : raw });
            }}
          />
        </div>

        {hasActiveFilter && (
          <Button variant="ghost" size="sm" className="h-8" onClick={clearFilters}>
            {t('results_filter_clear')}
          </Button>
        )}

        {/* Sort */}
        <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
          <SelectTrigger className="h-8 w-48" aria-label={t('results_sort_label')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="started_desc">{t('results_sort_started_desc')}</SelectItem>
            <SelectItem value="started_asc">{t('results_sort_started_asc')}</SelectItem>
            <SelectItem value="duration_desc">{t('results_sort_duration_desc')}</SelectItem>
            <SelectItem value="duration_asc">{t('results_sort_duration_asc')}</SelectItem>
            <SelectItem value="cost_desc">{t('results_sort_cost_desc')}</SelectItem>
            <SelectItem value="cost_asc">{t('results_sort_cost_asc')}</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={handleExportSelected}
            disabled={rows.length === 0}
          >
            {selectedCount > 0
              ? t('results_export_selected', { count: selectedCount })
              : t('results_export_all')}
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead style={{ width: 40 }}>
                <Checkbox
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  onCheckedChange={(v) => toggleAll(!!v)}
                  aria-label="Select all"
                />
              </TableHead>
              <TableHead>{t('results_col_contact')}</TableHead>
              <TableHead>{t('results_col_phone')}</TableHead>
              <TableHead>{t('results_col_status')}</TableHead>
              <TableHead>{t('results_col_outcome')}</TableHead>
              <TableHead className="text-right">{t('results_col_duration')}</TableHead>
              <TableHead className="text-right">{t('results_col_cost')}</TableHead>
              <TableHead>{t('results_col_started')}</TableHead>
              <TableHead style={{ width: 100 }} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                  {hasActiveFilter ? t('results_empty_filtered') : t('results_empty')}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow
                  key={r.id}
                  data-slot="results-row"
                  data-call-id={r.id}
                  data-state={selected[r.id] ? 'selected' : undefined}
                >
                  <TableCell>
                    <Checkbox
                      checked={!!selected[r.id]}
                      onCheckedChange={(v) => toggleRow(r.id, !!v)}
                      aria-label="Select row"
                    />
                  </TableCell>
                  <TableCell className="font-medium">{r.contactName || '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{r.phoneE164 ?? '—'}</TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell>
                    <OutcomeBadge outcome={r.outcome} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatDuration(r.billableSeconds)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCents(r.costCents)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {formatDateTime(r.startedAtIso ?? r.createdAtIso)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/calls/${r.id}`}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      {t('results_action_detail')}
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {tt('total_rows', { total })}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={page <= 0}
              onClick={() => goToPage(page - 1)}
            >
              {tt('prev_page')}
            </Button>
            <span className="tabular-nums">
              {tt('page_of', { page: page + 1, total: totalPages })}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={page + 1 >= totalPages}
              onClick={() => goToPage(page + 1)}
            >
              {tt('next_page')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

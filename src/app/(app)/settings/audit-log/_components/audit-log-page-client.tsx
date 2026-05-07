'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useState, useTransition } from 'react';

import { exportAuditLogCsv, listAuditLogEntries, type SerializedAuditLogEntry } from '@/actions/audit_log';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toastResult } from '@/lib/utils/action-toast';

interface AuditLogCursor {
  createdAt: string;
  id: string;
}

interface AuditLogPageClientProps {
  initialEntries: SerializedAuditLogEntry[];
  initialCursor: AuditLogCursor | null;
  pageSize: number;
}

interface FilterState {
  actionPrefix: string;
  fromDate: string;
  toDate: string;
  actorUserId: string;
}

const EMPTY_FILTERS: FilterState = {
  actionPrefix: '',
  fromDate: '',
  toDate: '',
  actorUserId: '',
};

function toIsoFromDateInput(date: string, end = false): string | undefined {
  if (!date) return undefined;
  // <input type="date"> emits YYYY-MM-DD; expand to a UTC instant.
  const iso = end ? `${date}T23:59:59.999Z` : `${date}T00:00:00.000Z`;
  return iso;
}

function buildFiltersPayload(state: FilterState) {
  const payload: {
    actionPrefix?: string;
    fromIso?: string;
    toIso?: string;
    actorUserId?: string;
  } = {};
  const trimmed = state.actionPrefix.trim();
  if (trimmed) payload.actionPrefix = trimmed;
  const from = toIsoFromDateInput(state.fromDate);
  if (from) payload.fromIso = from;
  const to = toIsoFromDateInput(state.toDate, true);
  if (to) payload.toIso = to;
  const actor = state.actorUserId.trim();
  if (actor) payload.actorUserId = actor;
  return payload;
}

export function AuditLogPageClient({
  initialEntries,
  initialCursor,
  pageSize,
}: AuditLogPageClientProps) {
  const t = useTranslations('audit_log');

  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [entries, setEntries] = useState<SerializedAuditLogEntry[]>(initialEntries);
  const [cursor, setCursor] = useState<AuditLogCursor | null>(initialCursor);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [exporting, startExport] = useTransition();

  const reload = useCallback((next: FilterState) => {
    startTransition(async () => {
      const payload = buildFiltersPayload(next);
      const r = await listAuditLogEntries({ filters: payload, limit: pageSize });
      if (r.ok && r.data) {
        setEntries(r.data.entries);
        setCursor(r.data.nextCursor);
        setAppliedFilters(next);
      } else if (!r.ok) {
        toastResult({ ok: false, message: r.message });
      }
    });
  }, [pageSize]);

  function handleApplyFilters() {
    reload(filters);
  }

  function handleResetFilters() {
    setFilters(EMPTY_FILTERS);
    reload(EMPTY_FILTERS);
  }

  function handleLoadMore() {
    if (!cursor) return;
    startTransition(async () => {
      const payload = buildFiltersPayload(appliedFilters);
      const r = await listAuditLogEntries({
        filters: payload,
        cursor,
        limit: pageSize,
      });
      if (r.ok && r.data) {
        setEntries((prev) => [...prev, ...r.data!.entries]);
        setCursor(r.data.nextCursor);
      } else if (!r.ok) {
        toastResult({ ok: false, message: r.message });
      }
    });
  }

  function handleExport() {
    startExport(async () => {
      const payload = buildFiltersPayload(appliedFilters);
      const r = await exportAuditLogCsv({ filters: payload });
      if (r.ok && r.data) {
        toastResult({
          ok: true,
          message: r.data.truncated
            ? t('export_success_truncated', { count: r.data.rowCount })
            : t('export_success', { count: r.data.rowCount }),
        });
        // Trigger a file download via a transient anchor so the user gets the CSV
        // without leaving the page.
        const a = document.createElement('a');
        a.href = r.data.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else if (!r.ok) {
        toastResult({ ok: false, message: r.message });
      }
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      <section className="rounded-lg border p-4 space-y-3">
        <h2 className="text-sm font-semibold">{t('filters_title')}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="audit-action">
              {t('filter_action_label')}
            </label>
            <Input
              id="audit-action"
              placeholder={t('filter_action_placeholder')}
              value={filters.actionPrefix}
              onChange={(e) => setFilters((s) => ({ ...s, actionPrefix: e.target.value }))}
              disabled={pending}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="audit-from">
              {t('filter_from_label')}
            </label>
            <Input
              id="audit-from"
              type="date"
              value={filters.fromDate}
              onChange={(e) => setFilters((s) => ({ ...s, fromDate: e.target.value }))}
              disabled={pending}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="audit-to">
              {t('filter_to_label')}
            </label>
            <Input
              id="audit-to"
              type="date"
              value={filters.toDate}
              onChange={(e) => setFilters((s) => ({ ...s, toDate: e.target.value }))}
              disabled={pending}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="audit-actor">
              {t('filter_actor_label')}
            </label>
            <Input
              id="audit-actor"
              placeholder={t('filter_actor_placeholder')}
              value={filters.actorUserId}
              onChange={(e) => setFilters((s) => ({ ...s, actorUserId: e.target.value }))}
              disabled={pending}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleApplyFilters} disabled={pending} size="sm">
            {pending ? t('applying') : t('apply_filters')}
          </Button>
          <Button onClick={handleResetFilters} variant="outline" disabled={pending} size="sm">
            {t('reset_filters')}
          </Button>
          <div className="ml-auto">
            <Button
              onClick={handleExport}
              variant="outline"
              size="sm"
              disabled={exporting || pending}
            >
              {exporting ? t('exporting') : t('export_csv')}
            </Button>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        {entries.length === 0 ? (
          <EmptyState title={t('empty_title')} description={t('empty_description')} />
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('column_timestamp')}</TableHead>
                  <TableHead>{t('column_actor')}</TableHead>
                  <TableHead>{t('column_action')}</TableHead>
                  <TableHead>{t('column_subject')}</TableHead>
                  <TableHead>{t('column_details')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => {
                  const isExpanded = expandedId === entry.id;
                  return (
                    <TableRow key={entry.id} data-testid="audit-log-row">
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        {new Date(entry.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {actorLabel(entry, t)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{entry.action}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {entry.subjectType}: {entry.subjectId}
                      </TableCell>
                      <TableCell>
                        {entry.metadata ? (
                          <div className="space-y-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                            >
                              {isExpanded ? t('details_hide') : t('details_show')}
                            </Button>
                            {isExpanded && (
                              <pre className="max-w-md whitespace-pre-wrap break-all rounded bg-muted/50 p-2 font-mono text-[11px] text-muted-foreground">
                                {JSON.stringify(entry.metadata, null, 2)}
                              </pre>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {cursor && (
          <div className="flex justify-center">
            <Button onClick={handleLoadMore} variant="outline" disabled={pending} size="sm">
              {pending ? t('loading_more') : t('load_more')}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

function actorLabel(
  entry: SerializedAuditLogEntry,
  t: (key: string) => string,
): string {
  if (entry.actorType === 'system') return t('actor_system');
  if (entry.actorType === 'webhook') return t('actor_webhook');
  return entry.actorEmail ?? entry.actorUserId ?? t('actor_unknown');
}

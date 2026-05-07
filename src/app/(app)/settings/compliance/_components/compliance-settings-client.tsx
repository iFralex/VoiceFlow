'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRef, useState, useTransition } from 'react';

import {
  listGdprHistory,
  requestSubjectErasure,
  requestSubjectExport,
  type GdprHistoryEntry,
  type SubjectExportActionData,
} from '@/actions/compliance';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toastResult } from '@/lib/utils/action-toast';

interface ComplianceSettingsClientProps {
  canErase: boolean;
  initialHistory: GdprHistoryEntry[];
}

export function ComplianceSettingsClient({
  canErase,
  initialHistory,
}: ComplianceSettingsClientProps) {
  const t = useTranslations('compliance_settings');
  const [identifier, setIdentifier] = useState('');
  const [history, setHistory] = useState<GdprHistoryEntry[]>(initialHistory);
  const [exportPending, startExport] = useTransition();
  const [historyPending, startHistory] = useTransition();
  const [lastExport, setLastExport] = useState<SubjectExportActionData | null>(null);
  const [eraseDialogOpen, setEraseDialogOpen] = useState(false);

  function refreshHistory() {
    startHistory(async () => {
      const r = await listGdprHistory({ limit: 50 });
      if (r.ok && r.data) setHistory(r.data.entries);
    });
  }

  function handleExport() {
    if (!identifier.trim()) return;
    startExport(async () => {
      const r = await requestSubjectExport({ identifier: identifier.trim() });
      if (r.ok && r.data) {
        setLastExport(r.data);
        toastResult({ ok: true, message: t('export_success') });
        refreshHistory();
      } else if (!r.ok) {
        const msg = r.message === 'subject_not_found' ? t('subject_not_found') : r.message;
        toastResult({ ok: false, message: msg });
      }
    });
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      <section className="rounded-lg border p-4 space-y-4">
        <div>
          <h2 className="text-sm font-semibold">{t('rights_title')}</h2>
          <p className="text-sm text-muted-foreground">{t('rights_description')}</p>
        </div>

        <div className="space-y-2 max-w-lg">
          <label htmlFor="gdpr-identifier" className="text-sm font-medium">
            {t('identifier_label')}
          </label>
          <Input
            id="gdpr-identifier"
            placeholder={t('identifier_placeholder')}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            disabled={exportPending}
          />
          <p className="text-xs text-muted-foreground">{t('identifier_hint')}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={handleExport}
            disabled={exportPending || !identifier.trim()}
          >
            {exportPending ? t('export_submitting') : t('export_button')}
          </Button>
          {canErase && (
            <Button
              variant="destructive"
              onClick={() => setEraseDialogOpen(true)}
              disabled={!identifier.trim()}
            >
              {t('erase_button')}
            </Button>
          )}
        </div>

        {lastExport && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
            <p className="font-medium">{t('export_ready_title')}</p>
            <p className="text-muted-foreground">
              {t('export_ready_expires', { date: new Date(lastExport.expiresAt).toLocaleString() })}
            </p>
            <a
              className="text-primary underline"
              href={lastExport.url}
              rel="noopener noreferrer"
              target="_blank"
            >
              {t('export_ready_download')}
            </a>
          </div>
        )}
      </section>

      <section className="rounded-lg border p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">{t('history_title')}</h2>
            <p className="text-sm text-muted-foreground">{t('history_description')}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={refreshHistory}
            disabled={historyPending}
          >
            {historyPending ? t('history_refreshing') : t('history_refresh')}
          </Button>
        </div>

        {history.length === 0 ? (
          <EmptyState title={t('history_empty_title')} description={t('history_empty_description')} />
        ) : (
          <ul className="divide-y rounded-md border">
            {history.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-1 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">
                    {entry.action === 'compliance.gdpr_export'
                      ? t('history_action_export')
                      : t('history_action_erasure')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(entry.createdAt).toLocaleString()} ·{' '}
                    {entry.actorEmail ?? t('history_actor_system')}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground sm:text-right">
                  {formatHistoryMetadata(entry, t)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold">{t('docs_title')}</h2>
          <p className="text-sm text-muted-foreground">{t('docs_description')}</p>
        </div>
        <ul className="space-y-2 text-sm">
          <li>
            <Link className="text-primary underline" href="/legal/dpa" target="_blank">
              {t('docs_dpa')}
            </Link>
          </li>
          <li>
            <Link className="text-primary underline" href="/legal/privacy" target="_blank">
              {t('docs_privacy')}
            </Link>
          </li>
          <li>
            <Link className="text-primary underline" href="/legal/terms" target="_blank">
              {t('docs_terms')}
            </Link>
          </li>
          <li>
            <Link className="text-primary underline" href="/legal/cookie" target="_blank">
              {t('docs_cookie')}
            </Link>
          </li>
          <li>
            <Link className="text-primary underline" href="/legal/rpo-compliance" target="_blank">
              {t('docs_rpo')}
            </Link>
          </li>
        </ul>
      </section>

      {canErase && (
        <EraseDialog
          open={eraseDialogOpen}
          onOpenChange={setEraseDialogOpen}
          identifier={identifier.trim()}
          onCompleted={() => {
            setEraseDialogOpen(false);
            refreshHistory();
          }}
        />
      )}
    </div>
  );
}

interface EraseDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  identifier: string;
  onCompleted: () => void;
}

function EraseDialog({ open, onOpenChange, identifier, onCompleted }: EraseDialogProps) {
  const t = useTranslations('compliance_settings');
  const [pending, startTransition] = useTransition();
  const phoneRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  function handleConfirm() {
    const confirmPhone = phoneRef.current?.value?.trim() ?? '';
    const reason = reasonRef.current?.value?.trim() ?? '';
    if (!identifier || !confirmPhone || !reason) return;

    startTransition(async () => {
      const r = await requestSubjectErasure({ identifier, confirmPhone, reason });
      if (r.ok) {
        toastResult({ ok: true, message: t('erase_success') });
        onCompleted();
      } else {
        let msg = r.message;
        if (r.message === 'subject_not_found') msg = t('subject_not_found');
        else if (r.message === 'confirmation_mismatch') msg = t('erase_mismatch');
        toastResult({ ok: false, message: msg });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('erase_dialog_title')}</DialogTitle>
          <DialogDescription>{t('erase_dialog_description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="erase-confirm-phone">
              {t('erase_confirm_phone_label')}
            </label>
            <Input
              id="erase-confirm-phone"
              ref={phoneRef}
              placeholder="+393331234567"
              autoComplete="off"
              disabled={pending}
            />
            <p className="text-xs text-muted-foreground">{t('erase_confirm_phone_hint')}</p>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="erase-reason">
              {t('erase_reason_label')}
            </label>
            <Textarea
              id="erase-reason"
              ref={reasonRef}
              rows={3}
              placeholder={t('erase_reason_placeholder')}
              disabled={pending}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t('erase_dialog_cancel')}
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={pending}>
            {pending ? t('erase_dialog_submitting') : t('erase_dialog_confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatHistoryMetadata(
  entry: GdprHistoryEntry,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const meta = entry.metadata ?? {};
  if (entry.action === 'compliance.gdpr_export') {
    const totals =
      typeof meta.totals === 'object' && meta.totals !== null
        ? (meta.totals as Record<string, unknown>)
        : {};
    const calls = typeof totals.calls === 'number' ? totals.calls : 0;
    return t('history_export_summary', { calls });
  }
  const phone = typeof meta.phoneE164 === 'string' ? meta.phoneE164 : entry.subjectId;
  return t('history_erasure_summary', { phone });
}

'use client';

import { AlertTriangle, ArrowLeft, RefreshCw, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { refundCallAction, reportCallIssueAction } from '@/actions/calls';
import { RecordingPlayer } from '@/components/calls/recording-player';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { StatusBadge, type CallStatus } from '@/components/ui/status-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import type { ActionResult } from '@/lib/utils/action-toast';
import { toastResult } from '@/lib/utils/action-toast';
import type { TranscriptSegment } from '@/lib/voice/types';

const PLACEHOLDER_REFRESH_MS = 15_000;

export type CallTimelineEvent = {
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
};

export type CallAuditEntry = {
  id: string;
  actorUserId: string | null;
  actorType: 'user' | 'system' | 'webhook';
  action: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type SerializedCallDetail = {
  id: string;
  status: CallStatus;
  outcome:
    | 'interested'
    | 'not_interested'
    | 'appointment_booked'
    | 'wrong_number'
    | 'callback_requested'
    | 'voicemail_left'
    | 'voicemail_no_message'
    | 'do_not_call'
    | null;
  direction: 'inbound' | 'outbound';
  contactName: string | null;
  contactPhone: string | null;
  campaignId: string | null;
  campaignName: string | null;
  scriptName: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  billableSeconds: number | null;
  costCents: number | null;
  metadata: Record<string, unknown>;
  recordingUrl: string | null;
  recordingAvailable: boolean;
  transcript: TranscriptSegment[];
  transcriptAvailable: boolean;
  timelineEvents: CallTimelineEvent[];
  auditEntries: CallAuditEntry[] | null;
  canRefund: boolean;
  canReport: boolean;
};

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

function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds === null) return '—';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function formatCents(cents: number | null): string {
  if (cents === null) return '—';
  return (cents / 100).toLocaleString('it-IT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  });
}

export function CallDetailClient({ call }: { call: SerializedCallDetail }) {
  const t = useTranslations('calls');
  const router = useRouter();

  // Auto-refresh while artifacts are still being processed.
  const mediaPending =
    !call.recordingAvailable ||
    !call.transcriptAvailable ||
    (call.recordingAvailable && !call.recordingUrl);
  React.useEffect(() => {
    if (!mediaPending) return;
    const handle = window.setInterval(() => {
      router.refresh();
    }, PLACEHOLDER_REFRESH_MS);
    return () => window.clearInterval(handle);
  }, [mediaPending, router]);

  return (
    <div className="space-y-6 p-6">
      <Header call={call} />
      <KpiRow call={call} />
      <Timeline events={call.timelineEvents} />
      <Tabs defaultValue="recording">
        <TabsList>
          <TabsTrigger value="recording">{t('tab_recording')}</TabsTrigger>
          <TabsTrigger value="data">{t('tab_data')}</TabsTrigger>
          <TabsTrigger value="audit">{t('tab_audit')}</TabsTrigger>
        </TabsList>
        <TabsContent value="recording" className="pt-4">
          <RecordingTab call={call} />
        </TabsContent>
        <TabsContent value="data" className="pt-4">
          <DataTab call={call} />
        </TabsContent>
        <TabsContent value="audit" className="pt-4">
          <AuditTab call={call} />
        </TabsContent>
      </Tabs>
      <Actions call={call} />
    </div>
  );
}

function Header({ call }: { call: SerializedCallDetail }) {
  const t = useTranslations('calls');
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-col gap-1">
        {call.campaignId ? (
          <Link
            href={`/campaigns/${call.campaignId}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3" />
            {t('back_to_campaign')}
          </Link>
        ) : (
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3" />
            {t('back_to_dashboard')}
          </Link>
        )}
        <h1 className="text-2xl font-semibold">
          {call.contactName ?? call.contactPhone ?? t('unknown_contact')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {call.contactPhone ?? '—'}
          {call.campaignName ? ` · ${call.campaignName}` : ''}
          {call.scriptName ? ` · ${call.scriptName}` : ''}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={call.status} />
        {call.outcome && (
          <span
            className="inline-flex h-5 shrink-0 items-center rounded-full border bg-[hsl(var(--status-info)/0.12)] px-2 py-0.5 text-xs font-medium text-[hsl(var(--status-info))]"
            data-slot="outcome-badge"
          >
            {/* outcomes share the campaigns namespace */}
            <OutcomeLabel outcome={call.outcome} />
          </span>
        )}
      </div>
    </div>
  );
}

function OutcomeLabel({ outcome }: { outcome: NonNullable<SerializedCallDetail['outcome']> }) {
  const t = useTranslations('campaigns');
  return <>{t(`outcome_${outcome}`)}</>;
}

function KpiRow({ call }: { call: SerializedCallDetail }) {
  const t = useTranslations('calls');
  const items = [
    { label: t('kpi_started'), value: formatDateTime(call.startedAt) },
    { label: t('kpi_duration'), value: formatDuration(call.billableSeconds) },
    { label: t('kpi_cost'), value: formatCents(call.costCents) },
    { label: t('kpi_direction'), value: t(`direction_${call.direction}`) },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((it) => (
        <div key={it.label} className="rounded-lg border bg-card p-3">
          <div className="text-xs text-muted-foreground">{it.label}</div>
          <div className="text-base font-semibold tabular-nums">{it.value}</div>
        </div>
      ))}
    </div>
  );
}

function Timeline({ events }: { events: CallTimelineEvent[] }) {
  const t = useTranslations('calls');
  if (events.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        {t('timeline_empty')}
      </div>
    );
  }
  return (
    <ol className="relative space-y-3 border-l pl-6" data-slot="call-timeline">
      {events.map((event, idx) => (
        <li
          key={`${event.type}-${event.timestamp}-${idx}`}
          className="relative"
          data-slot="call-timeline-event"
          data-action={event.type}
        >
          <span
            className="absolute -left-[31px] top-1 size-2 rounded-full bg-foreground/40"
            aria-hidden
          />
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium">
              <TimelineEventLabel event={event} />
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {formatDateTime(event.timestamp)}
            </span>
          </div>
          {event.type === 'call.tool_invoked' && typeof event.data['tool'] === 'string' && (
            <p className="text-xs text-muted-foreground">
              {t('timeline_tool', { name: String(event.data['tool']) })}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

function TimelineEventLabel({ event }: { event: CallTimelineEvent }) {
  const t = useTranslations('calls');
  const key = `event_${event.type.replace(/\./g, '_')}`;
  // useTranslations falls back to the key itself when a translation is
  // missing, so unknown action names still render readably.
  return <>{t(key as Parameters<typeof t>[0])}</>;
}

function RecordingTab({ call }: { call: SerializedCallDetail }) {
  const t = useTranslations('calls');
  if (!call.recordingAvailable || !call.recordingUrl) {
    return <ProcessingPlaceholder kind="recording" />;
  }
  if (!call.transcriptAvailable) {
    return (
      <div className="space-y-4">
        <RecordingPlayer audioUrl={call.recordingUrl} transcript={call.transcript} />
        <div className="rounded-lg border border-dashed bg-card p-3 text-sm text-muted-foreground">
          {t('transcript_processing')}
        </div>
      </div>
    );
  }
  return <RecordingPlayer audioUrl={call.recordingUrl} transcript={call.transcript} />;
}

function ProcessingPlaceholder({ kind }: { kind: 'recording' | 'transcript' }) {
  const t = useTranslations('calls');
  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-dashed bg-card p-4 text-sm text-muted-foreground"
      data-slot="processing-placeholder"
      data-kind={kind}
    >
      <RefreshCw className="size-4 animate-spin" aria-hidden />
      <span>
        {kind === 'recording' ? t('recording_processing') : t('transcript_processing')}
      </span>
    </div>
  );
}

function DataTab({ call }: { call: SerializedCallDetail }) {
  const json = JSON.stringify(call.metadata, null, 2);
  return (
    <pre
      className="max-h-[480px] overflow-auto rounded-lg border bg-muted p-3 text-xs"
      data-slot="call-metadata-json"
    >
      {json}
    </pre>
  );
}

function AuditTab({ call }: { call: SerializedCallDetail }) {
  const t = useTranslations('calls');
  if (call.auditEntries === null) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        {t('audit_forbidden')}
      </div>
    );
  }
  if (call.auditEntries.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        {t('audit_empty')}
      </div>
    );
  }
  return (
    <ul className="space-y-2" data-slot="call-audit-entries">
      {call.auditEntries.map((entry) => (
        <li
          key={entry.id}
          className="rounded-lg border bg-card p-3 text-sm"
          data-slot="call-audit-entry"
          data-action={entry.action}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium">{entry.action}</span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {formatDateTime(entry.createdAt)}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            {entry.actorType} {entry.actorUserId ? `· ${entry.actorUserId}` : ''}
          </div>
          {Object.keys(entry.metadata).length > 0 && (
            <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-[11px]">
              {JSON.stringify(entry.metadata, null, 2)}
            </pre>
          )}
        </li>
      ))}
    </ul>
  );
}

function Actions({ call }: { call: SerializedCallDetail }) {
  if (!call.canRefund && !call.canReport) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t pt-4">
      {call.canRefund && (call.costCents ?? 0) > 0 && (
        <RefundDialog callId={call.id} costCents={call.costCents ?? 0} />
      )}
      {call.canReport && <ReportDialog callId={call.id} />}
    </div>
  );
}

function RefundDialog({ callId, costCents }: { callId: string; costCents: number }) {
  const t = useTranslations('calls');
  const tc = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [pending, setPending] = React.useState(false);

  function translateResult(result: ActionResult): ActionResult {
    if (result.ok) return result;
    const key = result.message as Parameters<typeof t>[0];
    const translated = t(key);
    return { ok: false, message: translated !== key ? translated : result.message };
  }

  async function handleConfirm() {
    if (reason.trim().length < 3) return;
    setPending(true);
    try {
      const result = await refundCallAction({ callId, reason: reason.trim() });
      toastResult(translateResult(result), t('refund_success'));
      if (result.ok) {
        setOpen(false);
        setReason('');
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Undo2 className="size-4" />
          {t('refund_action')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('refund_dialog_title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('refund_dialog_description', {
              amount: (costCents / 100).toLocaleString('it-IT', {
                style: 'currency',
                currency: 'EUR',
                minimumFractionDigits: 2,
              }),
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="py-2">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('refund_reason_placeholder')}
            disabled={pending}
            rows={3}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{tc('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending || reason.trim().length < 3}
            onClick={(e) => {
              e.preventDefault();
              void handleConfirm();
            }}
          >
            {pending ? tc('loading') : t('refund_confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ReportDialog({ callId }: { callId: string }) {
  const t = useTranslations('calls');
  const tc = useTranslations('common');
  const [open, setOpen] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [pending, setPending] = React.useState(false);

  function translateResult(result: ActionResult): ActionResult {
    if (result.ok) return result;
    const key = result.message as Parameters<typeof t>[0];
    const translated = t(key);
    return { ok: false, message: translated !== key ? translated : result.message };
  }

  async function handleConfirm() {
    if (message.trim().length < 3) return;
    setPending(true);
    try {
      const result = await reportCallIssueAction({ callId, message: message.trim() });
      toastResult(translateResult(result), t('report_success'));
      if (result.ok) {
        setOpen(false);
        setMessage('');
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          <AlertTriangle className="size-4" />
          {t('report_action')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('report_dialog_title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('report_dialog_description')}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="py-2">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t('report_message_placeholder')}
            disabled={pending}
            rows={4}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{tc('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending || message.trim().length < 3}
            onClick={(e) => {
              e.preventDefault();
              void handleConfirm();
            }}
          >
            {pending ? tc('loading') : t('report_confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

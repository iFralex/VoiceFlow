'use client';

import { ArrowLeft, Clock, Copy, Pause, Play, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import {
  cancelCampaignAction,
  duplicateCampaignAction,
  pauseCampaignAction,
  resumeCampaignAction,
} from '@/actions/campaigns';
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
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/status-badge';
import { toastResult } from '@/lib/utils/action-toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SerializedCampaignDetail {
  id: string;
  name: string;
  status: 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'cancelled';
  scriptId: string;
  scriptName: string;
  contactListId: string;
  contactListName: string;
  totalCalls: number;
  completedCalls: number;
  failedCalls: number;
  pendingCalls: number;
  dialingCalls: number;
  inProgressCalls: number;
  estimatedMaxCents: number | null;
  actualCents: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  scheduledAt: string | null;
  concurrencyLimit: number;
  timeWindowStart: string;
  timeWindowEnd: string;
  statsAppointmentBooked: number;
  statsInterested: number;
  statsTotalBilledSeconds: number;
  statsTotalCostCents: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('it-IT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  });
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

// ---------------------------------------------------------------------------
// Typed-name cancel confirmation dialog
// ---------------------------------------------------------------------------

/**
 * A destructive confirm dialog that requires the user to type the campaign name
 * before the confirm button is enabled. Used for the irreversible cancel action.
 */
function TypedCancelDialog({
  campaignName,
  trigger,
  onConfirm,
}: {
  campaignName: string;
  trigger: React.ReactNode;
  onConfirm: () => void | Promise<void>;
}) {
  const t = useTranslations('campaigns');
  const tc = useTranslations('common');
  const [open, setOpen] = React.useState(false);
  const [typedName, setTypedName] = React.useState('');
  const [pending, setPending] = React.useState(false);

  const isMatch = typedName.trim() === campaignName.trim();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setTypedName('');
  }

  async function handleConfirm() {
    if (!isMatch) return;
    setPending(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setPending(false);
      setTypedName('');
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('cancel_confirm_title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('cancel_confirm_desc')}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="py-2">
          <p className="mb-2 text-sm text-muted-foreground">
            {t('cancel_typed_confirm_hint')}
          </p>
          <Input
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            placeholder={campaignName}
            disabled={pending}
            autoComplete="off"
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{tc('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={!isMatch || pending}
            onClick={(e) => {
              e.preventDefault();
              void handleConfirm();
            }}
          >
            {pending ? tc('loading') : t('action_cancel')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------

function KpiCard({
  label,
  value,
  subtitle,
}: {
  label: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card p-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main client component
// ---------------------------------------------------------------------------

export function CampaignDetailClient({
  campaign,
}: {
  campaign: SerializedCampaignDetail;
}) {
  const t = useTranslations('campaigns');
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  const canPause = campaign.status === 'running';
  const canResume = campaign.status === 'paused';
  const canCancel =
    campaign.status === 'running' ||
    campaign.status === 'paused' ||
    campaign.status === 'scheduled';
  const canExport = campaign.status === 'completed';

  async function handlePause() {
    setPending(true);
    const result = await pauseCampaignAction({ campaignId: campaign.id });
    toastResult(result, t('pause_success'));
    setPending(false);
    if (result.ok) router.refresh();
  }

  async function handleResume() {
    setPending(true);
    const result = await resumeCampaignAction({ campaignId: campaign.id });
    toastResult(result, t('resume_success'));
    setPending(false);
    if (result.ok) router.refresh();
  }

  async function handleCancel() {
    setPending(true);
    const result = await cancelCampaignAction({ campaignId: campaign.id });
    toastResult(result, t('cancel_success'));
    setPending(false);
    if (result.ok) router.refresh();
  }

  async function handleDuplicate() {
    setPending(true);
    const result = await duplicateCampaignAction({ campaignId: campaign.id });
    toastResult(result, t('duplicate_success'));
    setPending(false);
    if (result.ok && 'campaignId' in result && result.campaignId) {
      router.push(`/campaigns/${result.campaignId}`);
    }
  }

  // Compute derived KPIs
  const completionRate =
    campaign.totalCalls > 0
      ? `${((campaign.completedCalls / campaign.totalCalls) * 100).toFixed(1)}%`
      : '—';

  const qualifiedLeads = campaign.statsInterested + campaign.statsAppointmentBooked;

  const avgDuration =
    campaign.completedCalls > 0 && campaign.statsTotalBilledSeconds > 0
      ? formatDuration(Math.round(campaign.statsTotalBilledSeconds / campaign.completedCalls))
      : '—';

  // Credit consumed: prefer aggregated stats, fall back to campaign.actual_cents
  const creditUsed =
    campaign.statsTotalCostCents > 0
      ? formatCents(campaign.statsTotalCostCents)
      : campaign.actualCents > 0
        ? formatCents(campaign.actualCents)
        : '—';

  // Status last change time
  const statusSinceIso =
    campaign.status === 'completed'
      ? (campaign.completedAt ?? campaign.updatedAt)
      : campaign.status === 'running'
        ? (campaign.startedAt ?? campaign.updatedAt)
        : campaign.updatedAt;

  return (
    <div className="space-y-6 p-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <Link
            href="/campaigns"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3" />
            {t('back_to_campaigns')}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{campaign.name}</h1>
          <div className="flex items-center gap-2">
            <StatusBadge status={campaign.status} />
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="size-3" />
              {t('detail_status_since', { date: formatDate(statusSinceIso) })}
            </span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {canPause && (
            <ConfirmDialog
              trigger={
                <Button variant="outline" size="sm" disabled={pending}>
                  <Pause className="mr-1 size-3" />
                  {t('action_pause')}
                </Button>
              }
              title={t('pause_confirm_title')}
              description={t('pause_confirm_desc')}
              confirmLabel={t('action_pause')}
              onConfirm={handlePause}
            />
          )}

          {canResume && (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => void handleResume()}
            >
              <Play className="mr-1 size-3" />
              {t('action_resume')}
            </Button>
          )}

          {canCancel && (
            <TypedCancelDialog
              campaignName={campaign.name}
              trigger={
                <Button variant="outline" size="sm" disabled={pending}>
                  <X className="mr-1 size-3" />
                  {t('action_cancel')}
                </Button>
              }
              onConfirm={handleCancel}
            />
          )}

          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => void handleDuplicate()}
          >
            <Copy className="mr-1 size-3" />
            {t('action_duplicate')}
          </Button>

          {canExport && (
            <Button variant="outline" size="sm" disabled>
              {t('action_export')}
            </Button>
          )}
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard
          label={t('detail_kpi_total')}
          value={campaign.totalCalls.toLocaleString('it-IT')}
        />
        <KpiCard
          label={t('detail_kpi_completed')}
          value={campaign.completedCalls.toLocaleString('it-IT')}
        />
        <KpiCard
          label={t('detail_kpi_failed')}
          value={campaign.failedCalls.toLocaleString('it-IT')}
        />
        <KpiCard label={t('detail_kpi_completion_rate')} value={completionRate} />
        <KpiCard
          label={t('detail_kpi_qualified_leads')}
          value={qualifiedLeads.toLocaleString('it-IT')}
        />
        <KpiCard
          label={t('detail_kpi_appointments')}
          value={campaign.statsAppointmentBooked.toLocaleString('it-IT')}
        />
        <KpiCard label={t('detail_kpi_credit_used')} value={creditUsed} />
        <KpiCard label={t('detail_kpi_avg_duration')} value={avgDuration} />
      </div>

      {/* Script and contact list refs + campaign settings */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Script */}
        <div className="rounded-lg border bg-card p-4">
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">
            {t('detail_script_label')}
          </h3>
          <Link
            href={`/scripts/${campaign.scriptId}`}
            className="font-medium text-foreground hover:underline"
          >
            {campaign.scriptName}
          </Link>
        </div>

        {/* Contact list */}
        <div className="rounded-lg border bg-card p-4">
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">
            {t('detail_list_label')}
          </h3>
          <Link
            href={`/contacts?list=${campaign.contactListId}`}
            className="font-medium text-foreground hover:underline"
          >
            {campaign.contactListName}
          </Link>
        </div>

        {/* Campaign settings */}
        <div className="rounded-lg border bg-card p-4">
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">
            {t('detail_settings_label')}
          </h3>
          <dl className="space-y-1 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">{t('detail_window_label')}</dt>
              <dd className="font-medium">
                {campaign.timeWindowStart}–{campaign.timeWindowEnd}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">{t('detail_concurrency_label')}</dt>
              <dd className="font-medium">{campaign.concurrencyLimit}</dd>
            </div>
            {campaign.scheduledAt && (
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">{t('detail_scheduled_label')}</dt>
                <dd className="font-medium">{formatDate(campaign.scheduledAt)}</dd>
              </div>
            )}
            {campaign.startedAt && (
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">{t('detail_started_label')}</dt>
                <dd className="font-medium">{formatDate(campaign.startedAt)}</dd>
              </div>
            )}
            {campaign.completedAt && (
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">{t('detail_completed_label')}</dt>
                <dd className="font-medium">{formatDate(campaign.completedAt)}</dd>
              </div>
            )}
            {campaign.estimatedMaxCents != null && (
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">{t('cost_max_label')}</dt>
                <dd className="font-medium">{formatCents(campaign.estimatedMaxCents)}</dd>
              </div>
            )}
          </dl>
        </div>
      </div>
    </div>
  );
}

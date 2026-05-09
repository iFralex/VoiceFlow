'use client';

import { ArrowLeft, Pause, Play, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import {
  cancelCampaignAction,
  pauseCampaignAction,
  resumeCampaignAction,
} from '@/actions/campaigns';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { StatusBadge } from '@/components/ui/status-badge';
import type { CallStatus, CampaignStatus } from '@/components/ui/status-badge';
import type { CampaignLiveSnapshot } from '@/lib/services/campaign-live';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import {
  subscribeToCalls,
  subscribeToCampaigns,
  type RealtimePayload,
  type RealtimeSubscribeStatus,
} from '@/lib/supabase/realtime';
import type { ActionResult } from '@/lib/utils/action-toast';
import { toastResult } from '@/lib/utils/action-toast';

import { LiveDuration } from './live-duration';
import {
  applyCall,
  callRecordFromRealtimeRow,
  initialStateFromSnapshot,
  sortCallsForDisplay,
  type CampaignLiveState,
} from './live-state';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('it-IT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  });
}

const NON_TERMINAL_STATUSES = new Set<CampaignStatus>([
  'draft',
  'scheduled',
  'running',
  'paused',
]);

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------

function LiveKpi({ label, value }: { label: string; value: string }) {
  return (
    <div
      data-slot="live-kpi"
      className="flex flex-col gap-1 rounded-lg border bg-card p-4"
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outcome chip helper
// ---------------------------------------------------------------------------

function OutcomeChip({ outcome }: { outcome: string | null }) {
  const t = useTranslations('campaigns');
  if (!outcome) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium">
      {t(`outcome_${outcome}`)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main client component
// ---------------------------------------------------------------------------

export interface CampaignLiveClientProps {
  orgId: string;
  campaignId: string;
  campaignName: string;
  initialStatus: CampaignStatus;
  initialSnapshot: CampaignLiveSnapshot;
}

export function CampaignLiveClient({
  orgId,
  campaignId,
  campaignName,
  initialStatus,
  initialSnapshot,
}: CampaignLiveClientProps) {
  const t = useTranslations('campaigns');
  const router = useRouter();

  const [state, setState] = React.useState<CampaignLiveState>(() =>
    initialStateFromSnapshot(initialSnapshot),
  );
  const [campaignStatus, setCampaignStatus] =
    React.useState<CampaignStatus>(initialStatus);
  const [pending, setPending] = React.useState(false);

  // ─── Realtime subscriptions ────────────────────────────────────────────────
  React.useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    const handleCallPayload = (payload: RealtimePayload) => {
      const eventType = payload.eventType;
      if (eventType !== 'INSERT' && eventType !== 'UPDATE') return;
      const row = payload.new;
      // Filter to this campaign — we subscribe by org_id, so ignore other campaigns.
      if (row['campaign_id'] !== campaignId) return;
      const next = callRecordFromRealtimeRow(row);
      setState((prev) => applyCall(prev, next, eventType));
    };

    const handleCampaignPayload = (payload: RealtimePayload) => {
      if (payload.eventType === 'DELETE') return;
      const row = payload.new;
      if (row['id'] !== campaignId) return;
      const status = row['status'] as CampaignStatus | undefined;
      if (status) setCampaignStatus(status);
    };

    // Reconnect-aware revalidate: if the channel ever drops, force a
    // server-side refresh once it's back so we recover any events missed
    // during the outage. We only fire on the recovery edge to avoid
    // refreshing on the very first SUBSCRIBED.
    let everDropped = false;
    const onStatus = (status: RealtimeSubscribeStatus) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        everDropped = true;
        return;
      }
      if (status === 'SUBSCRIBED' && everDropped) {
        everDropped = false;
        router.refresh();
      }
    };

    const unsubCalls = subscribeToCalls(supabase, orgId, handleCallPayload, {
      onStatus,
    });
    const unsubCampaigns = subscribeToCampaigns(
      supabase,
      orgId,
      handleCampaignPayload,
      { onStatus },
    );

    function handleOnline() {
      router.refresh();
    }
    window.addEventListener('online', handleOnline);

    return () => {
      unsubCalls();
      unsubCampaigns();
      window.removeEventListener('online', handleOnline);
    };
  }, [orgId, campaignId, router]);

  // ─── Derived UI data ───────────────────────────────────────────────────────
  const callsList = React.useMemo(
    () => sortCallsForDisplay(Object.values(state.callsById), 50),
    [state.callsById],
  );

  const completionPct =
    state.totalCalls > 0
      ? Math.min(100, Math.round((state.completedCalls / state.totalCalls) * 100))
      : 0;

  // ─── Action handlers ───────────────────────────────────────────────────────
  function translateResult(result: ActionResult): ActionResult {
    if (result.ok) return result;
    const key = result.message as Parameters<typeof t>[0];
    const translated = t(key);
    return { ok: false, message: translated !== key ? translated : result.message };
  }

  async function handlePause() {
    setPending(true);
    const result = await pauseCampaignAction({ campaignId });
    toastResult(translateResult(result), t('pause_success'));
    setPending(false);
    if (result.ok) router.refresh();
  }

  async function handleResume() {
    setPending(true);
    const result = await resumeCampaignAction({ campaignId });
    toastResult(translateResult(result), t('resume_success'));
    setPending(false);
    if (result.ok) router.refresh();
  }

  async function handleCancel() {
    setPending(true);
    const result = await cancelCampaignAction({ campaignId });
    toastResult(translateResult(result), t('cancel_success'));
    setPending(false);
    if (result.ok) router.refresh();
  }

  const canPause = campaignStatus === 'running';
  const canResume = campaignStatus === 'paused';
  const canCancel = NON_TERMINAL_STATUSES.has(campaignStatus);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <Link
            href={`/campaigns/${campaignId}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3" />
            {t('back_to_campaigns')}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{campaignName}</h1>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--status-success))]">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-current" />
              </span>
              {t('live_label')}
            </span>
            <StatusBadge status={campaignStatus} />
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
            <ConfirmDialog
              trigger={
                <Button variant="outline" size="sm" disabled={pending}>
                  <X className="mr-1 size-3" />
                  {t('action_cancel')}
                </Button>
              }
              title={t('cancel_confirm_title')}
              description={t('cancel_confirm_desc')}
              confirmLabel={t('action_cancel')}
              onConfirm={handleCancel}
            />
          )}
        </div>
      </div>

      {/* Live progress bar */}
      <div
        data-slot="live-progress"
        className="rounded-lg border bg-card p-4"
      >
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium">{t('live_progress_label')}</span>
          <span className="tabular-nums text-muted-foreground">
            {t('live_progress_count', {
              completed: state.completedCalls,
              total: state.totalCalls,
            })}
            {' · '}
            <span className="font-medium">{completionPct}%</span>
          </span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={completionPct}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full bg-primary transition-all duration-500"
            style={{ width: `${completionPct}%` }}
          />
        </div>
      </div>

      {/* Live KPIs */}
      <section
        aria-label={t('live_kpis_label')}
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <LiveKpi
          label={t('live_kpi_in_progress')}
          value={state.inProgressCalls.toLocaleString('it-IT')}
        />
        <LiveKpi
          label={t('live_kpi_completed')}
          value={state.completedCalls.toLocaleString('it-IT')}
        />
        <LiveKpi
          label={t('live_kpi_appointments')}
          value={state.appointmentsBooked.toLocaleString('it-IT')}
        />
        <LiveKpi
          label={t('live_kpi_cost')}
          value={formatCents(state.costCents)}
        />
      </section>

      {/* Calls list */}
      <section className="rounded-lg border bg-card">
        <header className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">{t('live_calls_title')}</h2>
        </header>
        {callsList.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t('live_calls_empty')}
          </p>
        ) : (
          <ul
            data-slot="live-calls-list"
            className="divide-y"
          >
            {callsList.map((c) => (
              <li
                key={c.id}
                data-slot="live-call-row"
                data-call-id={c.id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {c.contactName || '—'}
                  </p>
                  {c.phoneE164 && (
                    <p className="truncate text-xs text-muted-foreground">
                      {c.phoneE164}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <StatusBadge status={c.status as CallStatus} />
                  {(c.status === 'dialing' || c.status === 'in_progress') && (
                    <LiveDuration startedAtIso={c.startedAtIso} />
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <OutcomeChip outcome={c.outcome} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

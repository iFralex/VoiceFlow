'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';

import type { CampaignStatus } from '@/components/ui/status-badge';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import {
  subscribeToCampaignStats,
  subscribeToCampaigns,
  type RealtimePayload,
  type RealtimeSubscribeStatus,
} from '@/lib/supabase/realtime';

import { ActiveCampaigns, type ActiveCampaignRow } from './active-campaigns';

type Props = {
  orgId: string;
  initialCampaigns: ActiveCampaignRow[];
  className?: string;
};

const NON_TERMINAL_STATUSES = new Set<CampaignStatus>([
  'draft',
  'scheduled',
  'running',
  'paused',
]);

function applyStatsPayload(
  campaigns: ActiveCampaignRow[],
  payload: RealtimePayload,
): ActiveCampaignRow[] {
  if (payload.eventType === 'DELETE') return campaigns;
  const row = payload.new;
  const campaignId = row['campaign_id'];
  if (typeof campaignId !== 'string') return campaigns;

  const idx = campaigns.findIndex((c) => c.id === campaignId);
  if (idx === -1) return campaigns;

  const total = typeof row['total_calls'] === 'number' ? row['total_calls'] : campaigns[idx]!.total;
  const completed =
    typeof row['completed_calls'] === 'number'
      ? row['completed_calls']
      : campaigns[idx]!.completed;
  const appointments =
    typeof row['outcome_appointment_booked'] === 'number'
      ? row['outcome_appointment_booked']
      : campaigns[idx]!.appointmentsBooked;

  const next = campaigns.slice();
  next[idx] = {
    ...campaigns[idx]!,
    total,
    completed,
    appointmentsBooked: appointments,
  };
  return next;
}

function applyCampaignPayload(
  campaigns: ActiveCampaignRow[],
  payload: RealtimePayload,
): ActiveCampaignRow[] {
  if (payload.eventType === 'DELETE') return campaigns;
  const row = payload.new;
  const id = row['id'];
  if (typeof id !== 'string') return campaigns;

  const idx = campaigns.findIndex((c) => c.id === id);
  if (idx === -1) return campaigns;

  const status = row['status'] as CampaignStatus | undefined;
  if (!status) return campaigns;

  // Drop terminal campaigns from the active list to keep the row tidy.
  if (!NON_TERMINAL_STATUSES.has(status)) {
    return campaigns.filter((c) => c.id !== id);
  }

  const next = campaigns.slice();
  next[idx] = { ...campaigns[idx]!, status };
  return next;
}

/**
 * Re-renders only the dashboard active-campaigns row when `campaign_stats`
 * Realtime updates arrive — avoiding a full-page revalidation cost. On
 * reconnect after a network drop the parent route is revalidated server-side
 * via `router.refresh()` to catch any events missed while disconnected.
 */
export function ActiveCampaignsLive({ orgId, initialCampaigns, className }: Props) {
  const router = useRouter();
  const [campaigns, setCampaigns] =
    React.useState<ActiveCampaignRow[]>(initialCampaigns);
  // Reset the in-memory realtime patches when the server sends a fresh
  // snapshot — e.g. after `router.refresh()` recovers from a reconnect, or
  // when the dashboard period changes. Pattern: derive state from props by
  // comparing the previous prop during render. See:
  // https://react.dev/learn/you-might-not-need-an-effect#resetting-all-state-when-a-prop-changes
  const [lastInitial, setLastInitial] = React.useState(initialCampaigns);
  if (lastInitial !== initialCampaigns) {
    setLastInitial(initialCampaigns);
    setCampaigns(initialCampaigns);
  }

  React.useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    // Track whether the channel previously dropped so we only revalidate on
    // the recovery edge — not on the initial SUBSCRIBED event.
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

    const unsubStats = subscribeToCampaignStats(
      supabase,
      orgId,
      (payload) => {
        setCampaigns((prev) => applyStatsPayload(prev, payload));
      },
      { onStatus },
    );

    const unsubCampaigns = subscribeToCampaigns(
      supabase,
      orgId,
      (payload) => {
        setCampaigns((prev) => applyCampaignPayload(prev, payload));
      },
      { onStatus },
    );

    // Browsers fire `online` after a network drop; force a server-side
    // revalidate as belt-and-braces in case the channel never re-emits a
    // status change before the user looks at the page.
    function handleOnline() {
      router.refresh();
    }
    window.addEventListener('online', handleOnline);

    return () => {
      unsubStats();
      unsubCampaigns();
      window.removeEventListener('online', handleOnline);
    };
  }, [orgId, router]);

  return (
    <ActiveCampaigns
      campaigns={campaigns}
      {...(className ? { className } : {})}
    />
  );
}

// Exported for tests
export const __test__ = { applyStatsPayload, applyCampaignPayload };

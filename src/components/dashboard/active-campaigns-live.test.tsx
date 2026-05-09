import { act, cleanup, render, screen } from '@testing-library/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  RealtimePayload,
  RealtimeSubscribeStatus,
  SubscribeOptions,
} from '@/lib/supabase/realtime';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: refreshMock,
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock('@/lib/supabase/browser', () => ({
  getSupabaseBrowserClient: () => ({}),
}));

type Capture = {
  emit: (payload: RealtimePayload) => void;
  setStatus: (status: RealtimeSubscribeStatus) => void;
};

const captures: Record<'campaign_stats' | 'campaigns', Capture | null> = {
  campaign_stats: null,
  campaigns: null,
};

function makeCapture(
  table: 'campaign_stats' | 'campaigns',
  onPayload: (payload: RealtimePayload) => void,
  options: SubscribeOptions,
): () => void {
  captures[table] = {
    emit: onPayload,
    setStatus: (status) => options.onStatus?.(status),
  };
  return () => {
    captures[table] = null;
  };
}

vi.mock('@/lib/supabase/realtime', () => ({
  subscribeToCampaignStats: vi.fn(
    (
      _supabase: unknown,
      _orgId: string,
      onPayload: (payload: RealtimePayload) => void,
      options: SubscribeOptions = {},
    ) => makeCapture('campaign_stats', onPayload, options),
  ),
  subscribeToCampaigns: vi.fn(
    (
      _supabase: unknown,
      _orgId: string,
      onPayload: (payload: RealtimePayload) => void,
      options: SubscribeOptions = {},
    ) => makeCapture('campaigns', onPayload, options),
  ),
}));

// Import after mocks so the module picks them up.
import {
  ActiveCampaignsLive,
  __test__,
} from './active-campaigns-live';

// ─── Test data ────────────────────────────────────────────────────────────────

const baseCampaign = {
  id: 'camp-1',
  name: 'Riattivazione Lead',
  status: 'running' as const,
  total: 100,
  completed: 25,
  appointmentsBooked: 3,
};

afterEach(() => {
  cleanup();
  refreshMock.mockClear();
  captures.campaign_stats = null;
  captures.campaigns = null;
});

beforeEach(() => {
  refreshMock.mockClear();
});

// ─── Reducer tests ────────────────────────────────────────────────────────────

describe('applyStatsPayload', () => {
  it('updates total/completed/appointment counters from a campaign_stats UPDATE', () => {
    const initial = [baseCampaign];
    const next = __test__.applyStatsPayload(initial, {
      eventType: 'UPDATE',
      new: {
        campaign_id: 'camp-1',
        total_calls: 100,
        completed_calls: 30,
        outcome_appointment_booked: 5,
      },
      old: {},
      schema: 'public',
      table: 'campaign_stats',
      commit_timestamp: '',
    });
    expect(next[0]).toMatchObject({ completed: 30, appointmentsBooked: 5 });
  });

  it('ignores updates for campaigns that are not in the active list', () => {
    const initial = [baseCampaign];
    const next = __test__.applyStatsPayload(initial, {
      eventType: 'UPDATE',
      new: {
        campaign_id: 'other-campaign',
        completed_calls: 99,
      },
      old: {},
      schema: 'public',
      table: 'campaign_stats',
      commit_timestamp: '',
    });
    expect(next).toBe(initial);
  });

  it('returns the same array reference on DELETE', () => {
    const initial = [baseCampaign];
    const next = __test__.applyStatsPayload(initial, {
      eventType: 'DELETE',
      new: {},
      old: { campaign_id: 'camp-1' },
      schema: 'public',
      table: 'campaign_stats',
      commit_timestamp: '',
    });
    expect(next).toBe(initial);
  });
});

describe('applyCampaignPayload', () => {
  it('updates the campaign status', () => {
    const initial = [baseCampaign];
    const next = __test__.applyCampaignPayload(initial, {
      eventType: 'UPDATE',
      new: { id: 'camp-1', status: 'paused' },
      old: {},
      schema: 'public',
      table: 'campaigns',
      commit_timestamp: '',
    });
    expect(next[0]?.status).toBe('paused');
  });

  it('drops campaigns that transitioned to a terminal state', () => {
    const initial = [baseCampaign, { ...baseCampaign, id: 'camp-2' }];
    const next = __test__.applyCampaignPayload(initial, {
      eventType: 'UPDATE',
      new: { id: 'camp-1', status: 'completed' },
      old: {},
      schema: 'public',
      table: 'campaigns',
      commit_timestamp: '',
    });
    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe('camp-2');
  });

  it('ignores rows whose id is not in the active list', () => {
    const initial = [baseCampaign];
    const next = __test__.applyCampaignPayload(initial, {
      eventType: 'UPDATE',
      new: { id: 'unknown', status: 'paused' },
      old: {},
      schema: 'public',
      table: 'campaigns',
      commit_timestamp: '',
    });
    expect(next).toBe(initial);
  });
});

// ─── Component integration tests ──────────────────────────────────────────────

describe('ActiveCampaignsLive', () => {
  it('renders the initial campaigns', () => {
    render(
      <ActiveCampaignsLive orgId="org-1" initialCampaigns={[baseCampaign]} />,
    );
    expect(screen.getByText('Riattivazione Lead')).toBeInTheDocument();
    // 25 of 100 = 25%
    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('updates the progress bar when a campaign_stats payload arrives', () => {
    render(
      <ActiveCampaignsLive orgId="org-1" initialCampaigns={[baseCampaign]} />,
    );

    expect(captures.campaign_stats).not.toBeNull();
    act(() => {
      captures.campaign_stats!.emit({
        eventType: 'UPDATE',
        new: {
          campaign_id: 'camp-1',
          total_calls: 100,
          completed_calls: 50,
          outcome_appointment_booked: 7,
        },
        old: {},
        schema: 'public',
        table: 'campaign_stats',
        commit_timestamp: '',
      });
    });

    // 50 / 100 = 50%
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('does NOT call router.refresh on the initial SUBSCRIBED status', () => {
    render(
      <ActiveCampaignsLive orgId="org-1" initialCampaigns={[baseCampaign]} />,
    );
    act(() => {
      captures.campaign_stats!.setStatus('SUBSCRIBED');
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('forces a server-side revalidate after the channel reconnects', () => {
    render(
      <ActiveCampaignsLive orgId="org-1" initialCampaigns={[baseCampaign]} />,
    );

    // Channel drops, then recovers.
    act(() => {
      captures.campaign_stats!.setStatus('CHANNEL_ERROR');
    });
    expect(refreshMock).not.toHaveBeenCalled();

    act(() => {
      captures.campaign_stats!.setStatus('SUBSCRIBED');
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('calls router.refresh when the browser fires the online event', () => {
    render(
      <ActiveCampaignsLive orgId="org-1" initialCampaigns={[baseCampaign]} />,
    );
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('drops a campaign whose status flips to terminal', () => {
    render(
      <ActiveCampaignsLive orgId="org-1" initialCampaigns={[baseCampaign]} />,
    );
    act(() => {
      captures.campaigns!.emit({
        eventType: 'UPDATE',
        new: { id: 'camp-1', status: 'completed' },
        old: {},
        schema: 'public',
        table: 'campaigns',
        commit_timestamp: '',
      });
    });
    expect(screen.queryByText('Riattivazione Lead')).not.toBeInTheDocument();
    expect(screen.getByText('Nessuna campagna in esecuzione')).toBeInTheDocument();
  });
});

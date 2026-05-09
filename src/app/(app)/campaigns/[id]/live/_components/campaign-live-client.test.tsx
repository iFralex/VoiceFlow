import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/lib/supabase/browser', () => ({
  getSupabaseBrowserClient: () => ({
    channel: () => ({
      on: function () { return this; },
      subscribe: function () { return this; },
    }),
    removeChannel: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/lib/supabase/realtime', () => ({
  subscribeToCalls: vi.fn(() => () => undefined),
  subscribeToCampaigns: vi.fn(() => () => undefined),
}));

vi.mock('@/actions/campaigns', () => ({
  pauseCampaignAction: vi.fn(),
  resumeCampaignAction: vi.fn(),
  cancelCampaignAction: vi.fn(),
}));

import { CampaignLiveClient } from './campaign-live-client';

afterEach(cleanup);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-09T10:00:30Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

const baseProps = {
  orgId: 'org-1',
  campaignId: 'camp-1',
  campaignName: 'Riattivazione Lead',
  initialStatus: 'running' as const,
  initialSnapshot: {
    totalCalls: 100,
    completedCalls: 25,
    inProgressCalls: 5,
    appointmentsBooked: 3,
    costCents: 1234,
    recentCalls: [
      {
        id: 'call-active',
        contactName: 'Mario Rossi',
        phoneE164: '+393331234567',
        status: 'in_progress' as const,
        outcome: null,
        startedAtIso: '2026-05-09T10:00:00.000Z',
        endedAtIso: null,
        costCents: null,
        billableSeconds: null,
      },
      {
        id: 'call-done',
        contactName: 'Luca Bianchi',
        phoneE164: '+393339999999',
        status: 'completed' as const,
        outcome: 'appointment_booked' as const,
        startedAtIso: '2026-05-09T09:00:00.000Z',
        endedAtIso: '2026-05-09T09:02:00.000Z',
        costCents: 50,
        billableSeconds: 120,
      },
    ],
  },
};

describe('CampaignLiveClient', () => {
  it('renders the campaign name and live indicator', () => {
    render(<CampaignLiveClient {...baseProps} />);
    expect(screen.getByText('Riattivazione Lead')).toBeInTheDocument();
    expect(screen.getByText('In diretta')).toBeInTheDocument();
  });

  it('shows progress bar with completed/total percentage', () => {
    const { container } = render(<CampaignLiveClient {...baseProps} />);
    const bar = container.querySelector('[role="progressbar"]')!;
    // 25 / 100 = 25%
    expect(bar.getAttribute('aria-valuenow')).toBe('25');
    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('renders all four KPIs from initial snapshot', () => {
    const { container } = render(<CampaignLiveClient {...baseProps} />);
    const kpis = container.querySelectorAll('[data-slot="live-kpi"]');
    expect(kpis).toHaveLength(4);
    // values: 5 in-progress, 25 completed, 3 appointments, €12.34 cost
    const values = Array.from(kpis).map((k) =>
      k.querySelector('span:last-child')?.textContent,
    );
    expect(values).toContain('5');
    expect(values).toContain('25');
    expect(values).toContain('3');
    expect(values?.some((v) => v?.includes('12,34') || v?.includes('12.34'))).toBe(true);
  });

  it('renders one row per recent call with the contact name', () => {
    const { container } = render(<CampaignLiveClient {...baseProps} />);
    const rows = container.querySelectorAll('[data-slot="live-call-row"]');
    expect(rows).toHaveLength(2);
    expect(screen.getByText('Mario Rossi')).toBeInTheDocument();
    expect(screen.getByText('Luca Bianchi')).toBeInTheDocument();
  });

  it('shows pause button when campaign is running', () => {
    render(<CampaignLiveClient {...baseProps} />);
    expect(screen.getByText('Metti in pausa')).toBeInTheDocument();
  });

  it('shows resume button when campaign is paused', () => {
    render(<CampaignLiveClient {...baseProps} initialStatus="paused" />);
    expect(screen.getByText('Riprendi')).toBeInTheDocument();
    expect(screen.queryByText('Metti in pausa')).not.toBeInTheDocument();
  });

  it('hides controls when campaign is in a terminal state', () => {
    render(<CampaignLiveClient {...baseProps} initialStatus="completed" />);
    expect(screen.queryByText('Metti in pausa')).not.toBeInTheDocument();
    expect(screen.queryByText('Riprendi')).not.toBeInTheDocument();
    expect(screen.queryByText('Annulla campagna')).not.toBeInTheDocument();
  });

  it('renders the empty-state message when there are no recent calls', () => {
    render(
      <CampaignLiveClient
        {...baseProps}
        initialSnapshot={{
          ...baseProps.initialSnapshot,
          recentCalls: [],
          totalCalls: 0,
          completedCalls: 0,
          inProgressCalls: 0,
        }}
      />,
    );
    expect(screen.getByText('Nessuna chiamata ancora avviata.')).toBeInTheDocument();
  });
});

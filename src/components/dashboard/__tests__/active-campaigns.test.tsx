import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ActiveCampaigns } from '@/components/dashboard/active-campaigns';

afterEach(cleanup);

describe('ActiveCampaigns', () => {
  it('shows empty message when no campaigns', () => {
    render(<ActiveCampaigns campaigns={[]} />);
    expect(screen.getByText('Nessuna campagna in esecuzione')).toBeInTheDocument();
  });

  it('renders one row per campaign with a progress bar', () => {
    const { container } = render(
      <ActiveCampaigns
        campaigns={[
          {
            id: 'c1',
            name: 'Riattivazione Lead',
            status: 'running',
            total: 100,
            completed: 25,
            appointmentsBooked: 5,
          },
          {
            id: 'c2',
            name: 'Conferma Appuntamenti',
            status: 'paused',
            total: 200,
            completed: 50,
            appointmentsBooked: 10,
          },
        ]}
      />,
    );
    const rows = container.querySelectorAll('[data-slot="active-campaign-row"]');
    expect(rows.length).toBe(2);
    const bars = container.querySelectorAll('[role="progressbar"]');
    expect(bars.length).toBe(2);
    expect(bars[0]!.getAttribute('aria-valuenow')).toBe('25');
    expect(bars[1]!.getAttribute('aria-valuenow')).toBe('25'); // 50/200
  });

  it('handles zero-total campaigns without divide-by-zero', () => {
    const { container } = render(
      <ActiveCampaigns
        campaigns={[
          {
            id: 'c1',
            name: 'Empty',
            status: 'running',
            total: 0,
            completed: 0,
            appointmentsBooked: 0,
          },
        ]}
      />,
    );
    const bar = container.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
  });
});

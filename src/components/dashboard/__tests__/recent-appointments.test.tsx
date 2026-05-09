import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { RecentAppointments } from '@/components/dashboard/recent-appointments';

afterEach(cleanup);

describe('RecentAppointments', () => {
  it('shows empty message when no appointments', () => {
    render(<RecentAppointments appointments={[]} />);
    expect(screen.getByText('Ancora nessun appuntamento')).toBeInTheDocument();
  });

  it('renders one row per appointment with contact name + campaign link', () => {
    const { container } = render(
      <RecentAppointments
        appointments={[
          {
            id: 'a1',
            contactName: 'Mario Rossi',
            scheduledAt: '2026-05-20T09:30:00.000Z',
            campaignName: 'Riattivazione Lead',
            campaignId: 'c1',
          },
        ]}
      />,
    );
    expect(screen.getByText('Mario Rossi')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Riattivazione Lead' });
    expect(link).toHaveAttribute('href', '/campaigns/c1');
    const time = container.querySelector('time');
    expect(time?.getAttribute('datetime')).toBe('2026-05-20T09:30:00.000Z');
  });
});

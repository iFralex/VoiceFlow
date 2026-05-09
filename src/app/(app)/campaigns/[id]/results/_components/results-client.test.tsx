import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockSearchParams = { toString: () => '' };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, refresh: vi.fn() }),
  useSearchParams: () => mockSearchParams,
}));

import type { CampaignResultRow } from '@/lib/services/campaign-results';

import { CampaignResultsClient } from './results-client';

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
});

const sampleRows: CampaignResultRow[] = [
  {
    id: 'call-1',
    contactId: 'contact-1',
    contactName: 'Mario Rossi',
    phoneE164: '+393331234567',
    status: 'completed',
    outcome: 'appointment_booked',
    billableSeconds: 120,
    costCents: 50,
    startedAtIso: '2026-05-09T10:00:00.000Z',
    endedAtIso: '2026-05-09T10:02:00.000Z',
    createdAtIso: '2026-05-09T09:59:00.000Z',
  },
  {
    id: 'call-2',
    contactId: 'contact-2',
    contactName: 'Luca Bianchi',
    phoneE164: '+393339999999',
    status: 'no_answer',
    outcome: null,
    billableSeconds: null,
    costCents: null,
    startedAtIso: null,
    endedAtIso: null,
    createdAtIso: '2026-05-09T09:00:00.000Z',
  },
];

const baseProps = {
  campaignId: 'camp-1',
  campaignName: 'Riattivazione Lead',
  rows: sampleRows,
  total: 2,
  page: 0,
  pageSize: 20,
  sort: 'started_desc' as const,
  outcomes: [],
  durationMinSeconds: null,
  durationMaxSeconds: null,
  dateFrom: null,
  dateTo: null,
};

describe('CampaignResultsClient', () => {
  it('renders the campaign name and rows', () => {
    render(<CampaignResultsClient {...baseProps} />);
    expect(screen.getByText('Riattivazione Lead')).toBeInTheDocument();
    expect(screen.getByText('Mario Rossi')).toBeInTheDocument();
    expect(screen.getByText('Luca Bianchi')).toBeInTheDocument();
  });

  it('renders outcome badges for completed calls', () => {
    render(<CampaignResultsClient {...baseProps} />);
    // appointment_booked outcome label
    expect(screen.getByText('Appuntamento fissato')).toBeInTheDocument();
  });

  it('shows the empty state when there are no rows', () => {
    render(<CampaignResultsClient {...baseProps} rows={[]} total={0} />);
    expect(screen.getByText('Nessuna chiamata registrata.')).toBeInTheDocument();
  });

  it('shows the filtered empty state when filters are active and result is empty', () => {
    render(
      <CampaignResultsClient
        {...baseProps}
        rows={[]}
        total={0}
        outcomes={['appointment_booked']}
      />,
    );
    expect(screen.getByText('Nessuna chiamata corrisponde ai filtri.')).toBeInTheDocument();
  });

  it('renders detail links pointing to /calls/[id]', () => {
    render(<CampaignResultsClient {...baseProps} />);
    const links = screen.getAllByText('Dettaglio');
    expect(links[0]?.closest('a')).toHaveAttribute('href', '/calls/call-1');
    expect(links[1]?.closest('a')).toHaveAttribute('href', '/calls/call-2');
  });

  it('renders status badges for each row', () => {
    render(<CampaignResultsClient {...baseProps} />);
    const badges = document.querySelectorAll('[data-slot="status-badge"]');
    expect(badges.length).toBeGreaterThanOrEqual(2);
  });

  it('navigates to the next page when the next button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <CampaignResultsClient
        {...baseProps}
        total={50}
        rows={sampleRows}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Pagina successiva' }));
    expect(mockPush).toHaveBeenCalled();
    const url = mockPush.mock.calls[0]?.[0] as string;
    expect(url).toContain('/campaigns/camp-1/results');
    expect(url).toContain('page=1');
  });

  it('disables the previous button on page 0', () => {
    render(<CampaignResultsClient {...baseProps} total={50} />);
    expect(screen.getByRole('button', { name: 'Pagina precedente' })).toBeDisabled();
  });

  it('shows clear-filters button only when a filter is active', () => {
    const { rerender } = render(<CampaignResultsClient {...baseProps} />);
    expect(screen.queryByText('Pulisci filtri')).not.toBeInTheDocument();

    rerender(
      <CampaignResultsClient {...baseProps} outcomes={['appointment_booked']} />,
    );
    expect(screen.getByText('Pulisci filtri')).toBeInTheDocument();
  });

  it('updates URL with selected outcome when toggled', async () => {
    const user = userEvent.setup();
    render(<CampaignResultsClient {...baseProps} />);

    // Open the outcome dropdown
    await user.click(screen.getByRole('button', { name: /Esito/ }));

    // Select 'Appuntamento fissato' inside the menu
    const menuItem = await screen.findByRole('menuitemcheckbox', {
      name: 'Appuntamento fissato',
    });
    await user.click(menuItem);

    expect(mockPush).toHaveBeenCalled();
    const url = mockPush.mock.calls[0]?.[0] as string;
    expect(url).toContain('outcome=appointment_booked');
    expect(url).toContain('page=0');
  });
});

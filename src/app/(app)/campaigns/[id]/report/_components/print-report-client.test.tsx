import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PrintReportClient, type PrintReportClientProps } from './print-report-client';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(cleanup);

function makeProps(overrides: Partial<PrintReportClientProps> = {}): PrintReportClientProps {
  return {
    campaign: {
      id: 'camp-1',
      name: 'Riattivazione Lead',
      status: 'completed',
      scriptName: 'Lead reactivation',
      createdAtIso: '2026-05-01T08:00:00.000Z',
      startedAtIso: '2026-05-01T09:00:00.000Z',
      completedAtIso: '2026-05-01T17:30:00.000Z',
    },
    totals: {
      totalCalls: 100,
      completedCalls: 80,
      failedCalls: 5,
      qualifiedLeads: 30,
      appointmentsBooked: 12,
      totalBilledSeconds: 6400,
      totalCostCents: 4800,
      durationFormatted: '1m 20s',
    },
    outcomes: {
      appointmentBooked: 12,
      interested: 18,
      notInterested: 30,
      callback: 6,
      voicemail: 4,
      wrongNumber: 2,
      doNotCall: 1,
    },
    topAppointments: [
      {
        id: 'a-1',
        contactName: 'Anna Bianchi',
        phoneE164: '+393331111111',
        scheduledAtIso: '2026-05-15T14:00:00.000Z',
        notes: 'Mattina',
      },
    ],
    showFullPhones: false,
    generatedAtIso: '2026-05-09T18:00:00.000Z',
    ...overrides,
  };
}

describe('PrintReportClient', () => {
  it('renders campaign header, summary cells, outcome bars, and appointment row', () => {
    render(<PrintReportClient {...makeProps()} />);

    expect(screen.getByRole('heading', { level: 1, name: /Riattivazione Lead/ })).toBeInTheDocument();
    expect(screen.getByText(/Riepilogo/)).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument(); // total calls
    expect(screen.getByText('80')).toBeInTheDocument(); // completed
    expect(screen.getByText('Anna Bianchi')).toBeInTheDocument();

    // Outcome bars are rendered as progressbars
    const bars = screen.getAllByRole('progressbar');
    expect(bars.length).toBeGreaterThanOrEqual(7);
  });

  it('masks phone numbers to last 4 digits by default', () => {
    render(<PrintReportClient {...makeProps()} />);
    expect(screen.getByText('••• 1111')).toBeInTheDocument();
    expect(screen.queryByText('+393331111111')).not.toBeInTheDocument();
    expect(
      screen.getByText(/I numeri sono mascherati: visibili solo le ultime 4 cifre/),
    ).toBeInTheDocument();
  });

  it('shows full phone numbers when showFullPhones is true', () => {
    render(<PrintReportClient {...makeProps({ showFullPhones: true })} />);
    expect(screen.getByText('+393331111111')).toBeInTheDocument();
    expect(screen.queryByText('••• 1111')).not.toBeInTheDocument();
    expect(screen.getByText(/I numeri sono mostrati per intero/)).toBeInTheDocument();
  });

  it('renders the empty-outcomes message when all counts are zero', () => {
    render(
      <PrintReportClient
        {...makeProps({
          outcomes: {
            appointmentBooked: 0,
            interested: 0,
            notInterested: 0,
            callback: 0,
            voicemail: 0,
            wrongNumber: 0,
            doNotCall: 0,
          },
        })}
      />,
    );
    expect(screen.getByText(/Nessun esito ancora registrato/)).toBeInTheDocument();
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
  });

  it('renders the empty-appointments message when none are present', () => {
    render(<PrintReportClient {...makeProps({ topAppointments: [] })} />);
    expect(screen.getByText(/Nessun appuntamento fissato/)).toBeInTheDocument();
  });
});

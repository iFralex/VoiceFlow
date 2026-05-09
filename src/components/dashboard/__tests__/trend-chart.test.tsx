import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { TrendPoint } from '@/components/dashboard/trend-chart';
import { TrendChart } from '@/components/dashboard/trend-chart';

afterEach(cleanup);

const sampleData: TrendPoint[] = [
  {
    date: '2026-05-01',
    completed: 5,
    appointmentBooked: 2,
    notInterested: 3,
    voicemail: 1,
    failed: 0,
  },
  {
    date: '2026-05-02',
    completed: 7,
    appointmentBooked: 4,
    notInterested: 2,
    voicemail: 0,
    failed: 1,
  },
];

describe('TrendChart', () => {
  it('renders empty state when no data', () => {
    render(<TrendChart data={[]} />);
    expect(screen.getByText('Nessuna chiamata nel periodo selezionato')).toBeInTheDocument();
  });

  it('renders one bar group per data point', () => {
    const { container } = render(<TrendChart data={sampleData} />);
    const bars = container.querySelectorAll('[data-slot="trend-bar"]');
    expect(bars.length).toBe(2);
  });

  it('renders only segments with non-zero values', () => {
    const { container } = render(<TrendChart data={sampleData} />);
    const day1 = container.querySelector('[data-slot="trend-bar"][data-date="2026-05-01"]')!;
    const segments = day1.querySelectorAll('[data-slot="trend-segment"]');
    // day 1 has 4 non-zero segments (completed, appointmentBooked, notInterested, voicemail)
    expect(segments.length).toBe(4);
  });

  it('renders the chart title and legend', () => {
    render(<TrendChart data={sampleData} />);
    expect(screen.getByText('Chiamate per giorno per esito')).toBeInTheDocument();
    expect(screen.getByText('Appuntamento')).toBeInTheDocument();
    expect(screen.getByText('Completata')).toBeInTheDocument();
  });
});

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { KpiCard } from '@/components/dashboard/kpi-card';

afterEach(cleanup);

describe('KpiCard', () => {
  it('renders label and value', () => {
    render(<KpiCard label="Chiamate completate" value="42" />);
    expect(screen.getByText('Chiamate completate')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders the optional hint', () => {
    render(<KpiCard label="X" value="0" hint="Trend ultimi 14 giorni" />);
    expect(screen.getByText('Trend ultimi 14 giorni')).toBeInTheDocument();
  });

  it('renders a sparkline when trend is provided', () => {
    const { container } = render(
      <KpiCard label="X" value="0" trend={[1, 2, 3]} trendLabel="trend" />,
    );
    expect(container.querySelector('svg[data-slot="sparkline"]')).not.toBeNull();
  });

  it('omits the sparkline when no trend is provided', () => {
    const { container } = render(<KpiCard label="X" value="0" />);
    expect(container.querySelector('svg[data-slot="sparkline"]')).toBeNull();
  });
});

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AlertsList } from '@/components/dashboard/alerts-list';

afterEach(cleanup);

describe('AlertsList', () => {
  it('shows empty message when no alerts', () => {
    render(<AlertsList alerts={[]} />);
    expect(screen.getByText('Tutto in ordine')).toBeInTheDocument();
  });

  it('renders a low-credit alert with minutes interpolated', () => {
    render(
      <AlertsList alerts={[{ id: '1', kind: 'low_credit', balanceMinutes: 12 }]} />,
    );
    expect(
      screen.getByText('Credito basso: solo 12 minuti rimanenti'),
    ).toBeInTheDocument();
  });

  it('renders a CLI cooldown alert', () => {
    render(
      <AlertsList alerts={[{ id: '2', kind: 'cli_cooldown', count: 3 }]} />,
    );
    expect(screen.getByText('3 numeri in cooldown')).toBeInTheDocument();
  });

  it('renders a disclosure-failure alert with danger severity', () => {
    const { container } = render(
      <AlertsList
        alerts={[{ id: '3', kind: 'disclosure_failure', count: 2 }]}
      />,
    );
    const row = container.querySelector('[data-slot="alert-row"]')!;
    expect(row.getAttribute('data-severity')).toBe('danger');
    expect(
      screen.getByText('2 chiamate con problemi di disclosure AI Act'),
    ).toBeInTheDocument();
  });
});

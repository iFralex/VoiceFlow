import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EmptyState } from '@/components/ui/empty-state';

afterEach(cleanup);

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState title="Nessun risultato" />);
    expect(screen.getByText('Nessun risultato')).toBeInTheDocument();
  });

  it('renders an optional description', () => {
    render(<EmptyState title="Nessun risultato" description="Nessun dato da mostrare." />);
    expect(screen.getByText('Nessun dato da mostrare.')).toBeInTheDocument();
  });

  it('renders without description when omitted', () => {
    render(<EmptyState title="Nessun risultato" />);
    expect(screen.queryByText('Nessun dato da mostrare.')).not.toBeInTheDocument();
  });

  it('renders an action button with onClick', () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        title="Nessun risultato"
        action={{ label: 'Aggiungi contatto', onClick }}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Aggiungi contatto' });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders an action link when href is provided', () => {
    render(
      <EmptyState
        title="Nessun risultato"
        action={{ label: 'Vai alle campagne', href: '/campaigns' }}
      />,
    );
    const link = screen.getByRole('link', { name: 'Vai alle campagne' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/campaigns');
  });

  it('renders the illustration slot', () => {
    render(
      <EmptyState
        title="Nessun risultato"
        illustration={<svg data-testid="illustration" />}
      />,
    );
    expect(screen.getByTestId('illustration')).toBeInTheDocument();
  });

  it('does not render illustration slot when omitted', () => {
    const { container } = render(<EmptyState title="Nessun risultato" />);
    expect(container.querySelector('[data-slot="empty-state-illustration"]')).not.toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <EmptyState title="Nessun risultato" className="custom-class" />,
    );
    expect(container.querySelector('[data-slot="empty-state"]')).toHaveClass('custom-class');
  });

  it('renders without action when omitted', () => {
    render(<EmptyState title="Nessun risultato" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

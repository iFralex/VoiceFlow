import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { STATUS_MAP, StatusBadge } from '@/components/ui/status-badge';

afterEach(cleanup);

describe('StatusBadge', () => {
  describe('campaign statuses', () => {
    it('renders draft', () => {
      const { container } = render(<StatusBadge status="draft" />);
      const badge = container.querySelector('[data-status="draft"]')!;
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('Bozza');
    });

    it('renders scheduled', () => {
      const { container } = render(<StatusBadge status="scheduled" />);
      expect(container.querySelector('[data-status="scheduled"]')).toHaveTextContent('Pianificata');
    });

    it('renders running', () => {
      const { container } = render(<StatusBadge status="running" />);
      expect(container.querySelector('[data-status="running"]')).toHaveTextContent('In corso');
    });

    it('renders paused', () => {
      const { container } = render(<StatusBadge status="paused" />);
      expect(container.querySelector('[data-status="paused"]')).toHaveTextContent('In pausa');
    });

    it('renders completed', () => {
      const { container } = render(<StatusBadge status="completed" />);
      expect(container.querySelector('[data-status="completed"]')).toHaveTextContent('Completata');
    });

    it('renders cancelled', () => {
      const { container } = render(<StatusBadge status="cancelled" />);
      expect(container.querySelector('[data-status="cancelled"]')).toHaveTextContent('Annullata');
    });

    it('renders error', () => {
      const { container } = render(<StatusBadge status="error" />);
      expect(container.querySelector('[data-status="error"]')).toHaveTextContent('Errore');
    });
  });

  describe('call statuses', () => {
    it('renders pending', () => {
      const { container } = render(<StatusBadge status="pending" />);
      expect(container.querySelector('[data-status="pending"]')).toHaveTextContent('In attesa');
    });

    it('renders dialing', () => {
      const { container } = render(<StatusBadge status="dialing" />);
      expect(container.querySelector('[data-status="dialing"]')).toHaveTextContent('In chiamata');
    });

    it('renders in_progress', () => {
      const { container } = render(<StatusBadge status="in_progress" />);
      expect(container.querySelector('[data-status="in_progress"]')).toHaveTextContent('In corso');
    });

    it('renders failed', () => {
      const { container } = render(<StatusBadge status="failed" />);
      expect(container.querySelector('[data-status="failed"]')).toHaveTextContent('Fallita');
    });

    it('renders no_answer', () => {
      const { container } = render(<StatusBadge status="no_answer" />);
      expect(container.querySelector('[data-status="no_answer"]')).toHaveTextContent('Senza risposta');
    });

    it('renders busy', () => {
      const { container } = render(<StatusBadge status="busy" />);
      expect(container.querySelector('[data-status="busy"]')).toHaveTextContent('Occupato');
    });
  });

  describe('payment statuses', () => {
    it('renders processing', () => {
      const { container } = render(<StatusBadge status="processing" />);
      expect(container.querySelector('[data-status="processing"]')).toHaveTextContent('In elaborazione');
    });

    it('renders succeeded', () => {
      const { container } = render(<StatusBadge status="succeeded" />);
      expect(container.querySelector('[data-status="succeeded"]')).toHaveTextContent('Completato');
    });

    it('renders refunded', () => {
      const { container } = render(<StatusBadge status="refunded" />);
      expect(container.querySelector('[data-status="refunded"]')).toHaveTextContent('Rimborsato');
    });
  });

  describe('opt-out statuses', () => {
    it('renders active', () => {
      const { container } = render(<StatusBadge status="active" />);
      expect(container.querySelector('[data-status="active"]')).toHaveTextContent('Attivo');
    });

    it('renders opted_out', () => {
      const { container } = render(<StatusBadge status="opted_out" />);
      expect(container.querySelector('[data-status="opted_out"]')).toHaveTextContent('Opt-out');
    });

    it('renders pending_review', () => {
      const { container } = render(<StatusBadge status="pending_review" />);
      expect(container.querySelector('[data-status="pending_review"]')).toHaveTextContent('In revisione');
    });
  });

  describe('RPO statuses', () => {
    it('renders compliant', () => {
      const { container } = render(<StatusBadge status="compliant" />);
      expect(container.querySelector('[data-status="compliant"]')).toHaveTextContent('Conforme');
    });

    it('renders warning', () => {
      const { container } = render(<StatusBadge status="warning" />);
      expect(container.querySelector('[data-status="warning"]')).toHaveTextContent('Avviso');
    });

    it('renders blocked', () => {
      const { container } = render(<StatusBadge status="blocked" />);
      expect(container.querySelector('[data-status="blocked"]')).toHaveTextContent('Bloccato');
    });

    it('renders expired', () => {
      const { container } = render(<StatusBadge status="expired" />);
      expect(container.querySelector('[data-status="expired"]')).toHaveTextContent('Scaduto');
    });
  });

  it('accepts a label override', () => {
    const { container } = render(<StatusBadge status="draft" label="Custom label" />);
    expect(container.querySelector('[data-status="draft"]')).toHaveTextContent('Custom label');
  });

  it('applies custom className', () => {
    const { container } = render(<StatusBadge status="draft" className="test-class" />);
    expect(container.querySelector('[data-status="draft"]')).toHaveClass('test-class');
  });

  it('renders data-slot attribute', () => {
    const { container } = render(<StatusBadge status="draft" />);
    expect(container.querySelector('[data-slot="status-badge"]')).toBeInTheDocument();
  });

  it('STATUS_MAP covers all expected statuses', () => {
    const expectedStatuses = [
      'draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled', 'error',
      'pending', 'dialing', 'in_progress', 'failed', 'no_answer', 'busy',
      'processing', 'succeeded', 'refunded',
      'active', 'opted_out', 'pending_review',
      'compliant', 'warning', 'blocked', 'expired',
    ];
    for (const status of expectedStatuses) {
      expect(STATUS_MAP).toHaveProperty(status);
    }
  });
});

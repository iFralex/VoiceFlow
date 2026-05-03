import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CreditPill, CreditPillSkeleton } from '../credit-pill';

// next/link renders as <a> in tests
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

describe('CreditPill', () => {
  afterEach(cleanup);

  describe('status tier colours via data-status', () => {
    it('shows green status for ≥60 minutes', () => {
      render(<CreditPill balance={{ remainingMinutes: 60 }} />);
      expect(screen.getByTestId('credit-pill').getAttribute('data-status')).toBe('green');
    });

    it('shows green status for >60 minutes', () => {
      render(<CreditPill balance={{ remainingMinutes: 200 }} />);
      expect(screen.getByTestId('credit-pill').getAttribute('data-status')).toBe('green');
    });

    it('shows amber status for 10–59 minutes', () => {
      render(<CreditPill balance={{ remainingMinutes: 10 }} />);
      expect(screen.getByTestId('credit-pill').getAttribute('data-status')).toBe('amber');
    });

    it('shows amber status for 59 minutes', () => {
      render(<CreditPill balance={{ remainingMinutes: 59 }} />);
      expect(screen.getByTestId('credit-pill').getAttribute('data-status')).toBe('amber');
    });

    it('shows red status for <10 minutes', () => {
      render(<CreditPill balance={{ remainingMinutes: 9 }} />);
      expect(screen.getByTestId('credit-pill').getAttribute('data-status')).toBe('red');
    });

    it('shows red status for 0 minutes', () => {
      render(<CreditPill balance={{ remainingMinutes: 0 }} />);
      expect(screen.getByTestId('credit-pill').getAttribute('data-status')).toBe('red');
    });
  });

  describe('pill label', () => {
    it('displays remaining minutes in the pill label', () => {
      render(<CreditPill balance={{ remainingMinutes: 42 }} />);
      expect(screen.getByTestId('credit-pill')).toBeTruthy();
      expect(screen.getByText('42 min')).toBeTruthy();
    });

    it('has accessible aria-label with minute count', () => {
      render(<CreditPill balance={{ remainingMinutes: 75 }} />);
      const pill = screen.getByTestId('credit-pill');
      expect(pill.getAttribute('aria-label')).toContain('75');
    });
  });

  describe('popover', () => {
    it('opens popover on click', async () => {
      render(<CreditPill balance={{ remainingMinutes: 30 }} />);
      fireEvent.click(screen.getByTestId('credit-pill'));
      await waitFor(() => {
        expect(screen.getByTestId('credit-popover')).toBeTruthy();
      });
    });

    it('shows available minutes in popover', async () => {
      render(<CreditPill balance={{ remainingMinutes: 30 }} />);
      fireEvent.click(screen.getByTestId('credit-pill'));
      await waitFor(() => {
        expect(screen.getByTestId('credit-available').textContent).toContain('30');
      });
    });

    it('shows Ricarica link pointing to /credit/topup', async () => {
      render(<CreditPill balance={{ remainingMinutes: 5 }} />);
      fireEvent.click(screen.getByTestId('credit-pill'));
      await waitFor(() => {
        const link = screen.getByRole('link', { name: /ricarica/i });
        expect(link.getAttribute('href')).toBe('/credit/topup');
      });
    });

    it('shows reserved minutes when provided', async () => {
      render(
        <CreditPill
          balance={{ remainingMinutes: 30, reservedMinutes: 5 }}
        />,
      );
      fireEvent.click(screen.getByTestId('credit-pill'));
      await waitFor(() => {
        expect(screen.getByText(/riservati/i)).toBeTruthy();
        expect(screen.getByText('5 min')).toBeTruthy();
      });
    });

    it('hides reserved minutes row when reservedMinutes is 0', async () => {
      render(
        <CreditPill
          balance={{ remainingMinutes: 30, reservedMinutes: 0 }}
        />,
      );
      fireEvent.click(screen.getByTestId('credit-pill'));
      await waitFor(() => {
        expect(screen.queryByText(/riservati/i)).toBeNull();
      });
    });

    it('shows total minutes when provided', async () => {
      render(
        <CreditPill
          balance={{ remainingMinutes: 30, totalMinutes: 500 }}
        />,
      );
      fireEvent.click(screen.getByTestId('credit-pill'));
      await waitFor(() => {
        expect(screen.getByText(/totale acquistati/i)).toBeTruthy();
        expect(screen.getByText('500 min')).toBeTruthy();
      });
    });
  });
});

describe('CreditPillSkeleton', () => {
  afterEach(cleanup);

  it('renders skeleton placeholder', () => {
    render(<CreditPillSkeleton />);
    expect(screen.getByTestId('credit-pill-skeleton')).toBeTruthy();
  });

  it('is disabled', () => {
    render(<CreditPillSkeleton />);
    const el = screen.getByTestId('credit-pill-skeleton');
    expect(el.hasAttribute('disabled')).toBe(true);
  });
});

describe('TopBar credit integration', () => {
  afterEach(cleanup);

  it('renders CreditPill when creditBalance is provided', async () => {
    const { TopBar } = await import('../topbar');
    render(<TopBar onMobileMenuClick={() => {}} creditBalance={{ remainingMinutes: 45 }} />);
    expect(screen.getByTestId('credit-pill')).toBeTruthy();
    expect(screen.getByText('45 min')).toBeTruthy();
  });

  it('renders skeleton when creditBalance is undefined', async () => {
    const { TopBar } = await import('../topbar');
    render(<TopBar onMobileMenuClick={() => {}} />);
    expect(screen.getByTestId('credit-pill-skeleton')).toBeTruthy();
  });
});

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PeriodSelector } from '@/components/dashboard/period-selector';

const mockReplace = vi.fn();
const mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ replace: mockReplace, push: vi.fn(), refresh: vi.fn() })),
  useSearchParams: vi.fn(() => mockSearchParams),
}));

afterEach(cleanup);
beforeEach(() => {
  mockReplace.mockReset();
});

describe('PeriodSelector', () => {
  it('renders all 5 period options', () => {
    render(<PeriodSelector value="7d" />);
    expect(screen.getByRole('tab', { name: 'Oggi' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Ultimi 7 giorni' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Ultimi 30 giorni' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Mese corrente' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Mese scorso' })).toBeInTheDocument();
  });

  it('marks the active period with aria-selected', () => {
    render(<PeriodSelector value="30d" />);
    const active = screen.getByRole('tab', { name: 'Ultimi 30 giorni' });
    expect(active.getAttribute('aria-selected')).toBe('true');
  });

  it('replaces the URL with the new period when clicked', () => {
    render(<PeriodSelector value="7d" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Mese corrente' }));
    expect(mockReplace).toHaveBeenCalledWith('/dashboard?period=month');
  });

  it('omits the period query param when reverting to the default 7d', () => {
    render(<PeriodSelector value="30d" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Ultimi 7 giorni' }));
    expect(mockReplace).toHaveBeenCalledWith('/dashboard');
  });
});

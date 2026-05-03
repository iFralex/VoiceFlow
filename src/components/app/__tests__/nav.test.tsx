import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Nav, PRIMARY_NAV_ITEMS } from '../nav';

// Mock next/navigation so Nav can use usePathname in jsdom
vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/dashboard'),
}));

afterEach(() => {
  cleanup();
});

describe('Nav', () => {
  it('renders all primary nav items for owner role', () => {
    render(<Nav role="owner" />);
    expect(screen.getByText('Dashboard')).toBeTruthy();
    expect(screen.getByText('Campagne')).toBeTruthy();
    expect(screen.getByText('Contatti')).toBeTruthy();
    expect(screen.getByText('Script')).toBeTruthy();
    expect(screen.getByText('Credito')).toBeTruthy();
    expect(screen.getByText('Impostazioni')).toBeTruthy();
  });

  it('hides role-restricted items for agent role', () => {
    render(<Nav role="agent" />);
    expect(screen.getByText('Dashboard')).toBeTruthy();
    expect(screen.getByText('Campagne')).toBeTruthy();
    // Credito and Impostazioni require owner/admin
    expect(screen.queryByText('Credito')).toBeNull();
    expect(screen.queryByText('Impostazioni')).toBeNull();
  });

  it('shows restricted items for admin role', () => {
    render(<Nav role="admin" />);
    expect(screen.getByText('Credito')).toBeTruthy();
    expect(screen.getByText('Impostazioni')).toBeTruthy();
  });

  it('marks the active item with aria-current="page"', async () => {
    const { usePathname } = await import('next/navigation');
    vi.mocked(usePathname).mockReturnValue('/campagne');
    render(<Nav role="owner" />);
    const activeLink = screen.getByRole('link', { name: 'Campagne' });
    expect(activeLink.getAttribute('aria-current')).toBe('page');
  });

  it('renders English labels when locale is en', () => {
    render(<Nav role="owner" locale="en" />);
    expect(screen.getByText('Campaigns')).toBeTruthy();
    expect(screen.getByText('Contacts')).toBeTruthy();
    expect(screen.getByText('Credit')).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();
  });

  it('renders badge values when provided', () => {
    render(<Nav role="owner" badgeValues={{ '/campagne': '3' }} />);
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('PRIMARY_NAV_ITEMS has all six spec items in order', () => {
    const hrefs = PRIMARY_NAV_ITEMS.map((item) => item.href);
    expect(hrefs).toEqual([
      '/dashboard',
      '/campagne',
      '/contatti',
      '/script',
      '/credito',
      '/impostazioni',
    ]);
  });
});

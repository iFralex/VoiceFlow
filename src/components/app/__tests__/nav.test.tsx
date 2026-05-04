import { cleanup, render, screen } from '@testing-library/react';
import { useTranslations } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Nav, PRIMARY_NAV_ITEMS } from '../nav';

// Mock next/navigation so Nav can use usePathname in jsdom
vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/dashboard'),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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

  it('hides role-restricted items for operator role', () => {
    render(<Nav role="operator" />);
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

  it('renders English labels when useTranslations returns English values', () => {
    // Override the global mock to return English nav translations for this test
    const enNav: Record<string, string> = {
      dashboard: 'Dashboard',
      campaigns: 'Campaigns',
      contacts: 'Contacts',
      scripts: 'Scripts',
      credit: 'Credit',
      settings: 'Settings',
      primary_nav_label: 'Main navigation',
    };
    // Cast required because vi.fn mock doesn't have the full Translator methods
    vi.mocked(useTranslations).mockReturnValueOnce(
      ((key: string) => enNav[key] ?? key) as unknown as ReturnType<typeof useTranslations>,
    );
    render(<Nav role="owner" />);
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
      '/contacts',
      '/scripts',
      '/credit',
      '/impostazioni',
    ]);
  });
});

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Shell } from '../shell';

// Nav uses usePathname; OrgSwitcher uses useRouter
vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/dashboard'),
  useRouter: vi.fn(() => ({ refresh: vi.fn() })),
}));

// OrgSwitcher calls setActiveOrg — mock to prevent db/env imports
vi.mock('@/actions/org', () => ({
  setActiveOrg: vi.fn().mockResolvedValue({ ok: true }),
}));

// Minimal localStorage mock with StorageEvent support
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => {
    store[key] = value;
  },
  removeItem: (key: string) => {
    delete store[key];
  },
  clear: () => {
    Object.keys(store).forEach((k) => delete store[k]);
  },
};

Object.defineProperty(window, 'localStorage', { value: localStorageMock, configurable: true });

describe('Shell', () => {
  afterEach(() => {
    cleanup();
    localStorageMock.clear();
  });

  it('renders children inside the main area', () => {
    render(<Shell><p>test content</p></Shell>);
    expect(screen.getByText('test content')).toBeTruthy();
  });

  it('renders the top bar with mobile hamburger button', () => {
    render(<Shell><div /></Shell>);
    const topbar = screen.getByTestId('app-topbar');
    expect(within(topbar).getByRole('button', { name: /apri menu/i })).toBeTruthy();
  });

  it('renders the sidebar with navigation items', () => {
    render(<Shell><div /></Shell>);
    const sidebar = screen.getByTestId('app-sidebar');
    expect(within(sidebar).getByText('Dashboard')).toBeTruthy();
    expect(within(sidebar).getByText('Campagne')).toBeTruthy();
    expect(within(sidebar).getByText('Contatti')).toBeTruthy();
  });

  it('sidebar starts expanded (not collapsed) by default', () => {
    render(<Shell><div /></Shell>);
    const sidebar = screen.getByTestId('app-sidebar');
    expect(sidebar.getAttribute('data-collapsed')).toBe('false');
  });

  it('reads saved collapsed state from localStorage', () => {
    localStorageMock.setItem('app-sidebar-collapsed', 'true');
    render(<Shell><div /></Shell>);
    const sidebar = screen.getByTestId('app-sidebar');
    // useSyncExternalStore reads snapshot on every render; collapsed should be true
    expect(sidebar.getAttribute('data-collapsed')).toBe('true');
  });

  it('toggle button writes collapsed state to localStorage', () => {
    render(<Shell><div /></Shell>);
    const sidebar = screen.getByTestId('app-sidebar');
    const toggleBtn = within(sidebar).getByRole('button', { name: /comprimi barra laterale/i });
    fireEvent.click(toggleBtn);
    expect(localStorageMock.getItem('app-sidebar-collapsed')).toBe('true');
  });
});

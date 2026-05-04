import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CommandPalette } from '../command-palette';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: mockPush })),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

function renderOpen() {
  const onOpenChange = vi.fn();
  render(<CommandPalette open onOpenChange={onOpenChange} />);
  return { onOpenChange };
}

describe('CommandPalette', () => {
  afterEach(() => {
    cleanup();
    mockPush.mockReset();
  });

  describe('rendering', () => {
    it('renders the dialog when open is true', () => {
      renderOpen();
      expect(screen.getByRole('dialog')).toBeTruthy();
    });

    it('does not render the dialog when open is false', () => {
      render(<CommandPalette open={false} onOpenChange={vi.fn()} />);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('renders a search input', () => {
      renderOpen();
      expect(screen.getByPlaceholderText('Cerca azioni...')).toBeTruthy();
    });

    it('renders the Navigazione group heading', () => {
      renderOpen();
      expect(screen.getByText('Navigazione')).toBeTruthy();
    });
  });

  describe('navigation items', () => {
    it('renders Dashboard item', () => {
      renderOpen();
      expect(screen.getByTestId('cmd-nav-dashboard')).toBeTruthy();
    });

    it('renders Campagne item', () => {
      renderOpen();
      expect(screen.getByTestId('cmd-nav-campagne')).toBeTruthy();
    });

    it('renders Contatti item', () => {
      renderOpen();
      expect(screen.getByTestId('cmd-nav-contacts')).toBeTruthy();
    });

    it('renders Script item', () => {
      renderOpen();
      expect(screen.getByTestId('cmd-nav-script')).toBeTruthy();
    });

    it('renders Credito item', () => {
      renderOpen();
      expect(screen.getByTestId('cmd-nav-credit')).toBeTruthy();
    });

    it('renders Impostazioni item', () => {
      renderOpen();
      expect(screen.getByTestId('cmd-nav-impostazioni')).toBeTruthy();
    });
  });

  describe('item selection', () => {
    it('navigates to dashboard on Dashboard select', async () => {
      const { onOpenChange } = renderOpen();
      fireEvent.click(screen.getByTestId('cmd-nav-dashboard'));
      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/dashboard');
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
    });

    it('navigates to /campagne on Campagne select', async () => {
      const { onOpenChange } = renderOpen();
      fireEvent.click(screen.getByTestId('cmd-nav-campagne'));
      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/campagne');
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
    });
  });

  describe('empty state', () => {
    it('shows empty state message when no results match', async () => {
      renderOpen();
      const input = screen.getByPlaceholderText('Cerca azioni...');
      fireEvent.change(input, { target: { value: 'zzznomatch999' } });
      await waitFor(() => {
        expect(screen.getByText('Nessun risultato trovato.')).toBeTruthy();
      });
    });
  });
});

describe('TopBar command palette integration', () => {
  afterEach(() => {
    cleanup();
    mockPush.mockReset();
  });

  it('opens command palette on search button click', async () => {
    // TopBar needs next/navigation mock (for useCommandPaletteShortcut useEffect)
    const { TopBar } = await import('../topbar');
    render(<TopBar onMobileMenuClick={vi.fn()} />);
    fireEvent.click(screen.getByTestId('cmd-trigger'));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy();
    });
  });

  it('search button has accessible label', async () => {
    const { TopBar } = await import('../topbar');
    render(<TopBar onMobileMenuClick={vi.fn()} />);
    const btn = screen.getByTestId('cmd-trigger');
    expect(btn.getAttribute('aria-label')).toBeTruthy();
  });
});

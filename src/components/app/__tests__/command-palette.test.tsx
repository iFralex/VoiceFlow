import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: mockPush })),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const mockSearchPaletteAction = vi.fn();

vi.mock('@/actions/search', () => ({
  searchPaletteAction: (...args: unknown[]) => mockSearchPaletteAction(...args),
}));

const { CommandPalette } = await import('../command-palette');

function renderOpen() {
  const onOpenChange = vi.fn();
  render(<CommandPalette open onOpenChange={onOpenChange} />);
  return { onOpenChange };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mockSearchPaletteAction.mockReset();
  mockSearchPaletteAction.mockResolvedValue({
    ok: true,
    results: { contacts: [], campaigns: [], scripts: [] },
  });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  mockPush.mockReset();
});

describe('CommandPalette', () => {
  describe('rendering', () => {
    it('renders the dialog when open is true', () => {
      renderOpen();
      expect(screen.getByRole('dialog')).toBeTruthy();
    });

    it('does not render the dialog when open is false', () => {
      render(<CommandPalette open={false} onOpenChange={vi.fn()} />);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('renders the localised search input', () => {
      renderOpen();
      expect(screen.getByPlaceholderText('Cerca azioni, contatti, campagne…')).toBeTruthy();
    });

    it('renders the Navigazione group heading', () => {
      renderOpen();
      expect(screen.getByText('Navigazione')).toBeTruthy();
    });

    it('renders the Azioni rapide group heading', () => {
      renderOpen();
      expect(screen.getByText('Azioni rapide')).toBeTruthy();
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
      expect(screen.getByTestId('cmd-nav-scripts')).toBeTruthy();
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

  describe('quick actions', () => {
    it('renders the four quick actions', () => {
      renderOpen();
      expect(screen.getByTestId('cmd-action-create_campaign')).toBeTruthy();
      expect(screen.getByTestId('cmd-action-upload_contacts')).toBeTruthy();
      expect(screen.getByTestId('cmd-action-topup_credit')).toBeTruthy();
      expect(screen.getByTestId('cmd-action-goto_settings')).toBeTruthy();
    });

    it('navigates to /campaigns/new on Crea campagna select', async () => {
      const { onOpenChange } = renderOpen();
      fireEvent.click(screen.getByTestId('cmd-action-create_campaign'));
      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/campaigns/new');
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
    });

    it('navigates to /credit/topup on Ricarica credito select', async () => {
      const { onOpenChange } = renderOpen();
      fireEvent.click(screen.getByTestId('cmd-action-topup_credit'));
      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/credit/topup');
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
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
      const input = screen.getByPlaceholderText('Cerca azioni, contatti, campagne…');
      fireEvent.change(input, { target: { value: 'zzznomatch999' } });
      await waitFor(() => {
        expect(screen.getByText('Nessun risultato trovato.')).toBeTruthy();
      });
    });
  });

  describe('server-side search', () => {
    it('does not call the action when the query is empty', () => {
      renderOpen();
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(mockSearchPaletteAction).not.toHaveBeenCalled();
    });

    it('debounces input before calling the search action', async () => {
      renderOpen();
      const input = screen.getByPlaceholderText('Cerca azioni, contatti, campagne…');
      fireEvent.change(input, { target: { value: 'm' } });
      fireEvent.change(input, { target: { value: 'ma' } });
      fireEvent.change(input, { target: { value: 'mar' } });

      // Before the debounce window elapses, no call yet.
      expect(mockSearchPaletteAction).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(250);
      });

      expect(mockSearchPaletteAction).toHaveBeenCalledTimes(1);
      expect(mockSearchPaletteAction).toHaveBeenCalledWith({ query: 'mar' });
    });

    it('renders contact, campaign, and script results after the action resolves', async () => {
      mockSearchPaletteAction.mockResolvedValueOnce({
        ok: true,
        results: {
          contacts: [
            {
              id: 'c-1',
              firstName: 'Mario',
              lastName: 'Rossi',
              phone: '+393331234567',
              contactListId: 'list-1',
            },
          ],
          campaigns: [{ id: 'cmp-1', name: 'Riattivazione Maggio', status: 'running' }],
          scripts: [{ id: 's-1', name: 'Riattivazione lead' }],
        },
      });

      renderOpen();
      const input = screen.getByPlaceholderText('Cerca azioni, contatti, campagne…');
      fireEvent.change(input, { target: { value: 'rio' } });

      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      await act(async () => {
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(screen.getByTestId('cmd-contact-c-1')).toBeTruthy();
        expect(screen.getByTestId('cmd-campaign-cmp-1')).toBeTruthy();
        expect(screen.getByTestId('cmd-script-s-1')).toBeTruthy();
      });
    });

    it('navigates to the contact list page when a contact result is selected', async () => {
      mockSearchPaletteAction.mockResolvedValueOnce({
        ok: true,
        results: {
          contacts: [
            {
              id: 'c-1',
              firstName: 'Mario',
              lastName: 'Rossi',
              phone: '+393331234567',
              contactListId: 'list-99',
            },
          ],
          campaigns: [],
          scripts: [],
        },
      });

      const { onOpenChange } = renderOpen();
      const input = screen.getByPlaceholderText('Cerca azioni, contatti, campagne…');
      fireEvent.change(input, { target: { value: 'rio' } });

      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      await act(async () => {
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(screen.getByTestId('cmd-contact-c-1')).toBeTruthy();
      });

      fireEvent.click(screen.getByTestId('cmd-contact-c-1'));
      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/contacts/lists/list-99');
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
    });

    it('navigates to the campaign detail page when a campaign result is selected', async () => {
      mockSearchPaletteAction.mockResolvedValueOnce({
        ok: true,
        results: {
          contacts: [],
          campaigns: [{ id: 'cmp-42', name: 'Black Friday', status: 'completed' }],
          scripts: [],
        },
      });

      const { onOpenChange } = renderOpen();
      const input = screen.getByPlaceholderText('Cerca azioni, contatti, campagne…');
      fireEvent.change(input, { target: { value: 'black' } });

      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      await act(async () => {
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(screen.getByTestId('cmd-campaign-cmp-42')).toBeTruthy();
      });

      fireEvent.click(screen.getByTestId('cmd-campaign-cmp-42'));
      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/campaigns/cmp-42');
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
    });

    it('falls back to empty results when the action returns an error', async () => {
      mockSearchPaletteAction.mockResolvedValueOnce({ ok: false, message: 'boom' });

      renderOpen();
      const input = screen.getByPlaceholderText('Cerca azioni, contatti, campagne…');
      fireEvent.change(input, { target: { value: 'mario' } });

      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      await act(async () => {
        await Promise.resolve();
      });

      // No data groups should be rendered.
      expect(screen.queryByText('Contatti')).toBeNull();
      expect(screen.queryByText('Campagne')).toBeNull();
      expect(screen.queryByText('Script')).toBeNull();
    });
  });
});

describe('TopBar command palette integration', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    cleanup();
    mockPush.mockReset();
  });

  it('opens command palette on search button click', async () => {
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

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_NOTIFICATION_PREFERENCES } from '@/lib/services/notification-preferences';

import { NotificationsSettingsClient } from './notifications-settings-client';

const mockUpdate = vi.fn();
vi.mock('@/actions/notification-preferences', () => ({
  updateNotificationPreferencesAction: (...args: unknown[]) => mockUpdate(...args),
}));

const mockToastResult = vi.fn();
vi.mock('@/lib/utils/action-toast', () => ({
  toastResult: (...args: unknown[]) => mockToastResult(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockUpdate.mockReset();
  mockToastResult.mockReset();
});

describe('NotificationsSettingsClient', () => {
  it('renders the page title and a row per toggle', () => {
    render(<NotificationsSettingsClient initialPrefs={DEFAULT_NOTIFICATION_PREFERENCES} />);
    expect(screen.getByRole('heading', { level: 1, name: /Notifiche/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/Report giornaliero/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Appuntamento fissato/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Lead qualificato/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Credito basso/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Campagna completata/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Riepilogo settimanale/)).toBeInTheDocument();
  });

  it('reflects the initial prefs on each switch', () => {
    render(
      <NotificationsSettingsClient
        initialPrefs={{
          ...DEFAULT_NOTIFICATION_PREFERENCES,
          daily_report: false,
          weekly_summary: true,
        }}
      />,
    );

    expect(screen.getByLabelText(/Report giornaliero/)).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByLabelText(/Riepilogo settimanale/)).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('calls the action with the toggled value and shows a success toast', async () => {
    const user = userEvent.setup();
    mockUpdate.mockResolvedValue({ ok: true });

    render(<NotificationsSettingsClient initialPrefs={DEFAULT_NOTIFICATION_PREFERENCES} />);

    await user.click(screen.getByLabelText(/Report giornaliero/));

    expect(mockUpdate).toHaveBeenCalledWith({ daily_report: false });
    expect(mockToastResult).toHaveBeenCalledWith({
      ok: true,
      message: 'Preferenza aggiornata',
    });
  });

  it('reverts the optimistic update when the action fails', async () => {
    const user = userEvent.setup();
    mockUpdate.mockResolvedValue({ ok: false, message: 'error_generic' });

    render(<NotificationsSettingsClient initialPrefs={DEFAULT_NOTIFICATION_PREFERENCES} />);

    const toggle = screen.getByLabelText(/Report giornaliero/);
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(mockToastResult).toHaveBeenCalledWith({
      ok: false,
      message: 'error_generic',
    });
  });
});

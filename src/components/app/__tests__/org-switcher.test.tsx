import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';

import { OrgSwitcher } from '../org-switcher';

function renderWithProvider(props: React.ComponentProps<typeof OrgSwitcher>) {
  return render(
    <TooltipProvider>
      <OrgSwitcher {...props} />
    </TooltipProvider>,
  );
}

const mockRefresh = vi.fn();

vi.mock('@/actions/org', () => ({
  switchOrg: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ refresh: mockRefresh })),
}));

const ORGS = [
  { id: 'org-1', name: 'Concessionaria Nord' },
  { id: 'org-2', name: 'Concessionaria Sud' },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('OrgSwitcher', () => {
  it('shows active org name in the trigger button', () => {
    renderWithProvider({ orgs: ORGS, activeOrgId: 'org-1' });
    expect(screen.getByText('Concessionaria Nord')).toBeTruthy();
  });

  it('shows the trigger button when no orgs provided', () => {
    renderWithProvider({ orgs: [], activeOrgId: null });
    expect(screen.getByRole('button', { name: /cambia organizzazione/i })).toBeTruthy();
  });

  it('shows the first org as active when activeOrgId is null but orgs exist', () => {
    renderWithProvider({ orgs: ORGS, activeOrgId: null });
    expect(screen.getByText('Concessionaria Nord')).toBeTruthy();
  });

  it('renders trigger button with aria-label in collapsed mode (label text hidden)', () => {
    renderWithProvider({ orgs: ORGS, activeOrgId: 'org-1', collapsed: true });
    const btn = screen.getByRole('button', { name: /cambia organizzazione/i });
    expect(btn).toBeTruthy();
    // label text should not be rendered in collapsed mode
    expect(screen.queryByText('Concessionaria Nord')).toBeNull();
  });

  it('opens popover and shows org list on trigger click', () => {
    renderWithProvider({ orgs: ORGS, activeOrgId: 'org-1' });
    const trigger = screen.getByRole('button', { name: /cambia organizzazione/i });
    fireEvent.click(trigger);
    expect(screen.getByText('Organizzazioni')).toBeTruthy();
    expect(screen.getAllByText('Concessionaria Nord').length).toBeGreaterThan(0);
    expect(screen.getByText('Concessionaria Sud')).toBeTruthy();
  });

  it('active org has aria-current="true" in the list', () => {
    renderWithProvider({ orgs: ORGS, activeOrgId: 'org-1' });
    fireEvent.click(screen.getByRole('button', { name: /cambia organizzazione/i }));
    const allButtons = screen.getAllByRole('button');
    const activeBtn = allButtons.find((btn) => btn.getAttribute('aria-current') === 'true');
    expect(activeBtn).toBeTruthy();
  });

  it('shows "Crea nuova organizzazione" CTA in the popover', () => {
    renderWithProvider({ orgs: ORGS, activeOrgId: 'org-1' });
    fireEvent.click(screen.getByRole('button', { name: /cambia organizzazione/i }));
    expect(screen.getByText('Crea nuova organizzazione')).toBeTruthy();
  });

  it('calls switchOrg and router.refresh when a different org is clicked', async () => {
    const { switchOrg } = await import('@/actions/org');
    renderWithProvider({ orgs: ORGS, activeOrgId: 'org-1' });
    fireEvent.click(screen.getByRole('button', { name: /cambia organizzazione/i }));
    fireEvent.click(screen.getByText('Concessionaria Sud'));
    await waitFor(() => {
      expect(switchOrg).toHaveBeenCalledWith('org-2');
    });
    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  it('does not call switchOrg when clicking the already-active org', async () => {
    const { switchOrg } = await import('@/actions/org');
    renderWithProvider({ orgs: ORGS, activeOrgId: 'org-1' });
    fireEvent.click(screen.getByRole('button', { name: /cambia organizzazione/i }));
    // In the popover list, the active org button is the last match for the name
    const listItems = screen.getAllByText('Concessionaria Nord');
    fireEvent.click(listItems.at(-1)!);
    await waitFor(() => {
      expect(switchOrg).not.toHaveBeenCalled();
    });
  });
});

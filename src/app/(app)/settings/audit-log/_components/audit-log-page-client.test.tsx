import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SerializedAuditLogEntry } from '@/actions/audit_log';

import { AuditLogPageClient } from './audit-log-page-client';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockListAuditLogEntries = vi.fn();
const mockExportAuditLogCsv = vi.fn();

vi.mock('@/actions/audit_log', () => ({
  listAuditLogEntries: (...args: unknown[]) => mockListAuditLogEntries(...args),
  exportAuditLogCsv: (...args: unknown[]) => mockExportAuditLogCsv(...args),
}));

const mockToastResult = vi.fn();
vi.mock('@/lib/utils/action-toast', () => ({
  toastResult: (...args: unknown[]) => mockToastResult(...args),
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ENTRY_USER: SerializedAuditLogEntry = {
  id: '10',
  createdAt: '2026-05-08T10:00:00.000Z',
  actorType: 'user',
  actorUserId: 'u-1',
  actorEmail: 'alice@example.com',
  action: 'compliance.gdpr_export',
  subjectType: 'contact',
  subjectId: 'subj-1',
  metadata: { foo: 'bar' },
};

const ENTRY_SYSTEM: SerializedAuditLogEntry = {
  id: '9',
  createdAt: '2026-05-07T09:00:00.000Z',
  actorType: 'system',
  actorUserId: null,
  actorEmail: null,
  action: 'compliance.aiact_audit_completed',
  subjectType: 'org',
  subjectId: 'org-1',
  metadata: null,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockListAuditLogEntries.mockReset();
  mockExportAuditLogCsv.mockReset();
  mockToastResult.mockReset();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AuditLogPageClient', () => {
  it('renders the title, filter inputs and column headers', () => {
    render(
      <AuditLogPageClient
        initialEntries={[ENTRY_USER]}
        initialCursor={null}
        pageSize={50}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: /Registro audit/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Prefisso azione/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Da$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^A$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/ID utente/i)).toBeInTheDocument();
    expect(screen.getByText(/^Data e ora$/)).toBeInTheDocument();
    expect(screen.getByText(/^Attore$/)).toBeInTheDocument();
  });

  it('shows the empty state when there are no entries', () => {
    render(
      <AuditLogPageClient initialEntries={[]} initialCursor={null} pageSize={50} />,
    );
    expect(screen.getByText(/Nessuna voce di audit/i)).toBeInTheDocument();
  });

  it('renders the email of a user actor and "Sistema" for system actor', () => {
    render(
      <AuditLogPageClient
        initialEntries={[ENTRY_USER, ENTRY_SYSTEM]}
        initialCursor={null}
        pageSize={50}
      />,
    );
    const rows = screen.getAllByTestId('audit-log-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('alice@example.com')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Sistema')).toBeInTheDocument();
  });

  it('expands metadata details on click', async () => {
    render(
      <AuditLogPageClient
        initialEntries={[ENTRY_USER]}
        initialCursor={null}
        pageSize={50}
      />,
    );
    const showButton = screen.getByRole('button', { name: /^Mostra$/ });
    expect(screen.queryByText(/"foo"/)).not.toBeInTheDocument();

    await userEvent.click(showButton);

    expect(screen.getByText(/"foo"/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Nascondi$/ })).toBeInTheDocument();
  });

  it('reloads with filters when "Applica" is clicked', async () => {
    mockListAuditLogEntries.mockResolvedValueOnce({
      ok: true,
      data: { entries: [ENTRY_SYSTEM], nextCursor: null },
    });

    render(
      <AuditLogPageClient
        initialEntries={[ENTRY_USER]}
        initialCursor={null}
        pageSize={50}
      />,
    );

    await userEvent.type(screen.getByLabelText(/Prefisso azione/i), 'compliance.');
    await userEvent.click(screen.getByRole('button', { name: /^Applica$/ }));

    await screen.findByText(/compliance.aiact_audit_completed/);

    expect(mockListAuditLogEntries).toHaveBeenCalledWith({
      filters: { actionPrefix: 'compliance.' },
      limit: 50,
    });
  });

  it('shows a "Carica altri" button when nextCursor is present and loads more on click', async () => {
    mockListAuditLogEntries.mockResolvedValueOnce({
      ok: true,
      data: { entries: [ENTRY_SYSTEM], nextCursor: null },
    });

    render(
      <AuditLogPageClient
        initialEntries={[ENTRY_USER]}
        initialCursor={{ createdAt: '2026-05-08T10:00:00.000Z', id: '10' }}
        pageSize={50}
      />,
    );

    const moreButton = screen.getByRole('button', { name: /Carica altri/i });
    await userEvent.click(moreButton);

    await screen.findByText(/compliance.aiact_audit_completed/);

    // Initial entry must still be present (entries appended, not replaced)
    expect(screen.getByText(/compliance.gdpr_export/)).toBeInTheDocument();
    expect(mockListAuditLogEntries).toHaveBeenCalledWith({
      filters: {},
      cursor: { createdAt: '2026-05-08T10:00:00.000Z', id: '10' },
      limit: 50,
    });
  });

  it('calls exportAuditLogCsv and triggers a download on success', async () => {
    mockExportAuditLogCsv.mockResolvedValueOnce({
      ok: true,
      data: {
        url: 'https://storage.test/audit.csv',
        expiresAt: '2026-05-08T11:00:00.000Z',
        rowCount: 5,
        truncated: false,
      },
    });

    // Stub document.createElement to capture the click
    const clickSpy = vi.fn();
    const originalCreate = document.createElement.bind(document);
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreate(tag) as HTMLElement;
      if (tag === 'a') (el as HTMLAnchorElement).click = clickSpy;
      return el as never;
    });

    render(
      <AuditLogPageClient initialEntries={[]} initialCursor={null} pageSize={50} />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Esporta CSV/i }));

    await screen.findByRole('button', { name: /Esporta CSV/i });
    expect(mockExportAuditLogCsv).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    createSpy.mockRestore();
  });

  it('shows a toast error when the list action fails', async () => {
    mockListAuditLogEntries.mockResolvedValueOnce({ ok: false, message: 'Forbidden' });

    render(
      <AuditLogPageClient initialEntries={[]} initialCursor={null} pageSize={50} />,
    );

    await userEvent.click(screen.getByRole('button', { name: /^Applica$/ }));

    await new Promise((r) => setTimeout(r, 0));
    expect(mockToastResult).toHaveBeenCalledWith({ ok: false, message: 'Forbidden' });
  });
});

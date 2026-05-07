import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GdprHistoryEntry } from '@/actions/compliance';

import { ComplianceSettingsClient } from './compliance-settings-client';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockRequestSubjectExport = vi.fn();
const mockRequestSubjectErasure = vi.fn();
const mockListGdprHistory = vi.fn();

vi.mock('@/actions/compliance', () => ({
  requestSubjectExport: (...args: unknown[]) => mockRequestSubjectExport(...args),
  requestSubjectErasure: (...args: unknown[]) => mockRequestSubjectErasure(...args),
  listGdprHistory: (...args: unknown[]) => mockListGdprHistory(...args),
}));

const mockToastResult = vi.fn();
vi.mock('@/lib/utils/action-toast', () => ({
  toastResult: (...args: unknown[]) => mockToastResult(...args),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const HISTORY_EXPORT: GdprHistoryEntry = {
  id: '1',
  action: 'compliance.gdpr_export',
  createdAt: '2026-05-01T10:00:00.000Z',
  actorUserId: 'u-1',
  actorEmail: 'admin@example.com',
  subjectId: 'cccccccc-cccc-4ccc-8ccc-000000000001',
  metadata: { totals: { calls: 3 } },
};

const HISTORY_ERASURE: GdprHistoryEntry = {
  id: '2',
  action: 'compliance.gdpr_erasure',
  createdAt: '2026-05-02T11:00:00.000Z',
  actorUserId: 'u-2',
  actorEmail: 'owner@example.com',
  subjectId: 'cccccccc-cccc-4ccc-8ccc-000000000002',
  metadata: { phoneE164: '+393331234567', reason: 'subject request' },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockRequestSubjectExport.mockReset();
  mockRequestSubjectErasure.mockReset();
  mockListGdprHistory.mockReset();
  mockToastResult.mockReset();
});

describe('ComplianceSettingsClient', () => {
  it('renders the page title and section headings', () => {
    render(<ComplianceSettingsClient canErase={true} initialHistory={[]} />);
    expect(screen.getByRole('heading', { level: 1, name: /Compliance e GDPR/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Diritti dell'interessato/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Storico richieste GDPR/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /^Documentazione$/i })).toBeInTheDocument();
  });

  it('hides the erase button when the role lacks compliance.erase', () => {
    render(<ComplianceSettingsClient canErase={false} initialHistory={[]} />);
    expect(screen.queryByRole('button', { name: /Cancella dati/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Esporta dati/i })).toBeInTheDocument();
  });

  it('shows the erase button when the role has compliance.erase', () => {
    render(<ComplianceSettingsClient canErase={true} initialHistory={[]} />);
    expect(screen.getByRole('button', { name: /Cancella dati/i })).toBeInTheDocument();
  });

  it('shows an empty-state message when history is empty', () => {
    render(<ComplianceSettingsClient canErase={false} initialHistory={[]} />);
    expect(screen.getByText(/Nessuna richiesta/i)).toBeInTheDocument();
  });

  it('renders history entries with action label and metadata summary', () => {
    render(
      <ComplianceSettingsClient
        canErase={true}
        initialHistory={[HISTORY_EXPORT, HISTORY_ERASURE]}
      />,
    );
    expect(screen.getByText(/Esportazione \(Art\. 15\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Cancellazione \(Art\. 17\)/i)).toBeInTheDocument();
    expect(screen.getByText(/3 chiamate incluse/i)).toBeInTheDocument();
    expect(screen.getByText(/\+393331234567/)).toBeInTheDocument();
    expect(screen.getByText('admin@example.com', { exact: false })).toBeInTheDocument();
  });

  it('disables the export button when the identifier is empty', () => {
    render(<ComplianceSettingsClient canErase={false} initialHistory={[]} />);
    const exportBtn = screen.getByRole('button', { name: /Esporta dati/i });
    expect(exportBtn).toBeDisabled();
  });

  it('calls requestSubjectExport with the trimmed identifier when clicked', async () => {
    const user = userEvent.setup();
    mockRequestSubjectExport.mockResolvedValue({
      ok: true,
      data: {
        url: 'https://example.com/signed',
        expiresAt: '2026-05-15T00:00:00.000Z',
        exportId: 'exp-1',
        totals: {
          calls: 2,
          appointments: 1,
          optOuts: 0,
          auditEntries: 4,
          recordingsBundled: 2,
          transcriptsBundled: 2,
        },
      },
    });
    mockListGdprHistory.mockResolvedValue({ ok: true, data: { entries: [] } });

    render(<ComplianceSettingsClient canErase={false} initialHistory={[]} />);

    const input = screen.getByLabelText(/Telefono o email/i);
    await user.type(input, '  +393331234567  ');

    const exportBtn = screen.getByRole('button', { name: /Esporta dati/i });
    await user.click(exportBtn);

    expect(mockRequestSubjectExport).toHaveBeenCalledWith({ identifier: '+393331234567' });
    // download link surfaces after success
    expect(await screen.findByRole('link', { name: /Scarica archivio ZIP/i })).toBeInTheDocument();
  });

  it('opens the erasure confirmation dialog when "Cancella dati" is clicked', async () => {
    const user = userEvent.setup();
    render(<ComplianceSettingsClient canErase={true} initialHistory={[]} />);

    const input = screen.getByLabelText(/Telefono o email/i);
    await user.type(input, '+393331234567');

    const eraseBtn = screen.getByRole('button', { name: /Cancella dati/i });
    await user.click(eraseBtn);

    expect(await screen.findByRole('heading', { name: /Conferma cancellazione GDPR/i })).toBeInTheDocument();
  });

  it('renders documentation links pointing at /legal/*', () => {
    render(<ComplianceSettingsClient canErase={false} initialHistory={[]} />);
    const dpaLink = screen.getByRole('link', { name: /Accordo sul Trattamento/i });
    expect(dpaLink).toHaveAttribute('href', '/legal/dpa');
    const privacyLink = screen.getByRole('link', { name: /Informativa sulla privacy/i });
    expect(privacyLink).toHaveAttribute('href', '/legal/privacy');
    const rpoLink = screen.getByRole('link', { name: /Certificato di conformità RPO/i });
    expect(rpoLink).toHaveAttribute('href', '/legal/rpo-compliance');
  });
});

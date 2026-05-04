import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockListContacts = vi.fn();
const mockSendInngestEvent = vi.fn().mockResolvedValue(undefined);
const mockRecordAudit = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/services/contacts', () => ({
  listContacts: (...args: unknown[]) => mockListContacts(...args),
}));

vi.mock('@/lib/inngest/client', () => ({
  sendInngestEvent: (...args: unknown[]) => mockSendInngestEvent(...args),
}));

vi.mock('@/lib/db/audit', () => ({
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

vi.mock('@/lib/db/context', () => ({
  withOrgContext: vi.fn(async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
    return fn({});
  }),
}));

const mockUpload = vi.fn();
const mockCreateSignedUrl = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    storage: {
      from: vi.fn(() => ({
        upload: mockUpload,
        createSignedUrl: mockCreateSignedUrl,
      })),
    },
  },
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makeContact = (phone: string, overrides = {}) => ({
  id: `contact-${phone}`,
  org_id: 'org-1',
  contact_list_id: 'list-1',
  phone_e164: phone,
  first_name: 'Mario',
  last_name: 'Rossi',
  email: 'mario@example.com',
  consent_basis: 'consent' as const,
  consent_evidence: null,
  contact_type: 'b2c' as const,
  rpo_status: 'unchecked' as const,
  rpo_checked_at: null,
  opt_out: false,
  opt_out_reason: null,
  metadata: null,
  created_at: new Date('2024-01-01'),
  deleted_at: null,
  ...overrides,
});

const exportData = {
  orgId: 'org-1',
  exportId: 'export-uuid-1',
  requestedByUserId: 'user-1',
  filters: {},
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('collectAllContacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all contacts from a single page', async () => {
    const contacts = [makeContact('+393401234567')];
    mockListContacts.mockResolvedValueOnce({ items: contacts, nextCursor: undefined });

    const { collectAllContacts } = await import('./export');
    const result = await collectAllContacts('org-1', {});

    expect(result).toHaveLength(1);
    expect(result[0]?.phone_e164).toBe('+393401234567');
    expect(mockListContacts).toHaveBeenCalledTimes(1);
  });

  it('paginates through multiple pages until no cursor', async () => {
    const page1 = [makeContact('+393401111111'), makeContact('+393402222222')];
    const page2 = [makeContact('+393403333333')];

    mockListContacts
      .mockResolvedValueOnce({ items: page1, nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ items: page2, nextCursor: undefined });

    const { collectAllContacts } = await import('./export');
    const result = await collectAllContacts('org-1', {});

    expect(result).toHaveLength(3);
    expect(mockListContacts).toHaveBeenCalledTimes(2);
    expect(mockListContacts).toHaveBeenNthCalledWith(2, 'org-1', {}, {
      limit: 1000,
      cursor: 'cursor-1',
    });
  });

  it('passes filters to listContacts', async () => {
    mockListContacts.mockResolvedValueOnce({ items: [], nextCursor: undefined });

    const { collectAllContacts } = await import('./export');
    await collectAllContacts('org-1', { listId: 'list-1', optOut: false, search: 'Mario' });

    expect(mockListContacts).toHaveBeenCalledWith(
      'org-1',
      { listId: 'list-1', optOut: false, search: 'Mario' },
      { limit: 1000, cursor: undefined },
    );
  });
});

describe('contactsToCsv', () => {
  it('generates a CSV with the correct headers', async () => {
    const { contactsToCsv } = await import('./export');
    const csv = contactsToCsv([makeContact('+393401234567')]);

    expect(csv).toContain('phone_e164');
    expect(csv).toContain('first_name');
    expect(csv).toContain('last_name');
    expect(csv).toContain('email');
    expect(csv).toContain('opt_out');
    expect(csv).toContain('rpo_status');
    expect(csv).toContain('consent_basis');
    expect(csv).toContain('contact_type');
    expect(csv).toContain('created_at');
  });

  it('includes contact data in output', async () => {
    const { contactsToCsv } = await import('./export');
    const csv = contactsToCsv([makeContact('+393401234567')]);

    expect(csv).toContain('+393401234567');
    expect(csv).toContain('Mario');
    expect(csv).toContain('Rossi');
    expect(csv).toContain('mario@example.com');
    expect(csv).toContain('no'); // opt_out=false
  });

  it('encodes opt_out=true as "yes"', async () => {
    const { contactsToCsv } = await import('./export');
    const csv = contactsToCsv([makeContact('+393401234567', { opt_out: true })]);

    expect(csv).toContain('yes');
  });

  it('returns empty string for empty input', async () => {
    const { contactsToCsv } = await import('./export');
    const csv = contactsToCsv([]);

    // papaparse returns empty string when given an empty array
    expect(csv).toBe('');
  });
});

describe('processContactsExport', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockListContacts.mockResolvedValue({ items: [makeContact('+393401234567')], nextCursor: undefined });
    mockUpload.mockResolvedValue({ data: {}, error: null });
    mockCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://example.com/signed' },
      error: null,
    });
  });

  it('collects contacts and uploads a CSV', async () => {
    const { processContactsExport } = await import('./export');
    await processContactsExport(exportData);

    expect(mockUpload).toHaveBeenCalledWith(
      'org-1/exports/contacts-export-uuid-1.csv',
      expect.any(String),
      expect.objectContaining({ contentType: 'text/csv' }),
    );
  });

  it('returns the completed summary with row count', async () => {
    const { processContactsExport } = await import('./export');
    const result = await processContactsExport(exportData);

    expect(result).toMatchObject({
      orgId: 'org-1',
      exportId: 'export-uuid-1',
      storagePath: 'org-1/exports/contacts-export-uuid-1.csv',
      rowCount: 1,
      status: 'completed',
    });
  });

  it('records an audit log entry with row count', async () => {
    const { processContactsExport } = await import('./export');
    await processContactsExport(exportData);

    expect(mockRecordAudit).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        orgId: 'org-1',
        actorUserId: 'user-1',
        actorType: 'user',
        action: 'contact_list.export_completed',
        subjectId: 'export-uuid-1',
        metadata: expect.objectContaining({ rowCount: 1 }),
      }),
    );
  });

  it('emits contacts/export-completed event', async () => {
    const { processContactsExport } = await import('./export');
    await processContactsExport(exportData);

    expect(mockSendInngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'contacts/export-completed',
        id: 'contacts-export-completed-export-uuid-1',
        data: expect.objectContaining({
          orgId: 'org-1',
          exportId: 'export-uuid-1',
          rowCount: 1,
          status: 'completed',
        }),
      }),
    );
  });

  it('throws when upload fails', async () => {
    mockUpload.mockResolvedValue({ data: null, error: { message: 'storage error' } });

    const { processContactsExport } = await import('./export');
    await expect(processContactsExport(exportData)).rejects.toThrow('Failed to upload export CSV');
  });

  it('passes filters to collectAllContacts / listContacts', async () => {
    const { processContactsExport } = await import('./export');
    await processContactsExport({
      ...exportData,
      filters: { listId: 'list-1', optOut: false },
    });

    expect(mockListContacts).toHaveBeenCalledWith(
      'org-1',
      { listId: 'list-1', optOut: false },
      expect.objectContaining({ limit: 1000 }),
    );
  });

  it('handles zero contacts gracefully', async () => {
    mockListContacts.mockResolvedValue({ items: [], nextCursor: undefined });

    const { processContactsExport } = await import('./export');
    const result = await processContactsExport(exportData);

    expect(result.rowCount).toBe(0);
    expect(result.status).toBe('completed');
  });
});

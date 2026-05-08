import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@/lib/env', () => ({
  env: {
    CONTACTS_MAX_ROWS_PER_ORG: 1_000_000,
  },
}));

const mockUpdateListImportStatus = vi.fn().mockResolvedValue(undefined);
const mockUpdateListCounts = vi.fn().mockResolvedValue(undefined);
const mockBulkUpsertContacts = vi.fn();
const mockCountContactsForOrg = vi.fn().mockResolvedValue(0);
const mockParseContactsCsv = vi.fn();
const mockSendInngestEvent = vi.fn().mockResolvedValue(undefined);
const mockRecordAudit = vi.fn().mockResolvedValue(undefined);
const mockBulkMarkOptOut = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/services/optout', () => ({
  bulkMarkOptOut: (...args: unknown[]) => mockBulkMarkOptOut(...args),
}));

vi.mock('@/lib/services/contact_lists', () => ({
  updateListImportStatus: (...args: unknown[]) => mockUpdateListImportStatus(...args),
  updateListCounts: (...args: unknown[]) => mockUpdateListCounts(...args),
}));

vi.mock('@/lib/services/contacts', () => ({
  bulkUpsertContacts: (...args: unknown[]) => mockBulkUpsertContacts(...args),
  countContactsForOrg: (...args: unknown[]) => mockCountContactsForOrg(...args),
}));

vi.mock('@/lib/services/csv', () => ({
  parseContactsCsv: (...args: unknown[]) => mockParseContactsCsv(...args),
}));

vi.mock('@/lib/inngest/client', () => ({
  sendInngestEvent: (...args: unknown[]) => mockSendInngestEvent(...args),
}));

vi.mock('@/lib/db/audit', () => ({
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

// Storage mock
const mockDownload = vi.fn();
const mockUpload = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    storage: {
      from: vi.fn(() => ({
        download: mockDownload,
        upload: mockUpload,
      })),
    },
  },
}));

// DB context mocks — opt-out, RPO snapshot, and RPO batch-check queries
const mockTx = {
  select: vi.fn(),
  selectDistinct: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  execute: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@/lib/db/context', () => ({
  withOrgContext: vi.fn(async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
  withSystemContext: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
}));

// RPO client mock — see plan 11 task 3
const mockRpoBulkCheck = vi.fn();
const mockGetRpoClient = vi.fn(() => ({
  bulkCheck: (...args: unknown[]) => mockRpoBulkCheck(...args),
  singleCheck: vi.fn(),
}));

vi.mock('@/lib/compliance/rpo/client', () => ({
  getRpoClient: () => mockGetRpoClient(),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const validRow = {
  org_id: 'org-1',
  contact_list_id: 'list-1',
  phone_e164: '+393401234567',
  first_name: 'Mario',
  last_name: 'Rossi',
  email: null,
  consent_basis: 'consent' as const,
  contact_type: 'b2c' as const,
  metadata: null,
};

const baseParseResult = {
  totalRows: 2,
  validRows: [validRow],
  invalidRows: [{ rowIndex: 1, raw: { telefono: 'not-a-phone' }, errors: ['Invalid phone'] }],
  detectedColumns: { phone: 'telefono' },
};

const importData = {
  orgId: 'org-1',
  listId: 'list-1',
  storagePath: 'org-1/uploads/abc-file.csv',
  consentBasis: 'consent' as const,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('processContactsImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: CSV download succeeds
    const fakeBlob = new Blob(['telefono\n3401234567\nnot-a-phone']);
    mockDownload.mockResolvedValue({ data: fakeBlob, error: null });
    mockUpload.mockResolvedValue({ data: {}, error: null });

    // Default parse result: 1 valid, 1 invalid
    mockParseContactsCsv.mockResolvedValue(baseParseResult);

    // Default upsert result
    mockBulkUpsertContacts.mockResolvedValue({
      insertedCount: 1,
      updatedCount: 0,
      skippedCount: 0,
    });

    // Default: no opt-outs, no RPO records
    mockTx.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    });

    // Default: no newly-inserted phones requiring an RPO batch check
    mockTx.selectDistinct.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    });

    // Default insert/update chains — used by the RPO batch-check step
    mockTx.insert.mockReturnValue({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      })),
    });
    mockTx.update.mockReturnValue({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(undefined),
      })),
    });

    // Default RPO client: returns no blocked numbers
    mockRpoBulkCheck.mockResolvedValue(new Map());
    mockGetRpoClient.mockImplementation(() => ({
      bulkCheck: (...args: unknown[]) => mockRpoBulkCheck(...args),
      singleCheck: vi.fn(),
    }));
  });

  it('sets status to parsing at the start', async () => {
    const { processContactsImport } = await import('./import');
    await processContactsImport(importData);

    expect(mockUpdateListImportStatus).toHaveBeenCalledWith('org-1', 'list-1', 'parsing');
  });

  it('downloads the CSV file from supabase storage', async () => {
    const { processContactsImport } = await import('./import');
    await processContactsImport(importData);

    expect(mockDownload).toHaveBeenCalledOnce();
  });

  it('throws when the download fails', async () => {
    mockDownload.mockResolvedValue({ data: null, error: { message: 'not found' } });

    const { processContactsImport } = await import('./import');

    await expect(processContactsImport(importData)).rejects.toThrow(
      'Failed to download CSV file',
    );
  });

  it('calls parseContactsCsv with correct options', async () => {
    const { processContactsImport } = await import('./import');
    await processContactsImport(importData);

    expect(mockParseContactsCsv).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        consentBasis: 'consent',
        sourceListId: 'list-1',
        orgId: 'org-1',
      }),
    );
  });

  it('stores errors artifact when there are invalid rows', async () => {
    const { processContactsImport } = await import('./import');
    await processContactsImport(importData);

    expect(mockUpload).toHaveBeenCalledWith(
      'org-1/uploads/list-1-errors.json',
      expect.any(String),
      expect.objectContaining({ contentType: 'application/json', upsert: true }),
    );
  });

  it('does not store errors artifact when all rows are valid', async () => {
    mockParseContactsCsv.mockResolvedValue({
      ...baseParseResult,
      invalidRows: [],
    });

    const { processContactsImport } = await import('./import');
    await processContactsImport(importData);

    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('marks opted-out contacts before upserting', async () => {
    mockTx.select
      .mockReturnValueOnce({
        // opt-out query: phone is opted out
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([{ phone_e164: '+393401234567' }]),
        })),
      })
      .mockReturnValue({
        // rpo query: not found
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([]),
        })),
      });

    const { processContactsImport } = await import('./import');
    await processContactsImport(importData);

    const [, upsertedRows] = mockBulkUpsertContacts.mock.calls[0] as [string, unknown[]];
    expect(upsertedRows).toHaveLength(1);
    expect((upsertedRows as Array<{ opt_out: boolean }>)[0]?.opt_out).toBe(true);
  });

  it('sets rpo_status=blocked when RPO snapshot shows is_blocked=true', async () => {
    mockTx.select
      .mockReturnValueOnce({
        // opt-out query: none
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([]),
        })),
      })
      .mockReturnValue({
        // rpo query: blocked
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([{ phone_e164: '+393401234567', is_blocked: true }]),
        })),
      });

    const { processContactsImport } = await import('./import');
    await processContactsImport(importData);

    const [, upsertedRows] = mockBulkUpsertContacts.mock.calls[0] as [string, unknown[]];
    expect((upsertedRows as Array<{ rpo_status: string }>)[0]?.rpo_status).toBe('blocked');
  });

  it('sets rpo_status=clear when RPO snapshot shows is_blocked=false', async () => {
    mockTx.select
      .mockReturnValueOnce({
        from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
      })
      .mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([{ phone_e164: '+393401234567', is_blocked: false }]),
        })),
      });

    const { processContactsImport } = await import('./import');
    await processContactsImport(importData);

    const [, upsertedRows] = mockBulkUpsertContacts.mock.calls[0] as [string, unknown[]];
    expect((upsertedRows as Array<{ rpo_status: string }>)[0]?.rpo_status).toBe('clear');
  });

  it('sets rpo_status=unchecked when phone is not in RPO snapshots', async () => {
    const { processContactsImport } = await import('./import');
    await processContactsImport(importData);

    const [, upsertedRows] = mockBulkUpsertContacts.mock.calls[0] as [string, unknown[]];
    expect((upsertedRows as Array<{ rpo_status: string }>)[0]?.rpo_status).toBe('unchecked');
  });

  it('skips bulk upsert when there are no valid rows', async () => {
    mockParseContactsCsv.mockResolvedValue({
      ...baseParseResult,
      validRows: [],
      totalRows: 1,
    });

    const { processContactsImport } = await import('./import');
    await processContactsImport(importData);

    expect(mockBulkUpsertContacts).not.toHaveBeenCalled();
  });

  it('updates list counts with parsed totals', async () => {
    const { processContactsImport } = await import('./import');
    await processContactsImport(importData);

    expect(mockUpdateListCounts).toHaveBeenCalledWith('org-1', 'list-1', 2, 1);
  });

  it('sets import_status=completed when there are valid rows', async () => {
    const { processContactsImport } = await import('./import');
    await processContactsImport(importData);

    const calls = mockUpdateListImportStatus.mock.calls;
    const lastCall = calls[calls.length - 1] as [string, string, string];
    expect(lastCall[2]).toBe('completed');
  });

  it('sets import_status=failed when there are no valid rows', async () => {
    mockParseContactsCsv.mockResolvedValue({
      ...baseParseResult,
      validRows: [],
      totalRows: 2,
    });

    const { processContactsImport } = await import('./import');
    await processContactsImport(importData);

    const calls = mockUpdateListImportStatus.mock.calls;
    const lastCall = calls[calls.length - 1] as [string, string, string];
    expect(lastCall[2]).toBe('failed');
  });

  it('records an audit log entry with import totals', async () => {
    const { processContactsImport } = await import('./import');
    await processContactsImport(importData);

    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        orgId: 'org-1',
        actorType: 'system',
        action: 'contact_list.import_completed',
        subjectType: 'contact_list',
        subjectId: 'list-1',
        metadata: expect.objectContaining({
          totalRows: 2,
          validRows: 1,
          invalidRows: 1,
        }),
      }),
    );
  });

  it('emits contacts/import-completed event with correct data', async () => {
    const { processContactsImport } = await import('./import');
    await processContactsImport(importData);

    expect(mockSendInngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'contacts/import-completed',
        id: 'contacts-import-completed-list-1',
        data: expect.objectContaining({
          orgId: 'org-1',
          listId: 'list-1',
          totalRows: 2,
          validRows: 1,
          invalidRows: 1,
          status: 'completed',
        }),
      }),
    );
  });

  it('returns the completed data summary', async () => {
    mockBulkUpsertContacts.mockResolvedValue({
      insertedCount: 1,
      updatedCount: 0,
      skippedCount: 0,
    });

    const { processContactsImport } = await import('./import');
    const result = await processContactsImport(importData);

    expect(result).toEqual({
      orgId: 'org-1',
      listId: 'list-1',
      totalRows: 2,
      validRows: 1,
      invalidRows: 1,
      insertedCount: 1,
      updatedCount: 0,
      status: 'completed',
    });
  });

  it('passes columnMapping to parseContactsCsv when provided', async () => {
    const { processContactsImport } = await import('./import');
    await processContactsImport({
      ...importData,
      columnMapping: { phone: 'tel', firstName: 'nome' },
    });

    expect(mockParseContactsCsv).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        columnMapping: { phone: 'tel', firstName: 'nome' },
      }),
    );
  });

  it('passes contactType to parseContactsCsv when provided', async () => {
    const { processContactsImport } = await import('./import');
    await processContactsImport({ ...importData, contactType: 'b2b' });

    expect(mockParseContactsCsv).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ contactType: 'b2b' }),
    );
  });

  it('continues import even when storing errors artifact fails', async () => {
    mockUpload.mockResolvedValue({ data: null, error: { message: 'storage error' } });

    const { processContactsImport } = await import('./import');
    // Should not throw
    const result = await processContactsImport(importData);
    expect(result.status).toBe('completed');
  });

  it('throws and marks import failed when org contact limit is exceeded', async () => {
    // Simulate org already at the cap
    mockCountContactsForOrg.mockResolvedValue(1_000_000);

    const { processContactsImport } = await import('./import');
    await expect(processContactsImport(importData)).rejects.toThrow(
      'org_contact_limit_exceeded',
    );

    const calls = mockUpdateListImportStatus.mock.calls;
    const failCall = calls.find((c) => c[2] === 'failed');
    expect(failCall).toBeDefined();
  });

  it('checks org count before bulk upsert when valid rows exist', async () => {
    // Org has 0 contacts; cap not exceeded
    mockCountContactsForOrg.mockResolvedValue(0);

    const { processContactsImport } = await import('./import');
    await processContactsImport(importData);

    expect(mockCountContactsForOrg).toHaveBeenCalledWith('org-1');
    expect(mockBulkUpsertContacts).toHaveBeenCalledOnce();
  });

  // ── Plan 11 Task 3: live RPO batch-check after upsert ──────────────────────

  it('does not invoke RPO bulkCheck when no newly-inserted unchecked B2C contacts exist', async () => {
    const { processContactsImport } = await import('./import');
    await processContactsImport(importData);

    expect(mockRpoBulkCheck).not.toHaveBeenCalled();
  });

  it('calls RPO bulkCheck with newly-inserted unchecked B2C phone numbers', async () => {
    mockTx.selectDistinct.mockReturnValueOnce({
      from: vi.fn(() => ({
        where: vi
          .fn()
          .mockResolvedValue([{ phone_e164: '+393401234567' }, { phone_e164: '+393409876543' }]),
      })),
    });

    const { processContactsImport } = await import('./import');
    await processContactsImport(importData);

    expect(mockRpoBulkCheck).toHaveBeenCalledOnce();
    expect(mockRpoBulkCheck).toHaveBeenCalledWith(['+393401234567', '+393409876543']);
  });

  it('upserts rpo_snapshots for the checked numbers', async () => {
    mockTx.selectDistinct.mockReturnValueOnce({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ phone_e164: '+393401234567' }]),
      })),
    });
    mockRpoBulkCheck.mockResolvedValue(new Map([['+393401234567', false]]));

    const valuesSpy = vi.fn((_values: unknown) => ({
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    }));
    mockTx.insert.mockReturnValueOnce({ values: valuesSpy });

    const { processContactsImport } = await import('./import');
    await processContactsImport(importData);

    expect(valuesSpy).toHaveBeenCalledOnce();
    const valuesArg = valuesSpy.mock.calls[0]![0] as unknown as Array<{
      phone_e164: string;
      is_blocked: boolean;
      last_checked_at: Date;
    }>;
    expect(valuesArg).toHaveLength(1);
    expect(valuesArg[0]?.phone_e164).toBe('+393401234567');
    expect(valuesArg[0]?.is_blocked).toBe(false);
    expect(valuesArg[0]?.last_checked_at).toBeInstanceOf(Date);
  });

  it('updates contacts.rpo_status=blocked for blocked numbers', async () => {
    mockTx.selectDistinct.mockReturnValueOnce({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ phone_e164: '+393401234567' }]),
      })),
    });
    mockRpoBulkCheck.mockResolvedValue(new Map([['+393401234567', true]]));

    const setSpy = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
    mockTx.update.mockReturnValue({ set: setSpy });

    const { processContactsImport } = await import('./import');
    await processContactsImport(importData);

    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({ rpo_status: 'blocked', rpo_checked_at: expect.any(Date) }),
    );
  });

  it('enrols import-time RPO blocks in the unified opt-out registry', async () => {
    mockTx.selectDistinct.mockReturnValueOnce({
      from: vi.fn(() => ({
        where: vi
          .fn()
          .mockResolvedValue([{ phone_e164: '+393401234567' }, { phone_e164: '+393409876543' }]),
      })),
    });
    mockRpoBulkCheck.mockResolvedValue(
      new Map([
        ['+393401234567', true],
        ['+393409876543', false],
      ]),
    );

    const { processContactsImport } = await import('./import');
    await processContactsImport(importData);

    expect(mockBulkMarkOptOut).toHaveBeenCalledOnce();
    expect(mockBulkMarkOptOut).toHaveBeenCalledWith(
      'org-1',
      ['+393401234567'],
      'rpo_block',
    );
  });

  it('does not enrol opt-out registry when no contacts are blocked', async () => {
    mockTx.selectDistinct.mockReturnValueOnce({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ phone_e164: '+393401234567' }]),
      })),
    });
    mockRpoBulkCheck.mockResolvedValue(new Map([['+393401234567', false]]));

    const { processContactsImport } = await import('./import');
    await processContactsImport(importData);

    expect(mockBulkMarkOptOut).not.toHaveBeenCalled();
  });

  it('updates contacts.rpo_status=clear for unblocked numbers', async () => {
    mockTx.selectDistinct.mockReturnValueOnce({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ phone_e164: '+393401234567' }]),
      })),
    });
    mockRpoBulkCheck.mockResolvedValue(new Map([['+393401234567', false]]));

    const setSpy = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
    mockTx.update.mockReturnValue({ set: setSpy });

    const { processContactsImport } = await import('./import');
    await processContactsImport(importData);

    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({ rpo_status: 'clear', rpo_checked_at: expect.any(Date) }),
    );
  });

  it('does not fail the import when RPO bulkCheck throws', async () => {
    mockTx.selectDistinct.mockReturnValueOnce({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ phone_e164: '+393401234567' }]),
      })),
    });
    mockRpoBulkCheck.mockRejectedValue(new Error('intermediary unavailable'));

    const { processContactsImport } = await import('./import');
    const result = await processContactsImport(importData);

    expect(result.status).toBe('completed');
    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        metadata: expect.objectContaining({ rpoErrors: 1 }),
      }),
    );
  });

  it('does not fail the import when getRpoClient throws (mis-configured)', async () => {
    mockGetRpoClient.mockImplementationOnce(() => {
      throw new Error('RPO_PROVIDER_ENDPOINT missing');
    });

    const { processContactsImport } = await import('./import');
    const result = await processContactsImport(importData);

    expect(result.status).toBe('completed');
    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        metadata: expect.objectContaining({ rpoSkipped: true }),
      }),
    );
    expect(mockRpoBulkCheck).not.toHaveBeenCalled();
  });

  it('records RPO totals in the audit log metadata', async () => {
    mockTx.selectDistinct.mockReturnValueOnce({
      from: vi.fn(() => ({
        where: vi
          .fn()
          .mockResolvedValue([{ phone_e164: '+393401234567' }, { phone_e164: '+393409876543' }]),
      })),
    });
    mockRpoBulkCheck.mockResolvedValue(
      new Map([
        ['+393401234567', true],
        ['+393409876543', false],
      ]),
    );

    const { processContactsImport } = await import('./import');
    await processContactsImport(importData);

    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        metadata: expect.objectContaining({
          rpoChecked: 2,
          rpoBlocked: 1,
          rpoClear: 1,
          rpoErrors: 0,
          rpoSkipped: false,
        }),
      }),
    );
  });
});

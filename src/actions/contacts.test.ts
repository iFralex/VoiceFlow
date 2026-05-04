import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockGetAuthContext,
  mockRequireCapability,
  mockSendInngestEvent,
  mockGetContactList,
  mockMarkOptOut,
  mockSoftDeleteContact,
  mockUpsertContact,
  mockListContacts,
  mockRecordAudit,
  mockWithOrgContext,
  mockContactsToCsv,
  mockCreateSignedUrl,
  mockStorageUpload,
} = vi.hoisted(() => ({
  mockGetAuthContext: vi.fn(),
  mockRequireCapability: vi.fn(),
  mockSendInngestEvent: vi.fn(),
  mockGetContactList: vi.fn(),
  mockMarkOptOut: vi.fn(),
  mockSoftDeleteContact: vi.fn(),
  mockUpsertContact: vi.fn(),
  mockListContacts: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockWithOrgContext: vi.fn(),
  mockContactsToCsv: vi.fn(),
  mockCreateSignedUrl: vi.fn(),
  mockStorageUpload: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  getAuthContext: mockGetAuthContext,
  requireCapability: mockRequireCapability,
}));

vi.mock('@/lib/inngest/client', () => ({
  sendInngestEvent: mockSendInngestEvent,
}));

vi.mock('@/lib/services/contact_lists', () => ({
  getContactList: mockGetContactList,
}));

vi.mock('@/lib/services/contacts', () => ({
  markOptOut: mockMarkOptOut,
  softDeleteContact: mockSoftDeleteContact,
  upsertContact: mockUpsertContact,
  listContacts: mockListContacts,
}));

vi.mock('@/lib/db/audit', () => ({
  recordAudit: mockRecordAudit,
}));

vi.mock('@/lib/db/context', () => ({
  withOrgContext: (...args: unknown[]) => mockWithOrgContext(...args),
}));

vi.mock('@/lib/inngest/contacts/export', () => ({
  contactsToCsv: mockContactsToCsv,
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        createSignedUrl: mockCreateSignedUrl,
        upload: mockStorageUpload,
      }),
    },
  },
}));

import {
  addManualContact,
  bulkDeleteContacts,
  bulkMarkContactsOptOut,
  deleteContact,
  exportContactsCsv,
  getContactListStatus,
  getImportErrorsUrl,
  importDncList,
  markContactOptOut,
  triggerContactsImport,
} from './contacts';

const VALID_LIST_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';
const VALID_CONTACT_ID = 'cccccccc-dddd-4eee-8fff-000000000002';
const ORG_ID = 'eeeeeeee-ffff-4000-8000-000000000001';
const USER_ID = 'user-1';

const VALID_STORAGE_PATH = `${ORG_ID}/uploads/file.csv`;

describe('triggerContactsImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthContext.mockResolvedValue({ orgId: ORG_ID, userId: USER_ID, role: 'operator' });
    mockRequireCapability.mockResolvedValue(undefined);
    mockSendInngestEvent.mockResolvedValue(undefined);
    mockGetContactList.mockResolvedValue({ id: VALID_LIST_ID, import_status: 'pending' });
  });

  it('sends an Inngest event with correct data and returns ok', async () => {
    const result = await triggerContactsImport({
      listId: VALID_LIST_ID,
      storagePath: VALID_STORAGE_PATH,
      consentBasis: 'consent',
      contactType: 'b2c',
    });

    expect(result.ok).toBe(true);
    expect(mockSendInngestEvent).toHaveBeenCalledOnce();
    expect(mockSendInngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'contacts/import-requested',
        id: `contacts-import-${VALID_LIST_ID}`,
        data: expect.objectContaining({
          orgId: ORG_ID,
          listId: VALID_LIST_ID,
          consentBasis: 'consent',
          contactType: 'b2c',
        }),
      }),
    );
  });

  it('includes consentEvidence when provided', async () => {
    await triggerContactsImport({
      listId: VALID_LIST_ID,
      storagePath: VALID_STORAGE_PATH,
      consentBasis: 'legitimate_interest',
      consentEvidence: 'Newsletter signup',
    });

    expect(mockSendInngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ consentEvidence: 'Newsletter signup' }),
      }),
    );
  });

  it('includes columnMapping when provided', async () => {
    await triggerContactsImport({
      listId: VALID_LIST_ID,
      storagePath: VALID_STORAGE_PATH,
      consentBasis: 'consent',
      columnMapping: { phone: 'tel', firstName: 'nome' },
    });

    expect(mockSendInngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          columnMapping: expect.objectContaining({ phone: 'tel', firstName: 'nome' }),
        }),
      }),
    );
  });

  it('returns error when listId is not a valid UUID', async () => {
    const result = await triggerContactsImport({
      listId: 'not-a-uuid',
      storagePath: VALID_STORAGE_PATH,
      consentBasis: 'consent',
    });

    expect(result.ok).toBe(false);
    expect(mockSendInngestEvent).not.toHaveBeenCalled();
  });

  it('returns error when storagePath is empty', async () => {
    const result = await triggerContactsImport({
      listId: VALID_LIST_ID,
      storagePath: '',
      consentBasis: 'consent',
    });

    expect(result.ok).toBe(false);
    expect(mockSendInngestEvent).not.toHaveBeenCalled();
  });

  it('returns error when storagePath does not belong to calling org', async () => {
    const result = await triggerContactsImport({
      listId: VALID_LIST_ID,
      storagePath: 'other-org-id/uploads/file.csv',
      consentBasis: 'consent',
    });

    expect(result.ok).toBe(false);
    expect(result.message).toBe('storage_path_forbidden');
    expect(mockSendInngestEvent).not.toHaveBeenCalled();
  });

  it('returns error when list does not belong to calling org', async () => {
    mockGetContactList.mockResolvedValue(null);

    const result = await triggerContactsImport({
      listId: VALID_LIST_ID,
      storagePath: VALID_STORAGE_PATH,
      consentBasis: 'consent',
    });

    expect(result.ok).toBe(false);
    expect(result.message).toBe('list_not_found');
    expect(mockSendInngestEvent).not.toHaveBeenCalled();
  });

  it('returns error when sendInngestEvent throws', async () => {
    mockSendInngestEvent.mockRejectedValueOnce(new Error('Network error'));

    const result = await triggerContactsImport({
      listId: VALID_LIST_ID,
      storagePath: VALID_STORAGE_PATH,
      consentBasis: 'consent',
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ ok: false, message: 'Network error' });
  });
});

describe('getContactListStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthContext.mockResolvedValue({ orgId: ORG_ID, userId: USER_ID });
  });

  it('returns list status when list exists', async () => {
    mockGetContactList.mockResolvedValue({
      id: VALID_LIST_ID,
      import_status: 'parsing',
      total_count: 100,
      valid_count: 90,
    });

    const result = await getContactListStatus(VALID_LIST_ID);
    expect(result.ok).toBe(true);
    expect(result.status).toBe('parsing');
    expect(result.totalCount).toBe(100);
    expect(result.validCount).toBe(90);
  });

  it('returns error when list not found', async () => {
    mockGetContactList.mockResolvedValue(null);

    const result = await getContactListStatus(VALID_LIST_ID);
    expect(result.ok).toBe(false);
    expect(result.message).toBe('list_not_found');
  });
});

describe('markContactOptOut', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthContext.mockResolvedValue({ orgId: ORG_ID, userId: USER_ID });
    mockRequireCapability.mockResolvedValue(undefined);
    mockMarkOptOut.mockResolvedValue(undefined);
  });

  it('marks contact as opted out', async () => {
    const result = await markContactOptOut({
      contactId: VALID_CONTACT_ID,
      phoneE164: '+393401234567',
    });

    expect(result.ok).toBe(true);
    expect(mockMarkOptOut).toHaveBeenCalledWith(ORG_ID, '+393401234567', 'dealer_input', undefined);
  });

  it('passes reason when provided', async () => {
    await markContactOptOut({
      contactId: VALID_CONTACT_ID,
      phoneE164: '+393401234567',
      reason: 'Customer request',
    });

    expect(mockMarkOptOut).toHaveBeenCalledWith(ORG_ID, '+393401234567', 'dealer_input', 'Customer request');
  });

  it('returns error when contactId is not a valid UUID', async () => {
    const result = await markContactOptOut({
      contactId: 'bad-id',
      phoneE164: '+393401234567',
    });

    expect(result.ok).toBe(false);
    expect(mockMarkOptOut).not.toHaveBeenCalled();
  });
});

describe('deleteContact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthContext.mockResolvedValue({ orgId: ORG_ID, userId: USER_ID });
    mockRequireCapability.mockResolvedValue(undefined);
    mockSoftDeleteContact.mockResolvedValue(undefined);
  });

  it('soft-deletes the contact', async () => {
    const result = await deleteContact({ contactId: VALID_CONTACT_ID });

    expect(result.ok).toBe(true);
    expect(mockSoftDeleteContact).toHaveBeenCalledWith(ORG_ID, USER_ID, VALID_CONTACT_ID);
  });

  it('returns error when contactId is invalid UUID', async () => {
    const result = await deleteContact({ contactId: 'not-uuid' });

    expect(result.ok).toBe(false);
    expect(mockSoftDeleteContact).not.toHaveBeenCalled();
  });

  it('returns error when service throws', async () => {
    mockSoftDeleteContact.mockRejectedValueOnce(new Error('contact_not_found'));

    const result = await deleteContact({ contactId: VALID_CONTACT_ID });
    expect(result.ok).toBe(false);
    expect(result.message).toBe('contact_not_found');
  });
});

describe('bulkMarkContactsOptOut', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthContext.mockResolvedValue({ orgId: ORG_ID, userId: USER_ID });
    mockRequireCapability.mockResolvedValue(undefined);
    mockMarkOptOut.mockResolvedValue(undefined);
  });

  it('calls markOptOut for each contact', async () => {
    const contacts = [
      { contactId: VALID_CONTACT_ID, phoneE164: '+393401234567' },
      { contactId: 'dddddddd-eeee-4fff-8000-000000000003', phoneE164: '+393407654321' },
    ];

    const result = await bulkMarkContactsOptOut({ contacts });
    expect(result.ok).toBe(true);
    expect(mockMarkOptOut).toHaveBeenCalledTimes(2);
  });

  it('returns error when contacts array is empty', async () => {
    const result = await bulkMarkContactsOptOut({ contacts: [] });
    expect(result.ok).toBe(false);
  });
});

describe('bulkDeleteContacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthContext.mockResolvedValue({ orgId: ORG_ID, userId: USER_ID });
    mockRequireCapability.mockResolvedValue(undefined);
    mockSoftDeleteContact.mockResolvedValue(undefined);
  });

  it('soft-deletes all provided contacts', async () => {
    const ids = [VALID_CONTACT_ID, 'dddddddd-eeee-4fff-8000-000000000003'];

    const result = await bulkDeleteContacts({ contactIds: ids });
    expect(result.ok).toBe(true);
    expect(mockSoftDeleteContact).toHaveBeenCalledTimes(2);
  });

  it('returns error when contactIds array is empty', async () => {
    const result = await bulkDeleteContacts({ contactIds: [] });
    expect(result.ok).toBe(false);
  });
});

describe('getImportErrorsUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthContext.mockResolvedValue({ orgId: ORG_ID, userId: USER_ID });
  });

  it('returns signed URL when file exists', async () => {
    mockCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://example.com/signed-url' },
      error: null,
    });

    const result = await getImportErrorsUrl(VALID_LIST_ID);
    expect(result.ok).toBe(true);
    expect(result.url).toBe('https://example.com/signed-url');
  });

  it('returns error when file not found', async () => {
    mockCreateSignedUrl.mockResolvedValue({
      data: null,
      error: new Error('Not found'),
    });

    const result = await getImportErrorsUrl(VALID_LIST_ID);
    expect(result.ok).toBe(false);
  });
});

describe('exportContactsCsv', () => {
  const makeContact = (phone: string) => ({
    id: `c-${phone}`,
    org_id: ORG_ID,
    contact_list_id: VALID_LIST_ID,
    phone_e164: phone,
    first_name: 'Mario',
    last_name: 'Rossi',
    email: null,
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
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthContext.mockResolvedValue({ orgId: ORG_ID, userId: USER_ID, role: 'operator' });
    mockRequireCapability.mockResolvedValue(undefined);
    mockSendInngestEvent.mockResolvedValue(undefined);
    mockRecordAudit.mockResolvedValue(undefined);
    mockWithOrgContext.mockImplementation(async (_orgId: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({}));

    // Default: 3 contacts, fits inline limit
    mockListContacts.mockResolvedValue({
      items: [makeContact('+393401111111'), makeContact('+393402222222'), makeContact('+393403333333')],
      nextCursor: undefined,
    });
    mockContactsToCsv.mockReturnValue('phone_e164,first_name\n+393401111111,Mario');
    mockStorageUpload.mockResolvedValue({ data: {}, error: null });
    mockCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://example.com/export.csv' },
      error: null,
    });
  });

  it('returns a signed URL for inline export (<= 10k rows)', async () => {
    const result = await exportContactsCsv({});

    expect(result.ok).toBe(true);
    expect(result.url).toBe('https://example.com/export.csv');
    expect(result.deferred).toBeUndefined();
  });

  it('uploads the CSV to correct storage path', async () => {
    await exportContactsCsv({});

    expect(mockStorageUpload).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^${ORG_ID}/exports/contacts-.*\\.csv$`)),
      expect.any(String),
      expect.objectContaining({ contentType: 'text/csv' }),
    );
  });

  it('records an audit log entry', async () => {
    await exportContactsCsv({});

    expect(mockWithOrgContext).toHaveBeenCalled();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        orgId: ORG_ID,
        actorUserId: USER_ID,
        actorType: 'user',
        action: 'contact_list.export_completed',
      }),
    );
  });

  it('defers to Inngest when there are more than inline limit rows', async () => {
    // Simulate nextCursor being set (more rows exist)
    mockListContacts.mockResolvedValue({
      items: Array.from({ length: 100 }, (_, i) => makeContact(`+3934000000${i.toString().padStart(2, '0')}`)),
      nextCursor: 'some-cursor',
    });

    const result = await exportContactsCsv({});

    expect(result.ok).toBe(true);
    expect(result.deferred).toBe(true);
    expect(result.exportId).toBeDefined();
    expect(mockSendInngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'contacts/export-requested' }),
    );
    expect(mockStorageUpload).not.toHaveBeenCalled();
  });

  it('records audit entry for deferred export too', async () => {
    mockListContacts.mockResolvedValue({
      items: [makeContact('+393401111111')],
      nextCursor: 'some-cursor',
    });

    await exportContactsCsv({});

    expect(mockRecordAudit).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        action: 'contact_list.export_requested',
        metadata: expect.objectContaining({ deferred: true }),
      }),
    );
  });

  it('passes listId filter to listContacts', async () => {
    await exportContactsCsv({ listId: VALID_LIST_ID });

    expect(mockListContacts).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({ listId: VALID_LIST_ID }),
      expect.any(Object),
    );
  });

  it('returns error when upload fails', async () => {
    mockStorageUpload.mockResolvedValue({ data: null, error: { message: 'storage error' } });

    const result = await exportContactsCsv({});
    expect(result.ok).toBe(false);
  });

  it('returns error when signing URL fails', async () => {
    mockCreateSignedUrl.mockResolvedValue({ data: null, error: { message: 'sign error' } });

    const result = await exportContactsCsv({});
    expect(result.ok).toBe(false);
  });
});

describe('addManualContact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthContext.mockResolvedValue({ orgId: ORG_ID, userId: USER_ID });
    mockRequireCapability.mockResolvedValue(undefined);
    mockUpsertContact.mockResolvedValue({ inserted: true });
  });

  it('returns ok with inserted=true when new contact is created', async () => {
    const result = await addManualContact({
      listId: VALID_LIST_ID,
      phone: '+39 340 123 4567',
      firstName: 'Mario',
      consentBasis: 'consent',
      contactType: 'b2c',
    });

    expect(result.ok).toBe(true);
    expect(result.inserted).toBe(true);
    expect(mockUpsertContact).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({
        phone_e164: '+393401234567',
        first_name: 'Mario',
        contact_list_id: VALID_LIST_ID,
      }),
    );
  });

  it('returns ok with inserted=false when contact already exists', async () => {
    mockUpsertContact.mockResolvedValue({ inserted: false });

    const result = await addManualContact({
      listId: VALID_LIST_ID,
      phone: '+393401234567',
      consentBasis: 'consent',
    });

    expect(result.ok).toBe(true);
    expect(result.inserted).toBe(false);
  });

  it('returns error when phone number is invalid', async () => {
    const result = await addManualContact({
      listId: VALID_LIST_ID,
      phone: 'not-a-phone',
      consentBasis: 'consent',
    });

    expect(result.ok).toBe(false);
    expect(result.message).toBe('phone_invalid');
    expect(mockUpsertContact).not.toHaveBeenCalled();
  });

  it('returns error when listId is invalid UUID', async () => {
    const result = await addManualContact({
      listId: 'bad-uuid',
      phone: '+393401234567',
      consentBasis: 'consent',
    });

    expect(result.ok).toBe(false);
    expect(mockUpsertContact).not.toHaveBeenCalled();
  });

  it('treats empty string email as undefined', async () => {
    await addManualContact({
      listId: VALID_LIST_ID,
      phone: '+393401234567',
      email: '',
      consentBasis: 'consent',
    });

    expect(mockUpsertContact).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({ email: null }),
    );
  });

  it('returns error when service throws', async () => {
    mockUpsertContact.mockRejectedValueOnce(new Error('upsert_failed'));

    const result = await addManualContact({
      listId: VALID_LIST_ID,
      phone: '+393401234567',
      consentBasis: 'consent',
    });

    expect(result.ok).toBe(false);
    expect(result.message).toBe('upsert_failed');
  });
});

describe('importDncList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthContext.mockResolvedValue({ orgId: ORG_ID, userId: USER_ID });
    mockRequireCapability.mockResolvedValue(undefined);
    mockMarkOptOut.mockResolvedValue(undefined);
  });

  it('imports valid phone numbers and returns counts', async () => {
    const csvText = 'telefono\n+393401234567\n+393407654321';
    const result = await importDncList({ csvText });

    expect(result.ok).toBe(true);
    expect(result.processedCount).toBe(2);
    expect(result.invalidCount).toBe(0);
    expect(mockMarkOptOut).toHaveBeenCalledTimes(2);
    expect(mockMarkOptOut).toHaveBeenCalledWith(ORG_ID, '+393401234567', 'dealer_input');
  });

  it('skips header rows matching common column names', async () => {
    const csvText = 'phone\n+393401234567';
    const result = await importDncList({ csvText });

    expect(result.ok).toBe(true);
    expect(result.processedCount).toBe(1);
    expect(mockMarkOptOut).toHaveBeenCalledTimes(1);
  });

  it('counts invalid phone numbers without stopping', async () => {
    const csvText = '+393401234567\nnot-a-phone\n+393407654321';
    const result = await importDncList({ csvText });

    expect(result.ok).toBe(true);
    expect(result.processedCount).toBe(2);
    expect(result.invalidCount).toBe(1);
  });

  it('returns error when csvText is empty', async () => {
    const result = await importDncList({ csvText: '' });

    expect(result.ok).toBe(false);
    expect(mockMarkOptOut).not.toHaveBeenCalled();
  });

  it('returns error when markOptOut throws', async () => {
    mockMarkOptOut.mockRejectedValueOnce(new Error('registry_error'));

    const result = await importDncList({ csvText: '+393401234567' });

    expect(result.ok).toBe(false);
    expect(result.message).toBe('registry_error');
  });
});

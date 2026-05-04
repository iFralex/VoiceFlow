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
  mockCreateSignedUrl,
} = vi.hoisted(() => ({
  mockGetAuthContext: vi.fn(),
  mockRequireCapability: vi.fn(),
  mockSendInngestEvent: vi.fn(),
  mockGetContactList: vi.fn(),
  mockMarkOptOut: vi.fn(),
  mockSoftDeleteContact: vi.fn(),
  mockCreateSignedUrl: vi.fn(),
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
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        createSignedUrl: mockCreateSignedUrl,
      }),
    },
  },
}));

import {
  bulkDeleteContacts,
  bulkMarkContactsOptOut,
  deleteContact,
  getContactListStatus,
  getImportErrorsUrl,
  markContactOptOut,
  triggerContactsImport,
} from './contacts';

const VALID_LIST_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';
const VALID_CONTACT_ID = 'cccccccc-dddd-4eee-8fff-000000000002';
const ORG_ID = 'eeeeeeee-ffff-4000-8000-000000000001';
const USER_ID = 'user-1';

describe('triggerContactsImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthContext.mockResolvedValue({ orgId: ORG_ID, userId: USER_ID, role: 'operator' });
    mockRequireCapability.mockResolvedValue(undefined);
    mockSendInngestEvent.mockResolvedValue(undefined);
  });

  it('sends an Inngest event with correct data and returns ok', async () => {
    const result = await triggerContactsImport({
      listId: VALID_LIST_ID,
      storagePath: 'org-123/uploads/file.csv',
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
      storagePath: 'org-123/uploads/file.csv',
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
      storagePath: 'org-123/uploads/file.csv',
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
      storagePath: 'path/file.csv',
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

  it('returns error when sendInngestEvent throws', async () => {
    mockSendInngestEvent.mockRejectedValueOnce(new Error('Network error'));

    const result = await triggerContactsImport({
      listId: VALID_LIST_ID,
      storagePath: 'org-123/uploads/file.csv',
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

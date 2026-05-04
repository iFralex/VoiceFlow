import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { mockGetAuthContext, mockRequireCapability, mockSendInngestEvent } = vi.hoisted(() => ({
  mockGetAuthContext: vi.fn(),
  mockRequireCapability: vi.fn(),
  mockSendInngestEvent: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  getAuthContext: mockGetAuthContext,
  requireCapability: mockRequireCapability,
}));

vi.mock('@/lib/inngest/client', () => ({
  sendInngestEvent: mockSendInngestEvent,
}));

import { triggerContactsImport } from './contacts';

const VALID_LIST_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';
const ORG_ID = 'eeeeeeee-ffff-4000-8000-000000000001';

describe('triggerContactsImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthContext.mockResolvedValue({ orgId: ORG_ID, userId: 'user-1', role: 'operator' });
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

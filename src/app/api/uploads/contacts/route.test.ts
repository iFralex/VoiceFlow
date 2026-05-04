import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockGetAuthContext,
  mockHasCapability,
  mockCreateSignedUploadUrl,
  mockCreateContactList,
} = vi.hoisted(() => {
  const mockGetAuthContext = vi.fn();
  const mockHasCapability = vi.fn();
  const mockCreateSignedUploadUrl = vi.fn();
  const mockCreateContactList = vi.fn();

  return {
    mockGetAuthContext,
    mockHasCapability,
    mockCreateSignedUploadUrl,
    mockCreateContactList,
  };
});

vi.mock('@/lib/auth/context', () => ({
  getAuthContext: mockGetAuthContext,
  hasCapability: mockHasCapability,
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        createSignedUploadUrl: mockCreateSignedUploadUrl,
      }),
    },
  },
}));

vi.mock('@/lib/services/contact_lists', () => ({
  createContactList: mockCreateContactList,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { POST } from './route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG_ID = '550e8400-e29b-41d4-a716-446655440000';
const USER_ID = '660e8400-e29b-41d4-a716-446655440001';
const LIST_ID = '770e8400-e29b-41d4-a716-446655440002';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/uploads/contacts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  filename: 'contacts.csv',
  sizeBytes: 1024,
  contentType: 'text/csv',
};

const MOCK_AUTH = { userId: USER_ID, orgId: ORG_ID, role: 'operator' as const };
const MOCK_SIGNED = { signedUrl: 'https://storage.example.com/signed-url', token: 'tok123', path: 'path' };
const MOCK_LIST = { id: LIST_ID, name: 'contacts.csv', source: 'csv-upload', import_status: 'pending' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/uploads/contacts', () => {
  beforeEach(() => {
    mockGetAuthContext.mockResolvedValue(MOCK_AUTH);
    mockHasCapability.mockReturnValue(true);
    mockCreateSignedUploadUrl.mockResolvedValue({ data: MOCK_SIGNED, error: null });
    mockCreateContactList.mockResolvedValue(MOCK_LIST);
  });

  it('returns 401 when getAuthContext throws', async () => {
    mockGetAuthContext.mockRejectedValueOnce(new Error('No auth headers'));
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorized');
  });

  it('returns 403 when user lacks contacts.upload capability', async () => {
    mockHasCapability.mockReturnValueOnce(false);
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('Forbidden');
    expect(mockCreateSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('returns 400 when body is not valid JSON', async () => {
    const req = new Request('http://localhost/api/uploads/contacts', {
      method: 'POST',
      body: 'not-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid JSON body');
  });

  it('returns 400 when contentType is not allowed', async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, contentType: 'application/pdf' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid request body');
  });

  it('returns 400 when sizeBytes exceeds 50 MB', async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, sizeBytes: 50 * 1024 * 1024 + 1 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid request body');
  });

  it('returns 400 when filename is empty', async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, filename: '' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid request body');
  });

  it('accepts application/vnd.ms-excel content type', async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, contentType: 'application/vnd.ms-excel' }));
    expect(res.status).toBe(200);
  });

  it('accepts text/plain content type', async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, contentType: 'text/plain' }));
    expect(res.status).toBe(200);
  });

  it('returns 500 when Supabase storage fails', async () => {
    mockCreateSignedUploadUrl.mockResolvedValueOnce({
      data: null,
      error: { message: 'Storage bucket not found' },
    });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to create upload URL');
  });

  it('returns 500 when createContactList throws', async () => {
    mockCreateContactList.mockRejectedValueOnce(new Error('DB error'));
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('DB error');
  });

  it('returns uploadUrl, listId, storagePath on success', async () => {
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.uploadUrl).toBe(MOCK_SIGNED.signedUrl);
    expect(json.listId).toBe(LIST_ID);
    expect(json.storagePath).toMatch(new RegExp(`^${ORG_ID}/uploads/[a-f0-9-]+-contacts\\.csv$`));
  });

  it('sanitizes filename in storagePath', async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, filename: 'my file (1).csv' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    // Spaces and parens replaced with underscores
    expect(json.storagePath).toMatch(/my_file__1_\.csv$/);
  });

  it('calls createContactList with correct arguments', async () => {
    await POST(makeRequest(VALID_BODY));
    expect(mockCreateContactList).toHaveBeenCalledWith(
      ORG_ID,
      USER_ID,
      expect.objectContaining({
        name: 'contacts.csv',
        source: 'csv-upload',
        sourceFilePath: expect.stringContaining(`${ORG_ID}/uploads/`),
      }),
    );
  });

  it('passes hasCapability check with correct role and capability', async () => {
    await POST(makeRequest(VALID_BODY));
    expect(mockHasCapability).toHaveBeenCalledWith('operator', 'contacts.upload');
  });
});

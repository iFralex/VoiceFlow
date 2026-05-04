import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockGetAuthContext, mockCreateSignedUrl, mockCreateSignedUploadUrl } = vi.hoisted(() => {
  const mockGetAuthContext = vi.fn();
  const mockCreateSignedUrl = vi.fn();
  const mockCreateSignedUploadUrl = vi.fn();

  return { mockGetAuthContext, mockCreateSignedUrl, mockCreateSignedUploadUrl };
});

vi.mock('@/lib/auth/context', () => ({
  getAuthContext: mockGetAuthContext,
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        createSignedUrl: mockCreateSignedUrl,
        createSignedUploadUrl: mockCreateSignedUploadUrl,
      }),
    },
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { getDownloadUrl, getUploadUrl } from './signed';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_ORG_ID = '660e8400-e29b-41d4-a716-446655440001';
const VALID_PATH = `${ORG_ID}/uploads/abc-file.csv`;
const SIGNED_DOWNLOAD_URL = 'https://storage.example.com/download-signed';
const SIGNED_UPLOAD_URL = 'https://storage.example.com/upload-signed';

// ---------------------------------------------------------------------------
// getDownloadUrl
// ---------------------------------------------------------------------------

describe('getDownloadUrl', () => {
  beforeEach(() => {
    mockGetAuthContext.mockResolvedValue({ userId: 'user-1', orgId: ORG_ID, role: 'operator' });
    mockCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: SIGNED_DOWNLOAD_URL },
      error: null,
    });
  });

  it('returns a signed download URL for a valid path owned by the caller org', async () => {
    const url = await getDownloadUrl(VALID_PATH, 300);
    expect(url).toBe(SIGNED_DOWNLOAD_URL);
    expect(mockCreateSignedUrl).toHaveBeenCalledWith(VALID_PATH, 300);
  });

  it('throws if the path org does not match the caller org', async () => {
    const foreignPath = `${OTHER_ORG_ID}/uploads/file.csv`;
    await expect(getDownloadUrl(foreignPath, 300)).rejects.toThrow('Forbidden');
  });

  it('throws if the path is missing an org prefix', async () => {
    await expect(getDownloadUrl('', 300)).rejects.toThrow('Invalid storage path');
  });

  it('throws if Supabase returns an error', async () => {
    mockCreateSignedUrl.mockResolvedValueOnce({
      data: null,
      error: { message: 'Object not found' },
    });
    await expect(getDownloadUrl(VALID_PATH, 300)).rejects.toThrow(
      'Failed to create download URL: Object not found',
    );
  });

  it('throws if Supabase returns neither data nor error', async () => {
    mockCreateSignedUrl.mockResolvedValueOnce({ data: null, error: null });
    await expect(getDownloadUrl(VALID_PATH, 300)).rejects.toThrow('Failed to create download URL');
  });

  it('passes ttlSeconds through to Supabase', async () => {
    await getDownloadUrl(VALID_PATH, 3600);
    expect(mockCreateSignedUrl).toHaveBeenCalledWith(VALID_PATH, 3600);
  });

  it('accepts paths with multiple sub-segments', async () => {
    const deepPath = `${ORG_ID}/exports/sub/file.csv`;
    const url = await getDownloadUrl(deepPath, 60);
    expect(url).toBe(SIGNED_DOWNLOAD_URL);
  });
});

// ---------------------------------------------------------------------------
// getUploadUrl
// ---------------------------------------------------------------------------

describe('getUploadUrl', () => {
  beforeEach(() => {
    mockGetAuthContext.mockResolvedValue({ userId: 'user-1', orgId: ORG_ID, role: 'operator' });
    mockCreateSignedUploadUrl.mockResolvedValue({
      data: { signedUrl: SIGNED_UPLOAD_URL, token: 'tok', path: VALID_PATH },
      error: null,
    });
  });

  it('returns a signed upload URL for a valid path owned by the caller org', async () => {
    const url = await getUploadUrl(VALID_PATH, 300);
    expect(url).toBe(SIGNED_UPLOAD_URL);
    expect(mockCreateSignedUploadUrl).toHaveBeenCalledWith(VALID_PATH, { upsert: false });
  });

  it('throws if the path org does not match the caller org', async () => {
    const foreignPath = `${OTHER_ORG_ID}/uploads/file.csv`;
    await expect(getUploadUrl(foreignPath, 300)).rejects.toThrow('Forbidden');
  });

  it('throws if the path is missing an org prefix', async () => {
    await expect(getUploadUrl('', 300)).rejects.toThrow('Invalid storage path');
  });

  it('throws if Supabase returns an error', async () => {
    mockCreateSignedUploadUrl.mockResolvedValueOnce({
      data: null,
      error: { message: 'Bucket not found' },
    });
    await expect(getUploadUrl(VALID_PATH, 300)).rejects.toThrow(
      'Failed to create upload URL: Bucket not found',
    );
  });

  it('throws if Supabase returns neither data nor error', async () => {
    mockCreateSignedUploadUrl.mockResolvedValueOnce({ data: null, error: null });
    await expect(getUploadUrl(VALID_PATH, 300)).rejects.toThrow('Failed to create upload URL');
  });
});

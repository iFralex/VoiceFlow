import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockGetAuthContext,
  mockRequireCapability,
  mockListAuditLog,
  mockBuildAuditLogCsv,
  mockSupabaseAdmin,
  mockUpload,
  mockCreateSignedUrl,
} = vi.hoisted(() => {
  const mockUpload = vi.fn();
  const mockCreateSignedUrl = vi.fn();
  const mockSupabaseAdmin = {
    storage: {
      from: vi.fn(() => ({
        upload: mockUpload,
        createSignedUrl: mockCreateSignedUrl,
      })),
    },
  };
  return {
    mockGetAuthContext: vi.fn(),
    mockRequireCapability: vi.fn(),
    mockListAuditLog: vi.fn(),
    mockBuildAuditLogCsv: vi.fn(),
    mockSupabaseAdmin,
    mockUpload,
    mockCreateSignedUrl,
  };
});

vi.mock('@/lib/auth/context', () => ({
  getAuthContext: mockGetAuthContext,
  requireCapability: mockRequireCapability,
}));

vi.mock('@/lib/services/audit_log', () => ({
  listAuditLog: mockListAuditLog,
  buildAuditLogCsv: mockBuildAuditLogCsv,
}));

vi.mock('@/lib/storage/signed', () => ({
  CSV_UPLOADS_BUCKET: 'csv-uploads',
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: mockSupabaseAdmin,
}));

import { exportAuditLogCsv, listAuditLogEntries } from './audit_log';

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthContext.mockResolvedValue({ orgId: ORG_ID, userId: USER_ID, role: 'admin' });
  mockRequireCapability.mockResolvedValue(undefined);
});

// ─── listAuditLogEntries ─────────────────────────────────────────────────────

describe('listAuditLogEntries', () => {
  it('returns paginated entries serialized for the wire', async () => {
    const ts = new Date('2026-05-01T10:00:00Z');
    mockListAuditLog.mockResolvedValueOnce({
      entries: [
        {
          id: '42',
          createdAt: ts,
          actorType: 'user',
          actorUserId: USER_ID,
          actorEmail: 'alice@example.com',
          action: 'compliance.gdpr_export',
          subjectType: 'contact',
          subjectId: 'subj-1',
          metadata: { foo: 'bar' },
        },
      ],
      nextCursor: null,
    });

    const result = await listAuditLogEntries({});

    expect(result.ok).toBe(true);
    expect(result.data?.entries).toHaveLength(1);
    expect(result.data?.entries[0]).toMatchObject({
      id: '42',
      createdAt: ts.toISOString(),
      actorEmail: 'alice@example.com',
      action: 'compliance.gdpr_export',
    });
    expect(result.data?.nextCursor).toBeNull();
    expect(mockRequireCapability).toHaveBeenCalledWith('audit.view');
  });

  it('forwards filters and cursor to the service', async () => {
    mockListAuditLog.mockResolvedValueOnce({ entries: [], nextCursor: null });

    await listAuditLogEntries({
      filters: {
        actionPrefix: 'compliance.',
        fromIso: '2026-04-01T00:00:00.000Z',
        toIso: '2026-05-01T23:59:59.999Z',
        actorUserId: USER_ID,
      },
      cursor: { createdAt: '2026-05-01T10:00:00.000Z', id: '100' },
      limit: 25,
    });

    const call = mockListAuditLog.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call?.['orgId']).toBe(ORG_ID);
    expect(call?.['actionPrefix']).toBe('compliance.');
    expect((call?.['from'] as Date).toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect((call?.['to'] as Date).toISOString()).toBe('2026-05-01T23:59:59.999Z');
    expect(call?.['actorUserId']).toBe(USER_ID);
    expect(call?.['cursor']).toEqual({ createdAt: '2026-05-01T10:00:00.000Z', id: '100' });
    expect(call?.['limit']).toBe(25);
  });

  it('returns ok=false when capability check throws', async () => {
    mockRequireCapability.mockRejectedValueOnce(new Error("Forbidden: role 'operator' does not have capability 'audit.view'"));

    const result = await listAuditLogEntries({});
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Forbidden/);
  });

  it('rejects bad cursor shapes via zod', async () => {
    const result = await listAuditLogEntries({
      cursor: { createdAt: 'not-a-date', id: 'abc' } as never,
    });
    expect(result.ok).toBe(false);
  });
});

// ─── exportAuditLogCsv ───────────────────────────────────────────────────────

describe('exportAuditLogCsv', () => {
  it('uploads the CSV and returns a signed URL', async () => {
    mockBuildAuditLogCsv.mockResolvedValueOnce({
      csv: 'created_at,actor_type\r\n2026-05-01T10:00:00.000Z,system',
      rowCount: 1,
      truncated: false,
    });
    mockUpload.mockResolvedValueOnce({ error: null });
    mockCreateSignedUrl.mockResolvedValueOnce({
      data: { signedUrl: 'https://storage.test/audit.csv?token=abc' },
      error: null,
    });

    const result = await exportAuditLogCsv({});

    expect(result.ok).toBe(true);
    expect(result.data?.url).toBe('https://storage.test/audit.csv?token=abc');
    expect(result.data?.rowCount).toBe(1);
    expect(result.data?.truncated).toBe(false);
    expect(mockUpload).toHaveBeenCalledTimes(1);
    const uploadArgs = mockUpload.mock.calls[0]!;
    expect(uploadArgs[0]).toMatch(new RegExp(`^${ORG_ID}/exports/audit-log-`));
    expect(uploadArgs[2]).toMatchObject({ contentType: 'text/csv; charset=utf-8' });
    expect(mockRequireCapability).toHaveBeenCalledWith('audit.view');
  });

  it('reports truncation when too many rows match', async () => {
    mockBuildAuditLogCsv.mockResolvedValueOnce({ csv: 'header', rowCount: 10000, truncated: true });
    mockUpload.mockResolvedValueOnce({ error: null });
    mockCreateSignedUrl.mockResolvedValueOnce({
      data: { signedUrl: 'https://signed' },
      error: null,
    });

    const result = await exportAuditLogCsv({});
    expect(result.ok).toBe(true);
    expect(result.data?.truncated).toBe(true);
    expect(result.data?.rowCount).toBe(10000);
  });

  it('returns ok=false when storage upload fails', async () => {
    mockBuildAuditLogCsv.mockResolvedValueOnce({ csv: 'header', rowCount: 0, truncated: false });
    mockUpload.mockResolvedValueOnce({ error: { message: 'storage offline' } });

    const result = await exportAuditLogCsv({});
    expect(result.ok).toBe(false);
    expect(result.message).toContain('storage offline');
  });

  it('returns ok=false when capability check fails', async () => {
    mockRequireCapability.mockRejectedValueOnce(new Error('Forbidden: viewer'));
    const result = await exportAuditLogCsv({});
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Forbidden/);
  });
});

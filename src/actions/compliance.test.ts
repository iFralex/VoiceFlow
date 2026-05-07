import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetAuthContext,
  mockRequireCapability,
  mockBuildSubjectExport,
  mockSendEmail,
  mockWithSystemContext,
  FakeSubjectNotFoundError,
} = vi.hoisted(() => {
  class FakeSubjectNotFoundError extends Error {
    constructor() {
      super('not found');
      this.name = 'SubjectNotFoundError';
    }
  }
  return {
    mockGetAuthContext: vi.fn(),
    mockRequireCapability: vi.fn(),
    mockBuildSubjectExport: vi.fn(),
    mockSendEmail: vi.fn(),
    mockWithSystemContext: vi.fn(),
    FakeSubjectNotFoundError,
  };
});

vi.mock('@/lib/auth/context', () => ({
  getAuthContext: mockGetAuthContext,
  requireCapability: mockRequireCapability,
}));

vi.mock('@/lib/compliance/gdpr/export', () => ({
  buildSubjectExport: mockBuildSubjectExport,
  SubjectNotFoundError: FakeSubjectNotFoundError,
}));

vi.mock('@/lib/email', () => ({
  sendEmail: mockSendEmail,
}));

vi.mock('@/lib/db/context', () => ({
  withSystemContext: (fn: (tx: unknown) => Promise<unknown>) => mockWithSystemContext(fn),
}));

vi.mock('@/lib/db/schema', () => ({
  users: { id: 'u_id', email: 'u_email', full_name: 'u_full_name' },
}));

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ type: 'eq', col, val }),
}));

import { requestSubjectExport } from './compliance';

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const USER_ID = 'user-1';
const CONTACT_ID = 'cccccccc-cccc-4ccc-8ccc-000000000001';

describe('requestSubjectExport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthContext.mockResolvedValue({ orgId: ORG_ID, userId: USER_ID, role: 'admin' });
    mockRequireCapability.mockResolvedValue(undefined);
    mockSendEmail.mockResolvedValue(undefined);
    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([{ email: 'requester@example.com', fullName: 'Mario' }]),
            }),
          }),
        }),
      };
      return fn(tx);
    });
    mockBuildSubjectExport.mockResolvedValue({
      exportId: 'export-1',
      contactId: CONTACT_ID,
      storagePath: `${ORG_ID}/exports/gdpr-${CONTACT_ID}-1.zip`,
      signedUrl: 'https://example.com/signed',
      expiresAt: new Date('2026-01-08T00:00:00Z'),
      totals: {
        calls: 2,
        appointments: 1,
        optOuts: 0,
        auditEntries: 5,
        recordingsBundled: 2,
        transcriptsBundled: 2,
      },
    });
  });

  it('rejects empty identifier', async () => {
    const r = await requestSubjectExport({ identifier: '' });
    expect(r.ok).toBe(false);
  });

  it('requires the compliance.export capability', async () => {
    mockRequireCapability.mockRejectedValueOnce(new Error("Forbidden: role 'viewer' does not have capability 'compliance.export'"));
    const r = await requestSubjectExport({ identifier: '+393331234567' });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Forbidden/);
  });

  it('builds the export, returns the signed URL, and emails the requester', async () => {
    const r = await requestSubjectExport({ identifier: '+393331234567' });

    expect(r.ok).toBe(true);
    expect(r.data?.url).toBe('https://example.com/signed');
    expect(r.data?.exportId).toBe('export-1');

    expect(mockBuildSubjectExport).toHaveBeenCalledWith({
      orgId: ORG_ID,
      identifier: '+393331234567',
      actorUserId: USER_ID,
    });

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const emailArgs = mockSendEmail.mock.calls[0]?.[0] as {
      to: string;
      subject: string;
      html: string;
    };
    expect(emailArgs.to).toBe('requester@example.com');
    expect(emailArgs.subject).toMatch(/Export dati GDPR/i);
    expect(emailArgs.html).toContain('https://example.com/signed');
  });

  it('returns subject_not_found when builder throws SubjectNotFoundError', async () => {
    mockBuildSubjectExport.mockRejectedValueOnce(new FakeSubjectNotFoundError());

    const r = await requestSubjectExport({ identifier: '+393339999999' });
    expect(r.ok).toBe(false);
    expect(r.message).toBe('subject_not_found');
  });

  it('still returns ok when email delivery fails', async () => {
    mockSendEmail.mockRejectedValueOnce(new Error('resend down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const r = await requestSubjectExport({ identifier: '+393331234567' });
    expect(r.ok).toBe(true);
    expect(r.data?.url).toBe('https://example.com/signed');

    errSpy.mockRestore();
  });
});

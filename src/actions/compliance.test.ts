import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetAuthContext,
  mockRequireCapability,
  mockBuildSubjectExport,
  mockEraseSubject,
  mockSendEmail,
  mockWithSystemContext,
  FakeSubjectNotFoundError,
  FakeErasureSubjectNotFoundError,
  FakeSubjectErasureConfirmationError,
} = vi.hoisted(() => {
  class FakeSubjectNotFoundError extends Error {
    constructor() {
      super('not found');
      this.name = 'SubjectNotFoundError';
    }
  }
  class FakeErasureSubjectNotFoundError extends Error {
    constructor() {
      super('not found');
      this.name = 'SubjectNotFoundError';
    }
  }
  class FakeSubjectErasureConfirmationError extends Error {
    constructor() {
      super('mismatch');
      this.name = 'SubjectErasureConfirmationError';
    }
  }
  return {
    mockGetAuthContext: vi.fn(),
    mockRequireCapability: vi.fn(),
    mockBuildSubjectExport: vi.fn(),
    mockEraseSubject: vi.fn(),
    mockSendEmail: vi.fn(),
    mockWithSystemContext: vi.fn(),
    FakeSubjectNotFoundError,
    FakeErasureSubjectNotFoundError,
    FakeSubjectErasureConfirmationError,
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

vi.mock('@/lib/compliance/gdpr/erase', () => ({
  eraseSubject: mockEraseSubject,
  SubjectNotFoundError: FakeErasureSubjectNotFoundError,
  SubjectErasureConfirmationError: FakeSubjectErasureConfirmationError,
}));

vi.mock('@/lib/email', () => ({
  sendEmail: mockSendEmail,
}));

vi.mock('@/lib/db/context', () => ({
  withSystemContext: (fn: (tx: unknown) => Promise<unknown>) => mockWithSystemContext(fn),
}));

vi.mock('@/lib/db/schema', () => ({
  users: { id: 'u_id', email: 'u_email', full_name: 'u_full_name' },
  auditLog: {
    id: 'al_id',
    org_id: 'al_org_id',
    actor_user_id: 'al_actor_user_id',
    action: 'al_action',
    subject_id: 'al_subject_id',
    metadata: 'al_metadata',
    created_at: 'al_created_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ type: 'eq', col, val }),
  and: (...conds: unknown[]) => ({ type: 'and', conds }),
  desc: (col: unknown) => ({ type: 'desc', col }),
  inArray: (col: unknown, vals: unknown[]) => ({ type: 'inArray', col, vals }),
  lte: (col: unknown, val: unknown) => ({ type: 'lte', col, val }),
}));

import {
  listGdprHistory,
  requestSubjectErasure,
  requestSubjectExport,
} from './compliance';

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

describe('requestSubjectErasure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthContext.mockResolvedValue({ orgId: ORG_ID, userId: USER_ID, role: 'admin' });
    mockRequireCapability.mockResolvedValue(undefined);
    mockEraseSubject.mockResolvedValue({
      contactId: CONTACT_ID,
      phoneE164: '+393331234567',
      totals: {
        callsScrubbed: 3,
        recordingsDeleted: 3,
        transcriptsDeleted: 3,
        storageErrors: 0,
      },
    });
  });

  it('rejects empty inputs', async () => {
    const r = await requestSubjectErasure({ identifier: '', confirmPhone: '+393331234567', reason: 'x' });
    expect(r.ok).toBe(false);
  });

  it('requires the compliance.erase capability', async () => {
    mockRequireCapability.mockRejectedValueOnce(new Error("Forbidden"));
    const r = await requestSubjectErasure({
      identifier: '+393331234567',
      confirmPhone: '+393331234567',
      reason: 'data subject request',
    });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Forbidden/);
  });

  it('returns ok and totals on success', async () => {
    const r = await requestSubjectErasure({
      identifier: '+393331234567',
      confirmPhone: '+393331234567',
      reason: 'data subject request',
    });
    expect(r.ok).toBe(true);
    expect(r.data?.contactId).toBe(CONTACT_ID);
    expect(r.data?.totals.callsScrubbed).toBe(3);

    expect(mockEraseSubject).toHaveBeenCalledWith({
      orgId: ORG_ID,
      byUserId: USER_ID,
      identifier: '+393331234567',
      reason: 'data subject request',
      confirmPhone: '+393331234567',
    });
  });

  it('maps SubjectNotFoundError to subject_not_found', async () => {
    mockEraseSubject.mockRejectedValueOnce(new FakeErasureSubjectNotFoundError());
    const r = await requestSubjectErasure({
      identifier: '+393339999999',
      confirmPhone: '+393339999999',
      reason: 'x',
    });
    expect(r.ok).toBe(false);
    expect(r.message).toBe('subject_not_found');
  });

  it('maps SubjectErasureConfirmationError to confirmation_mismatch', async () => {
    mockEraseSubject.mockRejectedValueOnce(new FakeSubjectErasureConfirmationError());
    const r = await requestSubjectErasure({
      identifier: '+393331234567',
      confirmPhone: '+393339999999',
      reason: 'x',
    });
    expect(r.ok).toBe(false);
    expect(r.message).toBe('confirmation_mismatch');
  });
});

describe('listGdprHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthContext.mockResolvedValue({ orgId: ORG_ID, userId: USER_ID, role: 'admin' });
    mockRequireCapability.mockResolvedValue(undefined);
  });

  /**
   * Build a fake drizzle tx that returns `auditRows` for the first
   * select+from+where chain (which then calls .orderBy().limit()) and
   * `userRows` for any subsequent select+from+where chain awaited directly.
   */
  function buildTx(auditRows: unknown[], userRows: unknown[]) {
    let callIndex = 0;
    return {
      select: () => ({
        from: () => ({
          where: () => {
            callIndex += 1;
            if (callIndex === 1) {
              return {
                orderBy: () => ({
                  limit: () => Promise.resolve(auditRows),
                }),
              };
            }
            return Promise.resolve(userRows);
          },
        }),
      }),
      _callIndex: () => callIndex,
    };
  }

  it('returns a list of audit entries with resolved actor emails', async () => {
    const auditRows = [
      {
        id: BigInt(1),
        action: 'compliance.gdpr_export',
        createdAt: new Date('2026-05-01T10:00:00Z'),
        actorUserId: 'user-1',
        subjectId: 'cccccccc-cccc-4ccc-8ccc-000000000001',
        metadata: { totals: { calls: 3 } },
      },
      {
        id: BigInt(2),
        action: 'compliance.gdpr_erasure',
        createdAt: new Date('2026-05-02T11:00:00Z'),
        actorUserId: 'user-2',
        subjectId: 'cccccccc-cccc-4ccc-8ccc-000000000002',
        metadata: { phoneE164: '+393331234567' },
      },
    ];
    const userRows = [
      { id: 'user-1', email: 'admin@example.com' },
      { id: 'user-2', email: 'owner@example.com' },
    ];
    mockWithSystemContext.mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
      fn(buildTx(auditRows, userRows)),
    );

    const r = await listGdprHistory({ limit: 10 });
    expect(r.ok).toBe(true);
    expect(r.data?.entries).toHaveLength(2);
    expect(r.data?.entries[0]?.action).toBe('compliance.gdpr_export');
    expect(r.data?.entries[0]?.actorEmail).toBe('admin@example.com');
    expect(r.data?.entries[1]?.actorEmail).toBe('owner@example.com');
  });

  it('returns an empty list and skips the actor lookup when there are no audit entries', async () => {
    const tx = buildTx([], []);
    mockWithSystemContext.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(tx));

    const r = await listGdprHistory({});
    expect(r.ok).toBe(true);
    expect(r.data?.entries).toHaveLength(0);
    expect(tx._callIndex()).toBe(1);
  });
});

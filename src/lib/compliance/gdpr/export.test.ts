import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const {
  mockWithOrgContext,
  mockWithSystemContext,
  mockRecordAudit,
  mockSupabaseAdmin,
  mockUpload,
  mockCreateSignedUrl,
  mockDownload,
} = vi.hoisted(() => {
  const mockUpload = vi.fn();
  const mockCreateSignedUrl = vi.fn();
  const mockDownload = vi.fn();
  const mockSupabaseAdmin = {
    storage: {
      from: vi.fn(() => ({
        upload: mockUpload,
        createSignedUrl: mockCreateSignedUrl,
        download: mockDownload,
      })),
    },
  };
  return {
    mockWithOrgContext: vi.fn(),
    mockWithSystemContext: vi.fn(),
    mockRecordAudit: vi.fn().mockResolvedValue(undefined),
    mockSupabaseAdmin,
    mockUpload,
    mockCreateSignedUrl,
    mockDownload,
  };
});

vi.mock('@/lib/db/context', () => ({
  withOrgContext: mockWithOrgContext,
  withSystemContext: mockWithSystemContext,
}));

vi.mock('@/lib/db/audit', () => ({
  recordAudit: mockRecordAudit,
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: mockSupabaseAdmin,
}));

vi.mock('@/lib/storage/signed', () => ({
  CSV_UPLOADS_BUCKET: 'csv-uploads',
}));

vi.mock('@/lib/voice/persistence', () => ({
  CALL_MEDIA_BUCKET: 'call-media',
}));

vi.mock('@/lib/db/schema', () => ({
  contacts: {
    org_id: 'c_org_id',
    phone_e164: 'c_phone_e164',
    email: 'c_email',
    deleted_at: 'c_deleted_at',
  },
  calls: { org_id: 'l_org_id', contact_id: 'l_contact_id' },
  appointments: { org_id: 'a_org_id', contact_id: 'a_contact_id' },
  optOutRegistry: { org_id: 'o_org_id', phone_e164: 'o_phone_e164' },
  auditLog: { org_id: 'al_org_id', subject_id: 'al_subject_id' },
}));

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  or: (...args: unknown[]) => ({ type: 'or', args }),
  eq: (col: unknown, val: unknown) => ({ type: 'eq', col, val }),
  inArray: (col: unknown, vals: unknown[]) => ({ type: 'inArray', col, vals }),
  isNull: (col: unknown) => ({ type: 'isNull', col }),
}));

// ─── Imports after mocks ─────────────────────────────────────────────────────

import { buildSubjectExport, SubjectNotFoundError } from './export';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const CONTACT_ID = 'cccccccc-cccc-4ccc-8ccc-000000000001';
const CALL_ID = 'dddddddd-dddd-4ddd-8ddd-000000000001';

interface FakeSubject {
  contact: Record<string, unknown> | null;
  callRows: Array<Record<string, unknown>>;
  apptRows: Array<Record<string, unknown>>;
  optOutRows: Array<Record<string, unknown>>;
}

function buildOrgTx(subject: FakeSubject): unknown {
  return {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        const tableId = (table as { org_id?: string }).org_id;
        const where = vi.fn((_cond: unknown) => {
          const limit = vi.fn(() => Promise.resolve(subject.contact ? [subject.contact] : []));
          if (tableId === 'c_org_id') {
            return { limit };
          }
          if (tableId === 'l_org_id') {
            return Promise.resolve(subject.callRows);
          }
          if (tableId === 'a_org_id') {
            return Promise.resolve(subject.apptRows);
          }
          if (tableId === 'o_org_id') {
            return Promise.resolve(subject.optOutRows);
          }
          return Promise.resolve([]);
        });
        return { where };
      }),
    })),
  };
}

function buildSystemTx(rows: Array<Record<string, unknown>>): unknown {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(rows)),
      })),
    })),
  };
}

function makeContact(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: CONTACT_ID,
    org_id: ORG_ID,
    contact_list_id: 'list-1',
    phone_e164: '+393331234567',
    first_name: 'Mario',
    last_name: 'Rossi',
    email: 'mario@example.com',
    consent_basis: 'consent',
    consent_evidence: null,
    contact_type: 'b2c',
    rpo_status: 'clear',
    rpo_checked_at: null,
    opt_out: false,
    opt_out_reason: null,
    metadata: null,
    created_at: new Date('2024-01-01'),
    deleted_at: null,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('buildSubjectExport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpload.mockResolvedValue({ data: { path: 'p' }, error: null });
    mockCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://example.com/signed' },
      error: null,
    });
    mockDownload.mockResolvedValue({
      data: { arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer) },
      error: null,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('throws SubjectNotFoundError when no contact matches', async () => {
    mockWithOrgContext.mockImplementation(async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn(buildOrgTx({ contact: null, callRows: [], apptRows: [], optOutRows: [] })),
    );

    await expect(
      buildSubjectExport({ orgId: ORG_ID, identifier: '+393331234567' }),
    ).rejects.toBeInstanceOf(SubjectNotFoundError);
  });

  it('uploads a ZIP, signs a 7-day URL, and writes a compliance.gdpr_export audit entry', async () => {
    const contact = makeContact();
    const call = {
      id: CALL_ID,
      org_id: ORG_ID,
      contact_id: CONTACT_ID,
      recording_path: `recordings/${ORG_ID}/${CALL_ID}.mp3`,
      transcript_path: `transcripts/${ORG_ID}/${CALL_ID}.json`,
      provider: 'vapi',
      direction: 'outbound',
      status: 'completed',
      created_at: new Date('2024-01-02'),
    };
    mockWithOrgContext.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn(
          buildOrgTx({
            contact,
            callRows: [call],
            apptRows: [],
            optOutRows: [{ id: 'opt-1', org_id: ORG_ID, phone_e164: contact['phone_e164'], source: 'dealer_input' }],
          }),
        ),
    );
    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(
        buildSystemTx([
          { id: BigInt(1), org_id: ORG_ID, action: 'contact.created', subject_id: CONTACT_ID, subject_type: 'contact' },
        ]),
      ),
    );

    const result = await buildSubjectExport({
      orgId: ORG_ID,
      identifier: '+393331234567',
      actorUserId: 'user-1',
    });

    expect(result.contactId).toBe(CONTACT_ID);
    expect(result.signedUrl).toBe('https://example.com/signed');
    expect(result.storagePath).toMatch(new RegExp(`^${ORG_ID}/exports/gdpr-${CONTACT_ID}-\\d+\\.zip$`));
    expect(result.totals).toEqual({
      calls: 1,
      appointments: 0,
      optOuts: 1,
      auditEntries: 1,
      recordingsBundled: 1,
      transcriptsBundled: 1,
    });

    // Upload was called with application/zip and upsert: true
    expect(mockUpload).toHaveBeenCalledTimes(1);
    const [uploadPath, , uploadOpts] = mockUpload.mock.calls[0]!;
    expect(uploadPath).toMatch(/\.zip$/);
    expect(uploadOpts).toMatchObject({ contentType: 'application/zip', upsert: true });

    // 7-day signed URL
    expect(mockCreateSignedUrl).toHaveBeenCalledTimes(1);
    expect(mockCreateSignedUrl.mock.calls[0]?.[1]).toBe(7 * 24 * 60 * 60);

    // Audit entry recorded with action compliance.gdpr_export
    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    const auditArgs = mockRecordAudit.mock.calls[0]?.[1] as {
      action: string;
      subjectType: string;
      subjectId: string;
      actorUserId?: string;
      metadata: Record<string, unknown>;
    };
    expect(auditArgs.action).toBe('compliance.gdpr_export');
    expect(auditArgs.subjectType).toBe('contact');
    expect(auditArgs.subjectId).toBe(CONTACT_ID);
    expect(auditArgs.actorUserId).toBe('user-1');
    expect(auditArgs.metadata['identifier']).toBe('+393331234567');
  });

  it('skips bundling artefacts when storage download returns null', async () => {
    const contact = makeContact();
    const call = {
      id: CALL_ID,
      org_id: ORG_ID,
      contact_id: CONTACT_ID,
      recording_path: `recordings/${ORG_ID}/${CALL_ID}.mp3`,
      transcript_path: `transcripts/${ORG_ID}/${CALL_ID}.json`,
      provider: 'vapi',
      direction: 'outbound',
      status: 'completed',
      created_at: new Date('2024-01-02'),
    };
    mockWithOrgContext.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn(buildOrgTx({ contact, callRows: [call], apptRows: [], optOutRows: [] })),
    );
    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(buildSystemTx([])),
    );
    mockDownload.mockResolvedValue({ data: null, error: { message: 'not found' } });

    const result = await buildSubjectExport({
      orgId: ORG_ID,
      identifier: contact['phone_e164'] as string,
    });

    expect(result.totals.recordingsBundled).toBe(0);
    expect(result.totals.transcriptsBundled).toBe(0);
  });

  it('throws when upload fails', async () => {
    const contact = makeContact();
    mockWithOrgContext.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn(buildOrgTx({ contact, callRows: [], apptRows: [], optOutRows: [] })),
    );
    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(buildSystemTx([])),
    );
    mockUpload.mockResolvedValueOnce({ data: null, error: { message: 'storage down' } });

    await expect(
      buildSubjectExport({ orgId: ORG_ID, identifier: '+393331234567' }),
    ).rejects.toThrow(/upload failed/);
  });

  it('filters out soft-deleted (already-erased) contacts', async () => {
    let capturedConditions: unknown = null;

    mockWithOrgContext.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          select: vi.fn(() => ({
            from: vi.fn((table: unknown) => {
              const tableId = (table as { org_id?: string }).org_id;
              const where = vi.fn((cond: unknown) => {
                if (tableId === 'c_org_id') {
                  capturedConditions = cond;
                  // Tombstone is filtered server-side — simulate the empty
                  // result the deleted_at filter would return.
                  return { limit: vi.fn(() => Promise.resolve([])) };
                }
                return Promise.resolve([]);
              });
              return { where };
            }),
          })),
        };
        return fn(tx);
      },
    );
    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(buildSystemTx([])),
    );

    await expect(
      buildSubjectExport({ orgId: ORG_ID, identifier: '+393331234567' }),
    ).rejects.toBeInstanceOf(SubjectNotFoundError);

    // Each branch of the lookup OR must include an isNull(deleted_at) clause.
    const cond = capturedConditions as { type: string; args: Array<{ type: string; args: unknown[] }> };
    expect(cond.type).toBe('or');
    for (const branch of cond.args) {
      expect(branch.type).toBe('and');
      const hasDeletedAtFilter = (branch.args as Array<{ type: string; col?: string }>).some(
        (a) => a.type === 'isNull' && a.col === 'c_deleted_at',
      );
      expect(hasDeletedAtFilter).toBe(true);
    }
  });

  it('looks up by email when identifier contains @', async () => {
    const contact = makeContact({ email: 'mario@example.com' });
    let capturedConditions: unknown = null;

    mockWithOrgContext.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          select: vi.fn(() => ({
            from: vi.fn((table: unknown) => {
              const tableId = (table as { org_id?: string }).org_id;
              const where = vi.fn((cond: unknown) => {
                if (tableId === 'c_org_id') {
                  capturedConditions = cond;
                  return { limit: vi.fn(() => Promise.resolve([contact])) };
                }
                return Promise.resolve([]);
              });
              return { where };
            }),
          })),
        };
        return fn(tx);
      },
    );
    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(buildSystemTx([])),
    );

    await buildSubjectExport({ orgId: ORG_ID, identifier: 'mario@example.com' });

    // The OR condition should include both phone and email branches when the
    // identifier looks like an email.
    const cond = capturedConditions as { type: string; args: Array<{ args: unknown[] }> };
    expect(cond.type).toBe('or');
    expect(cond.args).toHaveLength(2);
  });
});

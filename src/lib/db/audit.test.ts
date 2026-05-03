import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mock factories so they're available when vi.mock is hoisted
const { mockInsert, mockValues, mockTransaction } = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockValues: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock('./client', () => ({
  db: {
    transaction: mockTransaction,
    insert: mockInsert,
  },
}));

// Mock the schema so we get a stable object reference for assertions
vi.mock('./schema', () => ({
  auditLog: { _: { name: 'audit_log' } },
}));

import { recordAudit } from './audit';
import { auditLog } from './schema';

// Simulates the transactional db client passed to recordAudit.
// The `update` method throws a Postgres ERROR 42501 (insufficient_privilege)
// as it would when the REVOKE in migration 0002_audit_immutable.sql takes effect.
function makeTx() {
  return {
    insert: vi.fn().mockReturnValue({ values: mockValues }),
    update: vi.fn().mockImplementation(() => {
      const err = new Error('ERROR: permission denied for table audit_log');
      (err as NodeJS.ErrnoException).code = '42501';
      throw err;
    }),
  };
}

describe('recordAudit', () => {
  let tx: ReturnType<typeof makeTx>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockValues.mockResolvedValue(undefined);
    tx = makeTx();
  });

  it('calls tx.insert with the auditLog table', async () => {
    await recordAudit(tx as never, {
      actorType: 'system',
      action: 'test.action',
      subjectType: 'campaign',
      subjectId: 'camp-1',
    });
    expect(tx.insert).toHaveBeenCalledOnce();
    expect(tx.insert).toHaveBeenCalledWith(auditLog);
  });

  it('passes all required fields to values()', async () => {
    await recordAudit(tx as never, {
      actorType: 'system',
      action: 'call.completed',
      subjectType: 'call',
      subjectId: 'call-uuid-1',
    });
    const [insertedRow] = mockValues.mock.calls[0] as [Record<string, unknown>];
    expect(insertedRow).toMatchObject({
      actor_type: 'system',
      action: 'call.completed',
      subject_type: 'call',
      subject_id: 'call-uuid-1',
    });
  });

  it('sets org_id when provided', async () => {
    await recordAudit(tx as never, {
      orgId: 'org-uuid-1',
      actorType: 'user',
      action: 'member.invited',
      subjectType: 'membership',
      subjectId: 'mem-1',
    });
    const [insertedRow] = mockValues.mock.calls[0] as [Record<string, unknown>];
    expect(insertedRow['org_id']).toBe('org-uuid-1');
  });

  it('sets org_id to null when omitted', async () => {
    await recordAudit(tx as never, {
      actorType: 'system',
      action: 'rpo.bulk_check',
      subjectType: 'rpo_snapshot',
      subjectId: '+39012345678',
    });
    const [insertedRow] = mockValues.mock.calls[0] as [Record<string, unknown>];
    expect(insertedRow['org_id']).toBeNull();
  });

  it('sets actor_user_id when provided', async () => {
    await recordAudit(tx as never, {
      orgId: 'org-1',
      actorUserId: 'user-uuid-1',
      actorType: 'user',
      action: 'contact.opted_out',
      subjectType: 'contact',
      subjectId: 'contact-1',
    });
    const [insertedRow] = mockValues.mock.calls[0] as [Record<string, unknown>];
    expect(insertedRow['actor_user_id']).toBe('user-uuid-1');
  });

  it('sets actor_user_id to null when omitted', async () => {
    await recordAudit(tx as never, {
      actorType: 'webhook',
      action: 'payment.succeeded',
      subjectType: 'payment',
      subjectId: 'pay-1',
    });
    const [insertedRow] = mockValues.mock.calls[0] as [Record<string, unknown>];
    expect(insertedRow['actor_user_id']).toBeNull();
  });

  it('passes metadata when provided', async () => {
    const meta = { stripe_event_id: 'evt_123', amount: 9900 };
    await recordAudit(tx as never, {
      actorType: 'webhook',
      action: 'payment.succeeded',
      subjectType: 'payment',
      subjectId: 'pay-1',
      metadata: meta,
    });
    const [insertedRow] = mockValues.mock.calls[0] as [Record<string, unknown>];
    expect(insertedRow['metadata']).toEqual(meta);
  });

  it('sets metadata to null when omitted', async () => {
    await recordAudit(tx as never, {
      actorType: 'system',
      action: 'test.action',
      subjectType: 'test',
      subjectId: 'id-1',
    });
    const [insertedRow] = mockValues.mock.calls[0] as [Record<string, unknown>];
    expect(insertedRow['metadata']).toBeNull();
  });

  it('returns void (no return value)', async () => {
    const result = await recordAudit(tx as never, {
      actorType: 'system',
      action: 'test.action',
      subjectType: 'test',
      subjectId: 'id-1',
    });
    expect(result).toBeUndefined();
  });

  // NOTE: Immutability of audit_log (REVOKE UPDATE/DELETE in migration 0002) is
  // enforced at the Postgres level. Integration tests in a real DB should verify
  // that the `authenticated` role receives ERROR 42501 on UPDATE attempts.
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockWithSystemContext, mockRecordAudit } = vi.hoisted(() => ({
  mockWithSystemContext: vi.fn(),
  mockRecordAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/db/context', () => ({
  withSystemContext: mockWithSystemContext,
}));

vi.mock('@/lib/db/audit', () => ({
  recordAudit: mockRecordAudit,
}));

vi.mock('@/lib/db/schema', () => ({
  contacts: {
    id: 'k_id',
    org_id: 'k_org_id',
    legal_hold_until: 'k_legal_hold_until',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  eq: (col: unknown, val: unknown) => ({ type: 'eq', col, val }),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { ContactNotFoundError, setLegalHold } from './legal-hold';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const CONTACT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';

interface UpdateRecorder {
  setArg?: Record<string, unknown>;
  whereArg?: unknown;
}

function buildTx(existingRow: Record<string, unknown> | null, captured: { updates: UpdateRecorder[] }) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue(existingRow ? [existingRow] : []),
        })),
      })),
    })),
    update: vi.fn(() => {
      const recorder: UpdateRecorder = {};
      captured.updates.push(recorder);
      return {
        set: (s: Record<string, unknown>) => {
          recorder.setArg = s;
          return {
            where: (w: unknown) => {
              recorder.whereArg = w;
              return Promise.resolve(undefined);
            },
          };
        },
      };
    }),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
  };
}

beforeEach(() => {
  mockWithSystemContext.mockReset();
  mockRecordAudit.mockReset();
  mockRecordAudit.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('setLegalHold', () => {
  it('throws ContactNotFoundError when the contact does not exist in the org', async () => {
    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(buildTx(null, { updates: [] })),
    );

    await expect(
      setLegalHold({
        orgId: ORG_ID,
        contactId: CONTACT_ID,
        untilDate: new Date('2027-01-01T00:00:00.000Z'),
        reason: 'litigation',
      }),
    ).rejects.toBeInstanceOf(ContactNotFoundError);

    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it('applies a future hold and writes an audit row with previous and new values', async () => {
    const captured: { updates: UpdateRecorder[] } = { updates: [] };
    const previousIso = '2026-12-01T00:00:00.000Z';
    const previous = new Date(previousIso);
    const newUntil = new Date('2027-06-01T00:00:00.000Z');

    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(
        buildTx(
          { id: CONTACT_ID, org_id: ORG_ID, legal_hold_until: previous },
          captured,
        ),
      ),
    );

    const result = await setLegalHold({
      orgId: ORG_ID,
      contactId: CONTACT_ID,
      untilDate: newUntil,
      reason: 'extending litigation hold',
      actor: 'founder@example.com',
    });

    expect(result.previousLegalHoldUntil).toEqual(previous);
    expect(result.legalHoldUntil).toEqual(newUntil);
    expect(captured.updates).toHaveLength(1);
    expect(captured.updates[0]!.setArg).toEqual({ legal_hold_until: newUntil });

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: ORG_ID,
        actorType: 'system',
        action: 'compliance.legal_hold_changed',
        subjectType: 'contact',
        subjectId: CONTACT_ID,
        metadata: expect.objectContaining({
          previousLegalHoldUntil: previousIso,
          legalHoldUntil: newUntil.toISOString(),
          reason: 'extending litigation hold',
          actor: 'founder@example.com',
        }),
      }),
    );
  });

  it('clears a hold when untilDate is null and records the prior value', async () => {
    const captured: { updates: UpdateRecorder[] } = { updates: [] };
    const previous = new Date('2026-12-01T00:00:00.000Z');

    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(
        buildTx(
          { id: CONTACT_ID, org_id: ORG_ID, legal_hold_until: previous },
          captured,
        ),
      ),
    );

    const result = await setLegalHold({
      orgId: ORG_ID,
      contactId: CONTACT_ID,
      untilDate: null,
      reason: 'investigation closed',
    });

    expect(result.legalHoldUntil).toBeNull();
    expect(captured.updates[0]!.setArg).toEqual({ legal_hold_until: null });
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          legalHoldUntil: null,
          previousLegalHoldUntil: previous.toISOString(),
        }),
      }),
    );
  });

  it('writes an audit row even when re-applying the same value (idempotent)', async () => {
    const captured: { updates: UpdateRecorder[] } = { updates: [] };
    const same = new Date('2027-01-01T00:00:00.000Z');

    mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(buildTx({ id: CONTACT_ID, org_id: ORG_ID, legal_hold_until: same }, captured)),
    );

    await setLegalHold({
      orgId: ORG_ID,
      contactId: CONTACT_ID,
      untilDate: same,
      reason: 'periodic re-application',
    });

    expect(mockRecordAudit).toHaveBeenCalledOnce();
  });
});

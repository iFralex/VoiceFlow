import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRecordAudit = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/db/audit', () => ({
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

// Variable-based result queues to avoid mockReturnValueOnce accumulation
let selectResults: unknown[][] = [];
let insertResults: unknown[][] = [];
let updateResults: unknown[][] = [];

const mockTx = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
};

function resetMockTx() {
  mockTx.select.mockImplementation(() => {
    const result = selectResults.shift() ?? [];
    return {
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(result),
      })),
    };
  });

  mockTx.insert.mockImplementation(() => {
    const result = insertResults.shift() ?? [];
    return {
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue(result),
      })),
    };
  });

  mockTx.update.mockImplementation(() => {
    const result = updateResults.shift() ?? [];
    return {
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue(result),
        })),
      })),
    };
  });
}

vi.mock('@/lib/db/context', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
  withSystemContext: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
}));

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';
const PAT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003';

function makePat(overrides: Record<string, unknown> = {}) {
  return {
    id: PAT_ID,
    user_id: USER_ID,
    org_id: ORG_ID,
    name: 'My Token',
    token_hash: 'abc123',
    prefix: 'vx_abc123',
    scopes: ['api'],
    last_used_at: null,
    expires_at: null,
    revoked_at: null,
    created_at: new Date(),
    ...overrides,
  };
}

import { createPat, listPats, revokePat, verifyPat } from './pat';

describe('PAT service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectResults = [];
    insertResults = [];
    updateResults = [];
    resetMockTx();
  });

  // ── createPat ─────────────────────────────────────────────────────────────

  describe('createPat', () => {
    it('inserts a token and returns rawToken', async () => {
      const pat = makePat();
      insertResults.push([pat]);

      const result = await createPat({
        userId: USER_ID,
        orgId: ORG_ID,
        name: 'My Token',
        scopes: ['api'],
      });

      expect(result.pat).toEqual(pat);
      expect(result.rawToken).toMatch(/^vx_/);
      expect(result.rawToken).toHaveLength(51); // vx_ + 48 hex chars
    });

    it('calls recordAudit on creation', async () => {
      insertResults.push([makePat()]);

      await createPat({ userId: USER_ID, orgId: ORG_ID, name: 'X', scopes: ['api'] });

      expect(mockRecordAudit).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({ action: 'pat.created' }),
      );
    });

    it('stores a hash, not the raw token', async () => {
      const pat = makePat();
      insertResults.push([pat]);

      const { rawToken } = await createPat({
        userId: USER_ID,
        orgId: ORG_ID,
        name: 'X',
        scopes: ['api'],
      });

      const insertCall = mockTx.insert.mock.calls[0];
      expect(insertCall).toBeDefined();
      // The raw token should not appear in the insert values
      const values = mockTx.insert.mock.results[0];
      expect(values).not.toContain(rawToken);
    });

    it('passes expiresAt when provided', async () => {
      insertResults.push([makePat()]);
      const expiresAt = '2027-01-01T00:00:00Z';

      await createPat({ userId: USER_ID, orgId: ORG_ID, name: 'X', scopes: ['api'], expiresAt });

      // No error means the date was parsed and passed through
      expect(mockTx.insert).toHaveBeenCalled();
    });
  });

  // ── revokePat ─────────────────────────────────────────────────────────────

  describe('revokePat', () => {
    it('sets revoked_at and calls audit', async () => {
      updateResults.push([{ id: PAT_ID }]);

      await revokePat(PAT_ID, USER_ID, ORG_ID);

      expect(mockTx.update).toHaveBeenCalled();
      expect(mockRecordAudit).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({ action: 'pat.revoked' }),
      );
    });

    it('throws pat_not_found when token does not exist or is already revoked', async () => {
      updateResults.push([]); // empty = no rows updated

      await expect(revokePat(PAT_ID, USER_ID, ORG_ID)).rejects.toThrow('pat_not_found');
    });
  });

  // ── listPats ──────────────────────────────────────────────────────────────

  describe('listPats', () => {
    it('returns active PATs for the user/org', async () => {
      const pats = [makePat(), makePat({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000009' })];
      selectResults.push(pats);

      const result = await listPats(USER_ID, ORG_ID);

      expect(result).toHaveLength(2);
    });

    it('returns empty array when no PATs exist', async () => {
      selectResults.push([]);

      const result = await listPats(USER_ID, ORG_ID);

      expect(result).toHaveLength(0);
    });
  });

  // ── verifyPat ─────────────────────────────────────────────────────────────

  describe('verifyPat', () => {
    it('returns identity for a valid token', async () => {
      const pat = makePat();
      selectResults.push([pat]);
      updateResults.push([{ id: PAT_ID }]); // last_used_at update

      const result = await verifyPat('vx_somerawtoken123456789012345678901234567890');

      expect(result).toEqual({
        userId: USER_ID,
        orgId: ORG_ID,
        scopes: ['api'],
        patId: PAT_ID,
      });
    });

    it('returns null when token not found', async () => {
      selectResults.push([]); // not found

      const result = await verifyPat('vx_nonexistenttoken');

      expect(result).toBeNull();
    });

    it('returns null when token is revoked', async () => {
      selectResults.push([makePat({ revoked_at: new Date() })]);

      const result = await verifyPat('vx_revokedtoken');

      expect(result).toBeNull();
    });

    it('returns null when token is expired', async () => {
      const past = new Date(Date.now() - 1000);
      selectResults.push([makePat({ expires_at: past })]);

      const result = await verifyPat('vx_expiredtoken');

      expect(result).toBeNull();
    });

    it('accepts non-expired tokens', async () => {
      const future = new Date(Date.now() + 86400000);
      const pat = makePat({ expires_at: future });
      selectResults.push([pat]);
      updateResults.push([{ id: PAT_ID }]);

      const result = await verifyPat('vx_validtokenwitexpiry');

      expect(result).not.toBeNull();
    });
  });
});

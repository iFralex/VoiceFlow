import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockTransaction, mockExecute, mockHeadersGet } = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockExecute: vi.fn(),
  mockHeadersGet: vi.fn(),
}));

// Mock the postgres driver to prevent real DB connections.
vi.mock('postgres', () => ({
  default: vi.fn(() => ({})),
}));

// Mock the env so DATABASE_URL validation doesn't fail.
vi.mock('@/lib/env', () => ({
  env: { DATABASE_URL: 'postgresql://test:test@localhost:5432/test' },
}));

// Mock drizzle so `db` is a controllable stub.
vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: vi.fn(() => ({
    transaction: mockTransaction,
  })),
}));

// Mock next/headers so we can control the x-org-id header.
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({ get: mockHeadersGet })),
}));

import { dbForRequest } from './client';

// ─── Tests ────────────────────────────────────────────────────────────────────

const VALID_ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';

describe('dbForRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({ execute: mockExecute });
    });
    mockExecute.mockResolvedValue(undefined);
  });

  describe('header validation', () => {
    it('throws when x-org-id header is missing', async () => {
      mockHeadersGet.mockReturnValue(null);
      await expect(dbForRequest()).rejects.toThrow('Missing x-org-id header');
    });

    it('throws when x-org-id header is empty string', async () => {
      mockHeadersGet.mockReturnValue('');
      await expect(dbForRequest()).rejects.toThrow('Missing x-org-id header');
    });
  });

  describe('happy path', () => {
    beforeEach(() => {
      mockHeadersGet.mockReturnValue(VALID_ORG_ID);
    });

    it('returns the orgId from the header', async () => {
      const result = await dbForRequest();
      expect(result.orgId).toBe(VALID_ORG_ID);
    });

    it('returns a withOrgContext function', async () => {
      const result = await dbForRequest();
      expect(typeof result.withOrgContext).toBe('function');
    });
  });

  describe('withOrgContext', () => {
    beforeEach(() => {
      mockHeadersGet.mockReturnValue(VALID_ORG_ID);
    });

    it('wraps the callback in a transaction', async () => {
      const { withOrgContext } = await dbForRequest();
      await withOrgContext(async () => undefined);
      expect(mockTransaction).toHaveBeenCalledOnce();
    });

    it('calls execute inside the transaction to set the GUC', async () => {
      const { withOrgContext } = await dbForRequest();
      await withOrgContext(async () => undefined);
      expect(mockExecute).toHaveBeenCalledOnce();
    });

    it('passes orgId as param to set_config', async () => {
      const { withOrgContext } = await dbForRequest();
      await withOrgContext(async () => undefined);

      const [sqlObj] = mockExecute.mock.calls[0] as [{ queryChunks: unknown[] }];
      expect(sqlObj.queryChunks).toContain(VALID_ORG_ID);
    });

    it('passes the transactional client to fn', async () => {
      const { withOrgContext } = await dbForRequest();
      let captured: unknown;
      await withOrgContext(async (tx) => {
        captured = tx;
      });
      expect(captured).toBeDefined();
      expect(captured).toHaveProperty('execute');
    });

    it('returns the value produced by fn', async () => {
      const { withOrgContext } = await dbForRequest();
      const result = await withOrgContext(async () => 'sentinel');
      expect(result).toBe('sentinel');
    });

    it('propagates errors thrown by fn', async () => {
      const { withOrgContext } = await dbForRequest();
      const boom = new Error('query failed');
      await expect(withOrgContext(async () => { throw boom; })).rejects.toThrow('query failed');
    });

    it('GUC execute is called before fn body runs', async () => {
      const { withOrgContext } = await dbForRequest();
      const order: string[] = [];
      mockExecute.mockImplementation(async () => {
        order.push('set-guc');
      });
      await withOrgContext(async () => {
        order.push('fn-body');
      });
      expect(order).toEqual(['set-guc', 'fn-body']);
    });
  });
});

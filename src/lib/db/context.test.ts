import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mock factories so they're available when vi.mock is hoisted
const { mockExecute, mockTransaction } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock('./client', () => ({
  db: {
    transaction: mockTransaction,
  },
}));

import { withOrgContext, withSystemContext } from './context';

describe('withOrgContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = { execute: mockExecute };
      return fn(tx);
    });
    mockExecute.mockResolvedValue(undefined);
  });

  it('wraps the callback in a transaction', async () => {
    await withOrgContext('org-1', async () => undefined);
    expect(mockTransaction).toHaveBeenCalledOnce();
  });

  it('calls execute inside the transaction to set the GUC', async () => {
    await withOrgContext('org-1', async () => undefined);
    expect(mockExecute).toHaveBeenCalledOnce();
  });

  it('passes the orgId as a param to set_config', async () => {
    const orgId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    await withOrgContext(orgId, async () => undefined);

    const [sqlObject] = mockExecute.mock.calls[0] as [{ queryChunks: unknown[] }];
    // Drizzle sql`` template stores interpolated values directly in queryChunks
    expect(sqlObject.queryChunks).toContain(orgId);
  });

  it('passes the transactional client to fn', async () => {
    let captured: unknown;
    await withOrgContext('org-1', async (tx) => {
      captured = tx;
    });
    expect(captured).toBeDefined();
    expect(captured).toHaveProperty('execute');
  });

  it('returns the value produced by fn', async () => {
    const result = await withOrgContext('org-1', async () => 'expected');
    expect(result).toBe('expected');
  });

  it('GUC execute is called before fn body runs', async () => {
    const order: string[] = [];
    mockExecute.mockImplementation(async () => {
      order.push('set-guc');
    });

    await withOrgContext('org-1', async () => {
      order.push('fn-body');
    });

    expect(order).toEqual(['set-guc', 'fn-body']);
  });

  it('propagates errors thrown by fn', async () => {
    const boom = new Error('db error');
    await expect(withOrgContext('org-1', async () => { throw boom; })).rejects.toThrow('db error');
  });

  it('GUC is SET LOCAL (only inside transaction) — verified via call sequencing', async () => {
    // SET LOCAL is a Postgres guarantee. Here we verify that execute() is
    // only called inside the transaction callback (not before or after it).
    const executeCallsOutsideTx: number[] = [];
    let insideTx = false;

    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      insideTx = true;
      const tx = { execute: mockExecute };
      const result = await fn(tx);
      insideTx = false;
      return result;
    });
    mockExecute.mockImplementation(async () => {
      if (!insideTx) executeCallsOutsideTx.push(1);
    });

    await withOrgContext('org-1', async () => undefined);

    expect(executeCallsOutsideTx).toHaveLength(0);
    expect(mockExecute).toHaveBeenCalledOnce();
  });
});

describe('withSystemContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = { execute: mockExecute };
      return fn(tx);
    });
    mockExecute.mockResolvedValue(undefined);
  });

  it('wraps the callback in a transaction', async () => {
    await withSystemContext(async () => undefined);
    expect(mockTransaction).toHaveBeenCalledOnce();
  });

  it('does NOT call execute (no GUC is set)', async () => {
    await withSystemContext(async () => undefined);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('passes the transactional client to fn', async () => {
    let captured: unknown;
    await withSystemContext(async (tx) => {
      captured = tx;
    });
    expect(captured).toBeDefined();
    expect(captured).toHaveProperty('execute');
  });

  it('returns the value produced by fn', async () => {
    const result = await withSystemContext(async () => 99);
    expect(result).toBe(99);
  });

  it('propagates errors thrown by fn', async () => {
    const boom = new Error('system error');
    await expect(withSystemContext(async () => { throw boom; })).rejects.toThrow('system error');
  });
});

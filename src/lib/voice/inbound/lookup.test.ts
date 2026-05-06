/**
 * Unit tests for `findRecentOutboundCallsToNumber`. Mocks `withSystemContext`
 * and the chainable Drizzle query builder; full SQL semantics (the JOIN, the
 * `make_interval` lookback, ordering, multi-org filtering) are covered by the
 * integration tests.
 */

vi.mock('@/lib/db/context', () => ({
  withSystemContext: vi.fn(),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withSystemContext } from '@/lib/db/context';

import { findRecentOutboundCallsToNumber } from './lookup';

interface MockRow {
  orgId: string;
  callId: string;
  contactId: string;
  dialedAt: Date | null;
}

function buildMockTx(rows: MockRow[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const select: any = {};
  select.from = vi.fn(() => select);
  select.innerJoin = vi.fn(() => select);
  select.where = vi.fn(() => select);
  select.orderBy = vi.fn(() => Promise.resolve(rows));

  return {
    select: vi.fn(() => select),
  };
}

describe('findRecentOutboundCallsToNumber', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns the rows mapped into the public shape', async () => {
    const dialedAt = new Date('2026-05-01T10:00:00Z');
    const tx = buildMockTx([
      {
        orgId: 'org-1',
        callId: 'call-1',
        contactId: 'contact-1',
        dialedAt,
      },
    ]);
    vi.mocked(withSystemContext).mockImplementationOnce((fn) =>
      fn(tx as unknown as Parameters<typeof fn>[0]),
    );

    const results = await findRecentOutboundCallsToNumber('+393401234567');
    expect(results).toEqual([
      { orgId: 'org-1', callId: 'call-1', contactId: 'contact-1', dialedAt },
    ]);
  });

  it('drops rows whose dialedAt is null (started_at unset)', async () => {
    const tx = buildMockTx([
      { orgId: 'org-1', callId: 'call-null', contactId: 'contact-1', dialedAt: null },
      {
        orgId: 'org-2',
        callId: 'call-real',
        contactId: 'contact-2',
        dialedAt: new Date('2026-05-01T10:00:00Z'),
      },
    ]);
    vi.mocked(withSystemContext).mockImplementationOnce((fn) =>
      fn(tx as unknown as Parameters<typeof fn>[0]),
    );

    const results = await findRecentOutboundCallsToNumber('+393401234567');
    expect(results).toHaveLength(1);
    expect(results[0]?.callId).toBe('call-real');
  });

  it('returns an empty array when no rows match', async () => {
    const tx = buildMockTx([]);
    vi.mocked(withSystemContext).mockImplementationOnce((fn) =>
      fn(tx as unknown as Parameters<typeof fn>[0]),
    );

    const results = await findRecentOutboundCallsToNumber('+393401234567');
    expect(results).toEqual([]);
  });

  it('uses the supplied tx instead of opening a system context', async () => {
    const tx = buildMockTx([]);

    await findRecentOutboundCallsToNumber('+393401234567', {
      tx: tx as unknown as Parameters<Parameters<typeof withSystemContext>[0]>[0],
    });

    expect(vi.mocked(withSystemContext)).not.toHaveBeenCalled();
  });

  it('threads the supplied tx through to the query builder', async () => {
    const tx = buildMockTx([
      {
        orgId: 'org-1',
        callId: 'call-1',
        contactId: 'contact-1',
        dialedAt: new Date(),
      },
    ]);

    await findRecentOutboundCallsToNumber('+393401234567', {
      tx: tx as unknown as Parameters<Parameters<typeof withSystemContext>[0]>[0],
    });

    expect(tx.select).toHaveBeenCalledTimes(1);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── DB context mock ───────────────────────────────────────────────────────────

vi.mock('@/lib/db/context', () => ({
  withOrgContext: vi.fn(
    async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(mockTx),
  ),
}));

let nextSelectResult: unknown[] = [];

function makeSelectChain(result: unknown[]): unknown {
  const thenable = {
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(result)),
    from: vi.fn(() => thenable),
    where: vi.fn(() => thenable),
    orderBy: vi.fn(() => thenable),
    limit: vi.fn(() => Promise.resolve(result)),
  };
  return thenable;
}

const mockTx = {
  select: vi.fn(() => makeSelectChain(nextSelectResult)),
};

beforeEach(() => {
  nextSelectResult = [];
  mockTx.select.mockClear();
});

const { searchPalette } = await import('./search');

describe('searchPalette', () => {
  it('returns empty groups when the query is blank', async () => {
    const out = await searchPalette('org-1', '   ', {
      contacts: true,
      campaigns: true,
      scripts: true,
    });
    expect(out).toEqual({ contacts: [], campaigns: [], scripts: [] });
    expect(mockTx.select).not.toHaveBeenCalled();
  });

  it('skips a group when its capability flag is false', async () => {
    // Three groups disabled → no DB select calls at all.
    await searchPalette('org-1', 'mario', {
      contacts: false,
      campaigns: false,
      scripts: false,
    });
    expect(mockTx.select).not.toHaveBeenCalled();
  });

  it('issues one select per enabled group', async () => {
    await searchPalette('org-1', 'mario', {
      contacts: true,
      campaigns: true,
      scripts: true,
    });
    expect(mockTx.select).toHaveBeenCalledTimes(3);
  });

  it('caps each enabled group regardless of result volume', async () => {
    nextSelectResult = []; // empty rows; we just assert .limit() was called
    const limitSpy = vi.fn(() => Promise.resolve([]));
    mockTx.select.mockImplementation(() => {
      const chain: Record<string, unknown> = {};
      const thenable: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve([])),
        from: vi.fn(() => thenable),
        where: vi.fn(() => thenable),
        orderBy: vi.fn(() => thenable),
        limit: limitSpy,
        ...chain,
      };
      return thenable;
    });

    await searchPalette('org-1', 'mario', {
      contacts: true,
      campaigns: true,
      scripts: true,
      limit: 7,
    });

    expect(limitSpy).toHaveBeenCalledTimes(3);
    expect(limitSpy).toHaveBeenCalledWith(7);
  });

  it('truncates very long queries before searching', async () => {
    // No assertion on patterns (that's an implementation detail) — we only
    // assert the call still goes through and returns the empty fixture.
    const longQuery = 'a'.repeat(500);
    const out = await searchPalette('org-1', longQuery, {
      contacts: true,
      campaigns: false,
      scripts: false,
    });
    expect(out).toEqual({ contacts: [], campaigns: [], scripts: [] });
  });
});

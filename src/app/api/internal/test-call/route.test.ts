/**
 * Unit tests for POST /api/internal/test-call
 *
 * The DB and service layer are fully mocked so these tests run without a
 * real database or voice provider.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks (must appear before imports of the tested module)
// ---------------------------------------------------------------------------

const {
  mockGetAuthContext,
  mockHasCapability,
  mockWithOrgContext,
  mockWithSystemContext,
  mockDispatchCall,
} = vi.hoisted(() => {
  const mockGetAuthContext = vi.fn();
  const mockHasCapability = vi.fn();
  const mockWithOrgContext = vi.fn();
  const mockWithSystemContext = vi.fn();
  const mockDispatchCall = vi.fn();

  return {
    mockGetAuthContext,
    mockHasCapability,
    mockWithOrgContext,
    mockWithSystemContext,
    mockDispatchCall,
  };
});

vi.mock('@/lib/auth/context', () => ({
  getAuthContext: mockGetAuthContext,
  hasCapability: mockHasCapability,
}));

vi.mock('@/lib/db/context', () => ({
  withOrgContext: mockWithOrgContext,
  withSystemContext: mockWithSystemContext,
}));

vi.mock('@/lib/db/schema', () => ({
  calls: { org_id: 'c_org_id', created_at: 'c_created_at', metadata: 'c_metadata' },
  campaigns: {},
  contactLists: { id: 'cl_id' },
  contacts: { id: 'co_id' },
  scripts: { id: 's_id', org_id: 's_org_id' },
}));

vi.mock('@/lib/env', () => ({
  env: { VOICE_PROVIDER: 'vapi' },
}));

vi.mock('@/lib/services/calls', () => ({
  dispatchCall: mockDispatchCall,
}));

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  gte: (a: unknown, b: unknown) => ({ gte: [a, b] }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ _sql: strings, _values: values }),
    { raw: (s: string) => ({ _raw: s }) },
  ),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { POST } from './route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock drizzle tx that supports both the rate-limit count query
 * (.select().from().where() → resolved array) and the script lookup
 * (.select().from().where().limit() → resolved array).
 */
function makeSelectTx(rateRow: unknown[], scriptRow: unknown[]): Record<string, unknown> {
  let selectCallCount = 0;
  return {
    select: () => {
      selectCallCount++;
      const row = selectCallCount === 1 ? rateRow : scriptRow;
      return {
        from: () => ({
          where: () =>
            Object.assign(Promise.resolve(row), {
              limit: (_n: number) => Promise.resolve(row),
            }),
        }),
      };
    },
  };
}

function makeInsertTx(returnedId: string): Record<string, unknown> {
  return {
    select: () => ({
      from: () => ({
        where: () =>
          Object.assign(Promise.resolve([{ id: returnedId }]), {
            limit: () => Promise.resolve([{ id: returnedId }]),
          }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([{ id: returnedId }]),
      }),
    }),
  };
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/internal/test-call', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// UUID must pass Zod's uuid() check (third group [1-8], fourth group [89abAB])
const VALID_SCRIPT_ID = '00000000-0000-4000-8000-000000000001';
const VALID_BODY = { scriptId: VALID_SCRIPT_ID, toNumber: '+393331234567' };
const OWNER_CTX = { orgId: 'org-1', userId: 'user-1', role: 'owner' as const };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/internal/test-call', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockGetAuthContext.mockResolvedValue(OWNER_CTX);
    mockHasCapability.mockReturnValue(true);
    mockDispatchCall.mockResolvedValue(undefined);

    // Default: rate-limit count = 0, script found
    mockWithOrgContext.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = makeSelectTx([{ n: 0 }], [{ id: VALID_SCRIPT_ID }]);
        return fn(tx);
      },
    );

    mockWithSystemContext.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
        };
        return fn(tx);
      },
    );
  });

  // ── Auth ───────────────────────────────────────────────────────────────────

  it('returns 401 when auth context is missing', async () => {
    mockGetAuthContext.mockRejectedValue(new Error('no auth'));
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(401);
  });

  it('returns 403 when user does not have org.manage capability', async () => {
    mockHasCapability.mockReturnValue(false);
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(403);
  });

  // ── Body validation ────────────────────────────────────────────────────────

  it('returns 400 for invalid JSON body', async () => {
    const req = new Request('http://localhost/api/internal/test-call', {
      method: 'POST',
      body: 'not json{',
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('Invalid JSON body');
  });

  it('returns 400 for a non-Italian phone number', async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, toNumber: '+441234567890' }));
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('Invalid request body');
  });

  it('returns 400 for an invalid UUID scriptId', async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, scriptId: 'not-a-uuid' }));
    expect(res.status).toBe(400);
  });

  // ── Rate limit ─────────────────────────────────────────────────────────────

  it('returns 429 when daily rate limit is reached', async () => {
    // First withOrgContext call (rate-limit query) returns count=10
    mockWithOrgContext.mockImplementationOnce(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = makeSelectTx([{ n: 10 }], []);
        return fn(tx);
      },
    );

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(429);
    const json = await res.json() as { error: string; limit: number };
    expect(json.error).toBe('test_call_rate_limit_exceeded');
    expect(json.limit).toBe(10);
  });

  // ── Script not found ───────────────────────────────────────────────────────

  it('returns 404 when script is not found in org', async () => {
    // Call 1 (rate-limit): first select → count=0
    // Call 2 (script lookup): first select → empty (script not found)
    let callN = 0;
    mockWithOrgContext.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        callN++;
        // For call 1 the rate row is [{ n: 0 }], for call 2 the lookup row is []
        const firstRow = callN === 1 ? [{ n: 0 }] : [];
        return fn(makeSelectTx(firstRow, []));
      },
    );

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(404);
  });

  // ── Success ────────────────────────────────────────────────────────────────

  it('dispatches the call and returns callId on success', async () => {
    // Calls: 1=rate limit, 2=script lookup, 3=synthetic record inserts
    let callN = 0;
    mockWithOrgContext.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        callN++;
        if (callN === 1) {
          // Rate-limit count query
          return fn(makeSelectTx([{ n: 0 }], []));
        }
        if (callN === 2) {
          // Script lookup
          return fn(makeSelectTx([{ n: 0 }], [{ id: VALID_SCRIPT_ID }]));
        }
        // Synthetic inserts
        return fn(makeInsertTx('call-uuid'));
      },
    );

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const json = await res.json() as { callId: string };
    expect(json.callId).toBe('call-uuid');
    expect(mockDispatchCall).toHaveBeenCalledWith('org-1', 'call-uuid');
  });

  // ── Dispatch failure ───────────────────────────────────────────────────────

  it('returns 500 and marks call failed when dispatchCall throws', async () => {
    let callN = 0;
    mockWithOrgContext.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => {
        callN++;
        if (callN === 1) return fn(makeSelectTx([{ n: 0 }], []));
        if (callN === 2) return fn(makeSelectTx([{ n: 0 }], [{ id: VALID_SCRIPT_ID }]));
        return fn(makeInsertTx('fail-call-uuid'));
      },
    );

    mockDispatchCall.mockRejectedValue(new Error('no_phone_number'));

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(500);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('no_phone_number');
  });
});

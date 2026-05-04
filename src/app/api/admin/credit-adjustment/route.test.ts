import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockAdjust, mockEnv } = vi.hoisted(() => {
  const mockAdjust = vi.fn().mockResolvedValue(undefined);
  const mockEnv = { INTERNAL_ADMIN_TOKEN: 'test-admin-token-32-chars-minimum!!' };

  return { mockAdjust, mockEnv };
});

vi.mock('@/lib/services/credit', () => ({
  adjust: mockAdjust,
}));

vi.mock('@/lib/env', () => ({
  env: mockEnv,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { POST } from './route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request('http://localhost/api/admin/credit-adjustment', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  orgId: '550e8400-e29b-41d4-a716-446655440000',
  deltaCents: 500,
  reason: 'Manual correction by ops team',
};

const VALID_TOKEN = 'test-admin-token-32-chars-minimum!!';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/admin/credit-adjustment', () => {
  beforeEach(() => {
    mockAdjust.mockClear();
  });

  it('returns 401 when x-admin-token header is missing', async () => {
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorized');
    expect(mockAdjust).not.toHaveBeenCalled();
  });

  it('returns 401 when x-admin-token is wrong', async () => {
    const res = await POST(makeRequest(VALID_BODY, { 'x-admin-token': 'wrong-token' }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorized');
    expect(mockAdjust).not.toHaveBeenCalled();
  });

  it('returns 400 when body is not valid JSON', async () => {
    const req = new Request('http://localhost/api/admin/credit-adjustment', {
      method: 'POST',
      headers: { 'x-admin-token': VALID_TOKEN, 'content-type': 'application/json' },
      body: 'not-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid JSON body');
    expect(mockAdjust).not.toHaveBeenCalled();
  });

  it('returns 400 when orgId is not a UUID', async () => {
    const res = await POST(
      makeRequest({ ...VALID_BODY, orgId: 'not-a-uuid' }, { 'x-admin-token': VALID_TOKEN }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid request body');
    expect(mockAdjust).not.toHaveBeenCalled();
  });

  it('returns 400 when deltaCents is not an integer', async () => {
    const res = await POST(
      makeRequest({ ...VALID_BODY, deltaCents: 1.5 }, { 'x-admin-token': VALID_TOKEN }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid request body');
    expect(mockAdjust).not.toHaveBeenCalled();
  });

  it('returns 400 when reason is empty', async () => {
    const res = await POST(
      makeRequest({ ...VALID_BODY, reason: '' }, { 'x-admin-token': VALID_TOKEN }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid request body');
    expect(mockAdjust).not.toHaveBeenCalled();
  });

  it('calls adjust with system actorType and returns ok on success', async () => {
    mockAdjust.mockResolvedValueOnce(undefined);
    const res = await POST(makeRequest(VALID_BODY, { 'x-admin-token': VALID_TOKEN }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(mockAdjust).toHaveBeenCalledOnce();
    expect(mockAdjust).toHaveBeenCalledWith(
      VALID_BODY.orgId,
      'system',
      VALID_BODY.deltaCents,
      VALID_BODY.reason,
      { actorType: 'system' },
    );
  });

  it('supports negative deltaCents for debits', async () => {
    const res = await POST(
      makeRequest({ ...VALID_BODY, deltaCents: -200 }, { 'x-admin-token': VALID_TOKEN }),
    );
    expect(res.status).toBe(200);
    expect(mockAdjust).toHaveBeenCalledWith(
      VALID_BODY.orgId,
      'system',
      -200,
      VALID_BODY.reason,
      { actorType: 'system' },
    );
  });

  it('returns 500 when adjust throws', async () => {
    mockAdjust.mockRejectedValueOnce(new Error('DB error'));
    const res = await POST(makeRequest(VALID_BODY, { 'x-admin-token': VALID_TOKEN }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('DB error');
  });
});

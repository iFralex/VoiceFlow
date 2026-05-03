import { createHmac } from 'crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { mockWithSystemContext, mockInsert, mockSelect, mockRecordAudit } = vi.hoisted(() => {
  // Declared as untyped vi.fn() so mockReturnValueOnce can accept any shape.
  const mockInsert: ReturnType<typeof vi.fn> = vi.fn();
  const mockSelect: ReturnType<typeof vi.fn> = vi.fn();

  const mockTx = {
    insert: mockInsert,
    select: mockSelect,
  };

  const mockWithSystemContext = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockTx));
  const mockRecordAudit = vi.fn();

  return { mockWithSystemContext, mockInsert, mockSelect, mockRecordAudit };
});

vi.mock('@/lib/db/context', () => ({
  withSystemContext: mockWithSystemContext,
}));

vi.mock('@/lib/db/audit', () => ({
  recordAudit: mockRecordAudit,
}));

vi.mock('@/lib/db/schema', () => ({
  webhookEvents: { id: 'webhook_events_id' },
  authSignins: {
    id: 'auth_signins_id',
    user_id: 'auth_signins_user_id',
    ip: 'auth_signins_ip',
    user_agent: 'auth_signins_user_agent',
    signed_in_at: 'auth_signins_signed_in_at',
  },
}));

vi.mock('@/lib/env', () => ({
  env: {
    INTERNAL_WEBHOOK_SECRET: 'test-secret-32-characters-long!!',
  },
}));

// drizzle operators are identity functions in unit tests
vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  eq: (col: unknown, val: unknown) => ({ type: 'eq', col, val }),
  gte: (col: unknown, val: unknown) => ({ type: 'gte', col, val }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import { POST } from './route';

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const SECRET = 'test-secret-32-characters-long!!';

function sign(body: string, secret: string = SECRET): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

function makeRequest(
  body: unknown,
  options: { signature?: string | null; userAgent?: string } = {},
): Request {
  const rawBody = JSON.stringify(body);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.signature !== null) {
    headers['x-supabase-signature'] = options.signature ?? sign(rawBody);
  }
  if (options.userAgent) {
    headers['user-agent'] = options.userAgent;
  }
  return new Request('http://localhost/api/webhooks/supabase-auth', {
    method: 'POST',
    headers,
    body: rawBody,
  });
}

/**
 * Configures mockInsert to handle a typical two-call sequence:
 *  1. webhookEvents insert with onConflictDoNothing → returning
 *  2. authSignins direct insert (optional, defaults to no-op)
 */
function setupInsertSequence(
  webhookResult: unknown[],
  authSigninResult: unknown[] = [],
): void {
  mockInsert
    .mockReturnValueOnce({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue(webhookResult),
        })),
      })),
    })
    .mockReturnValueOnce({
      values: vi.fn().mockResolvedValue(authSigninResult),
    });
}

/** Sets up tx.select() to simulate no existing fingerprint (new device). */
function setupNoExistingFingerprint(): void {
  const mockLimit = vi.fn().mockResolvedValue([]);
  const mockWhere = vi.fn(() => ({ limit: mockLimit }));
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  mockSelect.mockReturnValue({ from: mockFrom });
}

/** Sets up tx.select() to simulate an existing fingerprint (known device). */
function setupExistingFingerprint(): void {
  const mockLimit = vi.fn().mockResolvedValue([{ id: 'existing-id' }]);
  const mockWhere = vi.fn(() => ({ limit: mockLimit }));
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  mockSelect.mockReturnValue({ from: mockFrom });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/webhooks/supabase-auth', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Re-establish withSystemContext implementation after reset clears it
    mockWithSystemContext.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ insert: mockInsert, select: mockSelect }),
    );
  });

  // ── Signature verification ────────────────────────────────────────────────

  describe('signature verification', () => {
    it('accepts request with valid HMAC-SHA256 signature', async () => {
      setupInsertSequence([{ id: 'new' }]);
      setupNoExistingFingerprint();

      const body = { type: 'SIGNED_IN', user: { id: USER_ID } };
      const res = await POST(makeRequest(body));
      expect(res.status).toBe(200);
    });

    it('rejects request with invalid signature', async () => {
      const body = { type: 'SIGNED_IN', user: { id: USER_ID } };
      const res = await POST(makeRequest(body, { signature: 'deadbeef'.repeat(8) }));
      expect(res.status).toBe(401);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe('Invalid signature');
    });

    it('accepts request without a signature header (unsigned)', async () => {
      setupInsertSequence([{ id: 'new' }]);
      setupNoExistingFingerprint();

      const body = { type: 'SIGNED_IN', user: { id: USER_ID } };
      const res = await POST(makeRequest(body, { signature: null }));
      expect(res.status).toBe(200);
    });
  });

  // ── Payload parsing ───────────────────────────────────────────────────────

  describe('payload parsing', () => {
    it('returns 400 for malformed JSON', async () => {
      const req = new Request('http://localhost/api/webhooks/supabase-auth', {
        method: 'POST',
        body: 'not-json',
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 when required type field is absent', async () => {
      const body = { user: { id: USER_ID } }; // missing type
      const res = await POST(makeRequest(body, { signature: null }));
      expect(res.status).toBe(400);
    });

    it('returns 200 and skips processing when no userId is present', async () => {
      const body = { type: 'SIGNED_IN' }; // no user, no user_id
      const res = await POST(makeRequest(body, { signature: null }));
      expect(res.status).toBe(200);
      expect(mockWithSystemContext).not.toHaveBeenCalled();
    });
  });

  // ── Deduplication ─────────────────────────────────────────────────────────

  describe('deduplication', () => {
    it('skips fingerprint check when event already exists in webhook_events', async () => {
      // Conflict → onConflictDoNothing returns []
      setupInsertSequence([]); // empty = conflict

      const body = { type: 'SIGNED_IN', user: { id: USER_ID } };
      const res = await POST(makeRequest(body, { signature: null }));
      expect(res.status).toBe(200);
      // Only the dedup transaction runs
      expect(mockWithSystemContext).toHaveBeenCalledTimes(1);
      expect(mockSelect).not.toHaveBeenCalled();
    });
  });

  // ── Non-signin events ─────────────────────────────────────────────────────

  describe('non-signin events', () => {
    it('records webhook event but skips fingerprint logic for non-signin types', async () => {
      setupInsertSequence([{ id: 'new' }]);

      const body = { type: 'USER_UPDATED', user: { id: USER_ID } };
      const res = await POST(makeRequest(body, { signature: null }));
      expect(res.status).toBe(200);
      expect(mockWithSystemContext).toHaveBeenCalledTimes(1);
      expect(mockSelect).not.toHaveBeenCalled();
    });
  });

  // ── Signin fingerprint logic ──────────────────────────────────────────────

  describe('signin fingerprint logic', () => {
    it('records fingerprint and writes audit entry for a new device', async () => {
      setupInsertSequence([{ id: 'new' }]);
      setupNoExistingFingerprint();

      const body = {
        type: 'SIGNED_IN',
        user: { id: USER_ID },
        ip_address: '1.2.3.4',
        user_agent: 'TestBrowser/1.0',
      };
      const res = await POST(makeRequest(body, { signature: null }));
      expect(res.status).toBe(200);
      expect(mockRecordAudit).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'auth.new_device_signin',
          actorType: 'webhook',
          actorUserId: USER_ID,
          metadata: expect.objectContaining({ ip: '1.2.3.4' }),
        }),
      );
    });

    it('does not write audit entry when fingerprint already seen in last 30 days', async () => {
      setupInsertSequence([{ id: 'new' }]);
      setupExistingFingerprint();

      const body = { type: 'SIGNED_IN', user: { id: USER_ID }, ip_address: '1.2.3.4' };
      const res = await POST(makeRequest(body, { signature: null }));
      expect(res.status).toBe(200);
      expect(mockRecordAudit).not.toHaveBeenCalled();
    });

    it('extracts IP from x-forwarded-for header when absent from payload', async () => {
      setupNoExistingFingerprint();

      // Capture values passed to the authSignins insert
      let capturedInsertValues: unknown = null;
      mockInsert
        .mockReturnValueOnce({
          values: vi.fn(() => ({
            onConflictDoNothing: vi.fn(() => ({
              returning: vi.fn().mockResolvedValue([{ id: 'new' }]),
            })),
          })),
        })
        .mockReturnValueOnce({
          values: vi.fn((vals: unknown) => {
            capturedInsertValues = vals;
            return Promise.resolve([]);
          }),
        });

      const body = { type: 'SIGNED_IN', user: { id: USER_ID } };
      const rawBody = JSON.stringify(body);
      const req = new Request('http://localhost/api/webhooks/supabase-auth', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '192.168.1.1, 10.0.0.1',
        },
        body: rawBody,
      });
      await POST(req);
      expect(capturedInsertValues).toMatchObject({ ip: '192.168.1.1' });
    });

    it('accepts user_id at top level (Database Webhook format)', async () => {
      setupInsertSequence([{ id: 'new' }]);
      setupNoExistingFingerprint();

      const body = { type: 'SIGNED_IN', user_id: USER_ID };
      const res = await POST(makeRequest(body, { signature: null }));
      expect(res.status).toBe(200);
      // Both dedup and fingerprint transactions should have run
      expect(mockWithSystemContext).toHaveBeenCalledTimes(2);
    });

    it('falls back to 0.0.0.0 when no IP is available', async () => {
      setupNoExistingFingerprint();

      let capturedInsertValues: unknown = null;
      mockInsert
        .mockReturnValueOnce({
          values: vi.fn(() => ({
            onConflictDoNothing: vi.fn(() => ({
              returning: vi.fn().mockResolvedValue([{ id: 'new' }]),
            })),
          })),
        })
        .mockReturnValueOnce({
          values: vi.fn((vals: unknown) => {
            capturedInsertValues = vals;
            return Promise.resolve([]);
          }),
        });

      const body = { type: 'SIGNED_IN', user: { id: USER_ID } };
      const rawBody = JSON.stringify(body);
      const req = new Request('http://localhost/api/webhooks/supabase-auth', {
        method: 'POST',
        body: rawBody,
      });
      await POST(req);
      expect(capturedInsertValues).toMatchObject({ ip: '0.0.0.0' });
    });
  });
});

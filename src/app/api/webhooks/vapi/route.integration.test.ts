/**
 * Integration tests for the Vapi webhook POST route handler.
 *
 * Group A — signature verification (no database required)
 *   Verifies that the handler enforces the shared-secret check before
 *   performing any side effects.
 *
 * Group B — duplicate event idempotency (mocked DB context)
 *   Verifies that a second identical `call.ended` webhook event is a no-op:
 *   the `webhook_events` table's unique constraint on (provider, provider_event_id)
 *   causes `onConflictDoNothing()` to return `[]`, which the handler detects
 *   and responds to with 200 without re-invoking the service functions.
 *
 *   Note: msw is not installed in this project; fetch-level mocking is not
 *   needed here since the webhook handler receives inbound requests rather than
 *   making outbound Vapi API calls.
 */

// ── Mocks (hoisted before any imports) ───────────────────────────────────────

vi.mock('@/lib/db/context', () => ({
  withOrgContext: vi.fn(),
  withSystemContext: vi.fn(),
}));

vi.mock('@/lib/services/calls', () => ({
  recordCallStarted: vi.fn().mockResolvedValue(undefined),
  recordCallEnded: vi.fn().mockResolvedValue(undefined),
  recordToolInvocation: vi.fn().mockResolvedValue(undefined),
  CALL_COMPLETED_EVENT: 'call/completed',
  CALL_CLASSIFY_EVENT: 'call/classify',
}));

// ── Imports ──────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/webhooks/vapi/route';
import { withSystemContext } from '@/lib/db/context';
import { recordCallEnded } from '@/lib/services/calls';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Builds a minimal mock transaction whose insert chain returns `insertResult`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeInsertTx(insertResult: unknown[]): any {
  return {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve(insertResult)),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([])),
      })),
    })),
  };
}

/** Constructs a mock Request to POST /api/webhooks/vapi. */
function makeRequest(body: object, vapiSecret?: string): Request {
  return new Request('http://localhost/api/webhooks/vapi', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(vapiSecret !== undefined ? { 'x-vapi-secret': vapiSecret } : {}),
    },
    body: JSON.stringify(body),
  });
}

// A minimal call-end payload that will exercise the call.ended branch
const CALL_END_PAYLOAD = {
  message: {
    type: 'call-end',
    call: {
      id: 'vapi-call-idempotency-test',
      metadata: {
        callId: 'call-idempotency-test',
        orgId: 'org-idempotency-test',
      },
      endedReason: 'completed',
      duration: 120,
    },
  },
};

// ── Group A: signature verification ──────────────────────────────────────────

describe('Vapi webhook POST — signature verification', () => {
  beforeEach(() => {
    vi.stubEnv('SKIP_ENV_VALIDATION', 'true');
    vi.stubEnv('VAPI_WEBHOOK_SECRET', 'correct-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('returns 401 when the x-vapi-secret header is absent', async () => {
    const res = await POST(makeRequest({ message: { type: 'unknown' } }));
    expect(res.status).toBe(401);
  });

  it('returns 401 when the x-vapi-secret header has an incorrect value', async () => {
    const res = await POST(makeRequest({ message: { type: 'unknown' } }, 'wrong-secret'));
    expect(res.status).toBe(401);
  });

  it('returns 200 when x-vapi-secret matches VAPI_WEBHOOK_SECRET', async () => {
    // The handler inserts into webhook_events (withSystemContext #1) then
    // marks it processed (withSystemContext #2). Use simple stubs for both.
    vi.mocked(withSystemContext)
      .mockImplementationOnce((fn) => fn(makeInsertTx([{ id: 'ev-1' }]))) // insert → new
      .mockImplementationOnce((fn) => fn(makeInsertTx([]))); // mark processed

    const res = await POST(
      makeRequest({ message: { type: 'unknown-type', call: { id: 'vc-1' } } }, 'correct-secret'),
    );
    expect(res.status).toBe(200);
  });
});

// ── Group B: duplicate call.ended idempotency ─────────────────────────────────

describe('Vapi webhook POST — duplicate call.ended idempotency', () => {
  beforeEach(() => {
    vi.stubEnv('SKIP_ENV_VALIDATION', 'true');
    vi.stubEnv('VAPI_WEBHOOK_SECRET', 'correct-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('second identical call.ended webhook returns 200 without re-invoking service functions', async () => {
    /**
     * First POST:
     *   withSystemContext #1 — insert webhook_events → [{ id: 'ev-1' }] (new event)
     *   recordCallEnded is invoked (mocked — no withSystemContext call inside)
     *   withSystemContext #2 — mark event processed
     *
     * Second POST (same providerEventId):
     *   withSystemContext #3 — insert webhook_events → [] (conflict → not inserted)
     *   Handler detects !inserted → returns 200 immediately, no service calls
     */
    vi.mocked(withSystemContext)
      .mockImplementationOnce((fn) => fn(makeInsertTx([{ id: 'ev-1' }]))) // #1 first insert → new
      .mockImplementationOnce((fn) => fn(makeInsertTx([]))) // #2 mark processed
      .mockImplementationOnce((fn) => fn(makeInsertTx([]))); // #3 second insert → duplicate

    const req1 = makeRequest(CALL_END_PAYLOAD, 'correct-secret');
    const req2 = makeRequest(CALL_END_PAYLOAD, 'correct-secret');

    const res1 = await POST(req1);
    const res2 = await POST(req2);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    // Service function must have been called exactly once (by the first request only)
    expect(vi.mocked(recordCallEnded)).toHaveBeenCalledTimes(1);
  });

  it('first call.ended webhook always invokes recordCallEnded', async () => {
    vi.mocked(withSystemContext)
      .mockImplementationOnce((fn) => fn(makeInsertTx([{ id: 'ev-2' }]))) // insert → new
      .mockImplementationOnce((fn) => fn(makeInsertTx([]))); // mark processed

    const req = makeRequest(CALL_END_PAYLOAD, 'correct-secret');
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(vi.mocked(recordCallEnded)).toHaveBeenCalledTimes(1);
  });
});

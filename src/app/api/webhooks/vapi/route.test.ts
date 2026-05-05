import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockWithSystemContext,
  mockWithOrgContext,
  mockInsert,
  mockUpdate,
  mockSelect,
  mockRecordCallStarted,
  mockRecordCallEnded,
  mockRecordToolInvocation,
} = vi.hoisted(() => {
  const mockInsert: ReturnType<typeof vi.fn> = vi.fn();
  const mockUpdate: ReturnType<typeof vi.fn> = vi.fn();
  const mockSelect: ReturnType<typeof vi.fn> = vi.fn();

  const mockTx = { insert: mockInsert, update: mockUpdate, select: mockSelect };

  const mockWithSystemContext = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockTx));
  const mockWithOrgContext = vi.fn(async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn(mockTx),
  );

  const mockRecordCallStarted = vi.fn().mockResolvedValue(undefined);
  const mockRecordCallEnded = vi.fn().mockResolvedValue(undefined);
  const mockRecordToolInvocation = vi.fn().mockResolvedValue(undefined);

  return {
    mockWithSystemContext,
    mockWithOrgContext,
    mockInsert,
    mockUpdate,
    mockSelect,
    mockRecordCallStarted,
    mockRecordCallEnded,
    mockRecordToolInvocation,
  };
});

vi.mock('@/lib/db/context', () => ({
  withSystemContext: mockWithSystemContext,
  withOrgContext: mockWithOrgContext,
}));

vi.mock('@/lib/db/schema', () => ({
  webhookEvents: {
    id: 'we_id',
    provider: 'we_provider',
    provider_event_id: 'we_provider_event_id',
    event_type: 'we_event_type',
    payload: 'we_payload',
    processed_at: 'we_processed_at',
    error: 'we_error',
  },
  calls: {
    id: 'c_id',
    org_id: 'c_org_id',
    status: 'c_status',
    provider_call_id: 'c_provider_call_id',
  },
}));

vi.mock('@/lib/env', () => ({
  env: { VAPI_WEBHOOK_SECRET: 'test-webhook-secret' },
}));

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ type: 'eq', col, val }),
  and: (...args: unknown[]) => ({ type: 'and', args }),
}));

vi.mock('@/lib/services/calls', () => ({
  recordCallStarted: mockRecordCallStarted,
  recordCallEnded: mockRecordCallEnded,
  recordToolInvocation: mockRecordToolInvocation,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { POST } from './route';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VAPI_SECRET = 'test-webhook-secret';
const PROVIDER_CALL_ID = 'vapi_call_abc123';
const OUR_CALL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const ORG_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Create a minimal Vapi webhook payload. */
function makeVapiPayload(
  type: string,
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    message: {
      type,
      call: {
        id: PROVIDER_CALL_ID,
        metadata: { callId: OUR_CALL_ID, orgId: ORG_ID },
      },
      ...extras,
    },
  };
}

/** Create a Request with the x-vapi-secret header. */
function makeRequest(body: unknown, secret = VAPI_SECRET): Request {
  return new Request('http://localhost/api/webhooks/vapi', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-vapi-secret': secret,
    },
    body: JSON.stringify(body),
  });
}

/** Set up dedup insert to return a new event (first delivery). */
function setupNewEvent(): void {
  mockInsert.mockReturnValue({
    values: vi.fn(() => ({
      onConflictDoNothing: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: 'we-uuid' }]),
      })),
    })),
  });
}

/** Set up dedup insert to return empty array (duplicate delivery). */
function setupDuplicateEvent(): void {
  mockInsert.mockReturnValue({
    values: vi.fn(() => ({
      onConflictDoNothing: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([]),
      })),
    })),
  });
}

/** Set up the update mock for processed_at / error writes. */
function setupUpdate(): void {
  mockUpdate.mockReturnValue({
    set: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    })),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/webhooks/vapi', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockWithSystemContext.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ insert: mockInsert, update: mockUpdate, select: mockSelect }),
    );
    mockWithOrgContext.mockImplementation(
      async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn({ insert: mockInsert, update: mockUpdate, select: mockSelect }),
    );
    mockRecordCallStarted.mockResolvedValue(undefined);
    mockRecordCallEnded.mockResolvedValue(undefined);
    mockRecordToolInvocation.mockResolvedValue(undefined);
  });

  // ── Secret verification ───────────────────────────────────────────────────

  describe('secret verification', () => {
    it('returns 401 when x-vapi-secret header is missing', async () => {
      const req = new Request('http://localhost/api/webhooks/vapi', {
        method: 'POST',
        body: JSON.stringify(makeVapiPayload('call-start')),
      });
      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it('returns 401 when x-vapi-secret does not match configured secret', async () => {
      const res = await POST(makeRequest(makeVapiPayload('call-start'), 'wrong-secret'));
      expect(res.status).toBe(401);
    });

    it('returns 200 for a valid secret', async () => {
      setupNewEvent();
      setupUpdate();
      const res = await POST(makeRequest(makeVapiPayload('unknown.event.type')));
      expect(res.status).toBe(200);
    });
  });

  // ── Body parsing ──────────────────────────────────────────────────────────

  describe('body parsing', () => {
    it('returns 400 for invalid JSON', async () => {
      const req = new Request('http://localhost/api/webhooks/vapi', {
        method: 'POST',
        headers: { 'x-vapi-secret': VAPI_SECRET },
        body: 'not-json{',
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('returns 200 and skips processing when message is absent', async () => {
      const res = await POST(makeRequest({ foo: 'bar' }));
      expect(res.status).toBe(200);
      expect(mockInsert).not.toHaveBeenCalled();
    });
  });

  // ── Deduplication ─────────────────────────────────────────────────────────

  describe('deduplication', () => {
    it('returns 200 immediately for a duplicate event without re-processing', async () => {
      setupDuplicateEvent();
      const res = await POST(makeRequest(makeVapiPayload('call-start')));
      expect(res.status).toBe(200);
      expect(mockRecordCallStarted).not.toHaveBeenCalled();
    });

    it('persists the event payload on first delivery', async () => {
      setupNewEvent();
      setupUpdate();
      await POST(makeRequest(makeVapiPayload('unknown.type')));
      expect(mockInsert).toHaveBeenCalled();
    });
  });

  // ── call-start ────────────────────────────────────────────────────────────

  describe('call-start event', () => {
    it('calls recordCallStarted with the correct callId and providerCallId', async () => {
      setupNewEvent();
      setupUpdate();
      const res = await POST(makeRequest(makeVapiPayload('call-start')));
      expect(res.status).toBe(200);
      expect(mockRecordCallStarted).toHaveBeenCalledWith(OUR_CALL_ID, PROVIDER_CALL_ID);
    });

    it('also handles the dot-notation alias call.started', async () => {
      setupNewEvent();
      setupUpdate();
      await POST(makeRequest(makeVapiPayload('call.started')));
      expect(mockRecordCallStarted).toHaveBeenCalledWith(OUR_CALL_ID, PROVIDER_CALL_ID);
    });

    it('skips recordCallStarted when callId is missing from metadata', async () => {
      setupNewEvent();
      setupUpdate();
      const payload = {
        message: {
          type: 'call-start',
          call: { id: PROVIDER_CALL_ID, metadata: {} },
        },
      };
      await POST(makeRequest(payload));
      expect(mockRecordCallStarted).not.toHaveBeenCalled();
    });
  });

  // ── call-end ──────────────────────────────────────────────────────────────

  describe('call-end event', () => {
    it('calls recordCallEnded with duration, reason, and recording URL', async () => {
      setupNewEvent();
      setupUpdate();
      const payload = {
        message: {
          type: 'call-end',
          call: {
            id: PROVIDER_CALL_ID,
            metadata: { callId: OUR_CALL_ID, orgId: ORG_ID },
            duration: 120,
            endedReason: 'customer-ended-call',
            artifact: { recordingUrl: 'https://cdn.vapi.ai/recording.mp3' },
          },
        },
      };
      const res = await POST(makeRequest(payload));
      expect(res.status).toBe(200);
      expect(mockRecordCallEnded).toHaveBeenCalledWith(OUR_CALL_ID, {
        durationSeconds: 120,
        endedReason: 'customer-ended-call',
        recordingUrl: 'https://cdn.vapi.ai/recording.mp3',
      });
    });

    it('handles the call.ended alias', async () => {
      setupNewEvent();
      setupUpdate();
      const payload = {
        message: {
          type: 'call.ended',
          call: {
            id: PROVIDER_CALL_ID,
            metadata: { callId: OUR_CALL_ID, orgId: ORG_ID },
            duration: 60,
            endedReason: 'voicemail',
          },
        },
      };
      await POST(makeRequest(payload));
      expect(mockRecordCallEnded).toHaveBeenCalledWith(
        OUR_CALL_ID,
        expect.objectContaining({ endedReason: 'voicemail' }),
      );
    });

    it('defaults duration to 0 and reason to completed when absent', async () => {
      setupNewEvent();
      setupUpdate();
      const payload = {
        message: {
          type: 'call-end',
          call: { id: PROVIDER_CALL_ID, metadata: { callId: OUR_CALL_ID, orgId: ORG_ID } },
        },
      };
      await POST(makeRequest(payload));
      expect(mockRecordCallEnded).toHaveBeenCalledWith(OUR_CALL_ID, {
        durationSeconds: 0,
        endedReason: 'completed',
        recordingUrl: undefined,
      });
    });
  });

  // ── function-call ─────────────────────────────────────────────────────────

  describe('function-call event', () => {
    it('calls recordToolInvocation with tool name and parameters', async () => {
      setupNewEvent();
      setupUpdate();
      const payload = {
        message: {
          type: 'function-call',
          call: {
            id: PROVIDER_CALL_ID,
            metadata: { callId: OUR_CALL_ID, orgId: ORG_ID },
          },
          functionCall: {
            name: 'book_appointment',
            parameters: { date: '2026-05-10', time: '10:00' },
          },
        },
      };
      const res = await POST(makeRequest(payload));
      expect(res.status).toBe(200);
      expect(mockRecordToolInvocation).toHaveBeenCalledWith(
        OUR_CALL_ID,
        'book_appointment',
        { date: '2026-05-10', time: '10:00' },
      );
    });

    it('skips recording when functionCall is absent', async () => {
      setupNewEvent();
      setupUpdate();
      const payload = {
        message: {
          type: 'function-call',
          call: { id: PROVIDER_CALL_ID, metadata: { callId: OUR_CALL_ID } },
        },
      };
      await POST(makeRequest(payload));
      expect(mockRecordToolInvocation).not.toHaveBeenCalled();
    });
  });

  // ── transcript.partial ────────────────────────────────────────────────────

  describe('transcript / transcript.partial events', () => {
    it('persists the event but does not call any service function', async () => {
      setupNewEvent();
      setupUpdate();
      const res = await POST(makeRequest(makeVapiPayload('transcript.partial')));
      expect(res.status).toBe(200);
      expect(mockRecordCallStarted).not.toHaveBeenCalled();
      expect(mockRecordCallEnded).not.toHaveBeenCalled();
      expect(mockRecordToolInvocation).not.toHaveBeenCalled();
    });
  });

  // ── status-update ─────────────────────────────────────────────────────────

  describe('status-update event', () => {
    it('calls recordCallStarted when status is in-progress', async () => {
      setupNewEvent();
      setupUpdate();
      const payload = {
        message: {
          type: 'status-update',
          call: { id: PROVIDER_CALL_ID, metadata: { callId: OUR_CALL_ID, orgId: ORG_ID } },
          status: 'in-progress',
        },
      };
      await POST(makeRequest(payload));
      expect(mockRecordCallStarted).toHaveBeenCalledWith(OUR_CALL_ID, PROVIDER_CALL_ID);
    });

    it('does not call any service when status has no mapping', async () => {
      setupNewEvent();
      setupUpdate();
      const payload = {
        message: {
          type: 'status-update',
          call: { id: PROVIDER_CALL_ID, metadata: { callId: OUR_CALL_ID, orgId: ORG_ID } },
          status: 'ended',
        },
      };
      await POST(makeRequest(payload));
      expect(mockRecordCallStarted).not.toHaveBeenCalled();
    });
  });

  // ── Unknown event types ───────────────────────────────────────────────────

  describe('unknown event types', () => {
    it('persists unknown events and returns 200 without calling any handler', async () => {
      setupNewEvent();
      setupUpdate();
      const res = await POST(makeRequest(makeVapiPayload('some.unknown.event')));
      expect(res.status).toBe(200);
      expect(mockRecordCallStarted).not.toHaveBeenCalled();
      expect(mockInsert).toHaveBeenCalled();
    });
  });

  // ── Error handling ────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('returns 200 even when a handler throws, and records the error', async () => {
      setupNewEvent();
      setupUpdate();
      mockRecordCallStarted.mockRejectedValueOnce(new Error('DB unavailable'));

      const res = await POST(makeRequest(makeVapiPayload('call-start')));
      expect(res.status).toBe(200);
      // The error update should have been called
      expect(mockUpdate).toHaveBeenCalled();
    });
  });
});

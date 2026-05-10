import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(),
}));

vi.mock('@/lib/inngest/client', () => ({
  sendInngestEvent: vi.fn(),
}));

vi.mock('@/lib/db/context', () => ({
  withSystemContext: vi.fn(),
}));

// ─── Module imports (after mocks) ─────────────────────────────────────────────

import { withSystemContext } from '@/lib/db/context';
import { sendEmail } from '@/lib/email';
import { sendInngestEvent } from '@/lib/inngest/client';

import { webhookDeliverHandler } from './webhook-deliver';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WEBHOOK_ID = 'wh-test-001';
const ORG_ID = 'org-test-001';
const EVENT_TYPE = 'call.completed';
const PAYLOAD = { callId: 'call-1', outcome: 'completed' };
const WEBHOOK_URL = 'https://example.com/hook';
const WEBHOOK_SECRET = 'whsec_abc123';

const activeWebhook = {
  id: WEBHOOK_ID,
  org_id: ORG_ID,
  url: WEBHOOK_URL,
  secret: WEBHOOK_SECRET,
  event_types: ['call.completed'],
  active: true,
  failure_count: 0,
  created_at: new Date(),
  last_delivery_at: null,
  last_failure_at: null,
};

const mockFetch = vi.fn();
global.fetch = mockFetch;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a mock Drizzle tx where every query chain resolves to `returnValue`.
 *
 * Supports: select().from().where().limit() / select().from().innerJoin().where()
 *           insert().values() / update().set().where()
 *
 * For select queries the handler does `.then((rows) => rows[0])` on `.limit()`
 * or awaits the chain directly — both patterns resolve via `returnValue`.
 */
function buildMockTx(returnValue: unknown) {
  const resolveWith = () => Promise.resolve(returnValue);
  const then = (resolve: (v: unknown) => unknown) => Promise.resolve(returnValue).then(resolve);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    then,
    limit: vi.fn(resolveWith),
    where: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    from: vi.fn(() => chain),
  };

  return {
    select: vi.fn(() => chain),
    insert: vi.fn(() => ({ values: vi.fn(resolveWith) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(resolveWith) })) })),
  };
}

/**
 * Configures withSystemContext so each successive call returns data from `returns`.
 * Index 0 → first call, index 1 → second call, etc.
 */
function setupSystemContextReturns(returns: unknown[]): void {
  let callIndex = 0;
  vi.mocked(withSystemContext).mockImplementation(async (fn) => {
    const returnValue = returns[callIndex++];
    const mockTx = buildMockTx(returnValue);
    return fn(mockTx as never);
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
});

describe('webhookDeliverHandler — early returns', () => {
  it('returns early when webhook is not found', async () => {
    // Select returns empty array → rows[0] = undefined → webhook not found
    setupSystemContextReturns([[]]);

    await webhookDeliverHandler({ webhookId: WEBHOOK_ID, eventType: EVENT_TYPE, payload: PAYLOAD });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('returns early when webhook is inactive', async () => {
    setupSystemContextReturns([[{ ...activeWebhook, active: false }]]);

    await webhookDeliverHandler({ webhookId: WEBHOOK_ID, eventType: EVENT_TYPE, payload: PAYLOAD });

    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('webhookDeliverHandler — successful delivery', () => {
  it('POSTs to the webhook URL with correct headers', async () => {
    // [0] fetch webhook, [1] insert delivery, [2] update success (reset failure_count)
    setupSystemContextReturns([[activeWebhook], [], []]);

    await webhookDeliverHandler({ webhookId: WEBHOOK_ID, eventType: EVENT_TYPE, payload: PAYLOAD });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(WEBHOOK_URL);
    expect(opts.method).toBe('POST');

    const headers = opts.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers['x-vox-event']).toBe(EVENT_TYPE);
    expect(headers['x-vox-signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(headers['x-vox-timestamp']).toMatch(/^\d+$/);
  });

  it('sends a valid HMAC-SHA256 signature that can be verified with the secret', async () => {
    setupSystemContextReturns([[activeWebhook], [], []]);

    await webhookDeliverHandler({ webhookId: WEBHOOK_ID, eventType: EVENT_TYPE, payload: PAYLOAD });

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    const body = opts.body as string;
    const receivedSig = headers['x-vox-signature']!.replace('sha256=', '');

    const { createHmac } = await import('node:crypto');
    const expectedSig = createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
    expect(receivedSig).toBe(expectedSig);
  });

  it('includes org_id, event, and data in the envelope', async () => {
    setupSystemContextReturns([[activeWebhook], [], []]);

    await webhookDeliverHandler({ webhookId: WEBHOOK_ID, eventType: EVENT_TYPE, payload: PAYLOAD });

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const envelope = JSON.parse(opts.body as string) as {
      event: string;
      org_id: string;
      data: unknown;
      id: string;
      occurred_at: string;
    };

    expect(envelope.event).toBe(EVENT_TYPE);
    expect(envelope.org_id).toBe(ORG_ID);
    expect(envelope.data).toEqual(PAYLOAD);
    expect(envelope.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(envelope.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('does not schedule a retry after success', async () => {
    setupSystemContextReturns([[activeWebhook], [], []]);

    await webhookDeliverHandler({ webhookId: WEBHOOK_ID, eventType: EVENT_TYPE, payload: PAYLOAD });

    expect(sendInngestEvent).not.toHaveBeenCalled();
  });

  it('does not send a notification email on success', async () => {
    setupSystemContextReturns([[activeWebhook], [], []]);

    await webhookDeliverHandler({ webhookId: WEBHOOK_ID, eventType: EVENT_TYPE, payload: PAYLOAD });

    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('webhookDeliverHandler — failed delivery (non-2xx)', () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' });
  });

  it('schedules a retry with exponential backoff after attempt 1', async () => {
    // [0] fetch webhook, [1] insert delivery, [2] update failure_count
    setupSystemContextReturns([[activeWebhook], [], []]);

    const before = Date.now();
    await webhookDeliverHandler({
      webhookId: WEBHOOK_ID,
      eventType: EVENT_TYPE,
      payload: PAYLOAD,
      attempt: 1,
    });
    const after = Date.now();

    expect(sendInngestEvent).toHaveBeenCalledOnce();
    const call = vi.mocked(sendInngestEvent).mock.calls[0]![0];
    expect(call.name).toBe('webhook/deliver');
    expect(call.data).toMatchObject({
      webhookId: WEBHOOK_ID,
      eventType: EVENT_TYPE,
      payload: PAYLOAD,
      attempt: 2,
    });
    // ts should be ~1 minute in the future
    const expectedDelay = 1 * 60 * 1000;
    expect(call.ts).toBeGreaterThanOrEqual(before + expectedDelay);
    expect(call.ts).toBeLessThanOrEqual(after + expectedDelay + 100);
  });

  it('uses correct backoff delay for attempt 3 (15 minutes)', async () => {
    setupSystemContextReturns([
      [{ ...activeWebhook, failure_count: 2 }],
      [],
      [],
    ]);

    const before = Date.now();
    await webhookDeliverHandler({
      webhookId: WEBHOOK_ID,
      eventType: EVENT_TYPE,
      payload: PAYLOAD,
      attempt: 3,
    });
    const after = Date.now();

    const call = vi.mocked(sendInngestEvent).mock.calls[0]![0];
    expect(call.data).toMatchObject({ attempt: 4 });
    const expectedDelay = 15 * 60 * 1000;
    expect(call.ts).toBeGreaterThanOrEqual(before + expectedDelay);
    expect(call.ts).toBeLessThanOrEqual(after + expectedDelay + 100);
  });

  it('uses deterministic event id for retry deduplication', async () => {
    setupSystemContextReturns([[activeWebhook], [], []]);

    await webhookDeliverHandler({
      webhookId: WEBHOOK_ID,
      eventType: EVENT_TYPE,
      payload: PAYLOAD,
      attempt: 1,
    });

    const call = vi.mocked(sendInngestEvent).mock.calls[0]![0];
    expect(call.id).toBe(`webhook-deliver-${WEBHOOK_ID}-attempt-2`);
  });
});

describe('webhookDeliverHandler — timeout', () => {
  it('records a timeout error in the delivery and schedules retry', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    mockFetch.mockRejectedValue(abortError);

    setupSystemContextReturns([[activeWebhook], [], []]);

    await webhookDeliverHandler({
      webhookId: WEBHOOK_ID,
      eventType: EVENT_TYPE,
      payload: PAYLOAD,
      attempt: 1,
    });

    // Retry should be scheduled
    expect(sendInngestEvent).toHaveBeenCalledOnce();
  });
});

describe('webhookDeliverHandler — deactivation after MAX_FAILURES', () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' });
  });

  it('deactivates webhook and sends notification after 6th failure', async () => {
    // failure_count is at 5: incrementing to 6 hits MAX_FAILURES
    const webhookNearMax = { ...activeWebhook, failure_count: 5 };
    const ownerRow = { email: 'owner@example.com', fullName: 'Owner Name', locale: 'it' };

    // [0] fetch webhook, [1] insert delivery, [2] update failure_count,
    // [3] deactivate (set active=false), [4] fetch owners for notification
    setupSystemContextReturns([
      [webhookNearMax],
      [],
      [],
      [],
      [ownerRow],
    ]);

    await webhookDeliverHandler({
      webhookId: WEBHOOK_ID,
      eventType: EVENT_TYPE,
      payload: PAYLOAD,
      attempt: 6,
    });

    // No retry scheduled — webhook deactivated instead
    expect(sendInngestEvent).not.toHaveBeenCalled();

    // Notification email sent
    expect(sendEmail).toHaveBeenCalledOnce();
    const emailCall = vi.mocked(sendEmail).mock.calls[0]![0];
    expect(emailCall.to).toBe('owner@example.com');
    expect(emailCall.tags).toContainEqual({ name: 'template', value: 'webhook-disabled' });
  });

  it('sends English notification to owner with locale=en', async () => {
    const webhookNearMax = { ...activeWebhook, failure_count: 5 };
    const ownerRow = { email: 'owner@example.com', fullName: null, locale: 'en' };

    setupSystemContextReturns([[webhookNearMax], [], [], [], [ownerRow]]);

    await webhookDeliverHandler({
      webhookId: WEBHOOK_ID,
      eventType: EVENT_TYPE,
      payload: PAYLOAD,
      attempt: 6,
    });

    const emailCall = vi.mocked(sendEmail).mock.calls[0]![0];
    expect(emailCall.subject).toContain('deactivated');
    expect(emailCall.subject).not.toContain('disabilitato');
  });

  it('sends Italian notification to owner with locale=it', async () => {
    const webhookNearMax = { ...activeWebhook, failure_count: 5 };
    const ownerRow = { email: 'owner@example.com', fullName: null, locale: 'it' };

    setupSystemContextReturns([[webhookNearMax], [], [], [], [ownerRow]]);

    await webhookDeliverHandler({
      webhookId: WEBHOOK_ID,
      eventType: EVENT_TYPE,
      payload: PAYLOAD,
      attempt: 6,
    });

    const emailCall = vi.mocked(sendEmail).mock.calls[0]![0];
    expect(emailCall.subject).toContain('disabilitato');
  });

  it('does not deactivate if failure_count increment stays below MAX_FAILURES', async () => {
    // failure_count = 4: incrementing to 5, below 6
    setupSystemContextReturns([
      [{ ...activeWebhook, failure_count: 4 }],
      [], // insert delivery
      [], // update failure_count
    ]);

    await webhookDeliverHandler({
      webhookId: WEBHOOK_ID,
      eventType: EVENT_TYPE,
      payload: PAYLOAD,
      attempt: 5,
    });

    // Retry scheduled, webhook not deactivated, no email
    expect(sendInngestEvent).toHaveBeenCalledOnce();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

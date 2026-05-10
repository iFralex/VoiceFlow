import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/inngest/client', () => ({
  sendInngestEvents: vi.fn(),
}));

vi.mock('@/lib/db/context', () => ({
  withSystemContext: vi.fn(),
}));

// ─── Module imports (after mocks) ─────────────────────────────────────────────

import { withSystemContext } from '@/lib/db/context';
import { sendInngestEvents } from '@/lib/inngest/client';

import { webhookEmitFanoutHandler } from './webhook-fanout';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_ID = 'org-fanout-001';
const EVENT_TYPE = 'call.completed';
const PAYLOAD = { callId: 'call-1', status: 'completed' };
const WEBHOOK_ID_A = 'wh-aaa';
const WEBHOOK_ID_B = 'wh-bbb';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildMockTx(returnValue: unknown) {
  const resolveWith = () => Promise.resolve(returnValue);
  const then = (resolve: (v: unknown) => unknown) => Promise.resolve(returnValue).then(resolve);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    then,
    limit: vi.fn(resolveWith),
    where: vi.fn(() => chain),
    from: vi.fn(() => chain),
  };

  return { select: vi.fn(() => chain) };
}

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
});

describe('webhookEmitFanoutHandler — no matching webhooks', () => {
  it('does nothing when no active webhooks match the event type', async () => {
    setupSystemContextReturns([[]]); // empty result

    await webhookEmitFanoutHandler({ orgId: ORG_ID, eventType: EVENT_TYPE, payload: PAYLOAD });

    expect(sendInngestEvents).not.toHaveBeenCalled();
  });
});

describe('webhookEmitFanoutHandler — single matching webhook', () => {
  it('sends one webhook/deliver event for the matching webhook', async () => {
    setupSystemContextReturns([[{ id: WEBHOOK_ID_A }]]);

    await webhookEmitFanoutHandler({ orgId: ORG_ID, eventType: EVENT_TYPE, payload: PAYLOAD });

    expect(sendInngestEvents).toHaveBeenCalledOnce();
    const events = vi.mocked(sendInngestEvents).mock.calls[0]![0];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: 'webhook/deliver',
      data: { webhookId: WEBHOOK_ID_A, eventType: EVENT_TYPE, payload: PAYLOAD },
    });
  });

  it('sets a deterministic event ID when dedupKey is provided', async () => {
    setupSystemContextReturns([[{ id: WEBHOOK_ID_A }]]);

    await webhookEmitFanoutHandler({
      orgId: ORG_ID,
      eventType: EVENT_TYPE,
      payload: PAYLOAD,
      dedupKey: 'call-123',
    });

    const events = vi.mocked(sendInngestEvents).mock.calls[0]![0];
    expect(events[0]!.id).toBe(`webhook-deliver-${WEBHOOK_ID_A}-${EVENT_TYPE}-call-123`);
  });

  it('omits event ID when no dedupKey is provided', async () => {
    setupSystemContextReturns([[{ id: WEBHOOK_ID_A }]]);

    await webhookEmitFanoutHandler({ orgId: ORG_ID, eventType: EVENT_TYPE, payload: PAYLOAD });

    const events = vi.mocked(sendInngestEvents).mock.calls[0]![0];
    expect(events[0]!.id).toBeUndefined();
  });
});

describe('webhookEmitFanoutHandler — multiple matching webhooks', () => {
  it('fans out one deliver event per matching webhook', async () => {
    setupSystemContextReturns([[{ id: WEBHOOK_ID_A }, { id: WEBHOOK_ID_B }]]);

    await webhookEmitFanoutHandler({
      orgId: ORG_ID,
      eventType: EVENT_TYPE,
      payload: PAYLOAD,
      dedupKey: 'call-456',
    });

    const events = vi.mocked(sendInngestEvents).mock.calls[0]![0];
    expect(events).toHaveLength(2);

    const ids = events.map((e) => e.id);
    expect(ids).toContain(`webhook-deliver-${WEBHOOK_ID_A}-${EVENT_TYPE}-call-456`);
    expect(ids).toContain(`webhook-deliver-${WEBHOOK_ID_B}-${EVENT_TYPE}-call-456`);
  });

  it('includes the correct payload in each deliver event', async () => {
    setupSystemContextReturns([[{ id: WEBHOOK_ID_A }, { id: WEBHOOK_ID_B }]]);

    await webhookEmitFanoutHandler({ orgId: ORG_ID, eventType: EVENT_TYPE, payload: PAYLOAD });

    const events = vi.mocked(sendInngestEvents).mock.calls[0]![0];
    for (const event of events) {
      expect(event.data).toMatchObject({ eventType: EVENT_TYPE, payload: PAYLOAD });
    }
  });
});

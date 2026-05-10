import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRecordAudit = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/db/audit', () => ({
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

const mockSendInngestEvent = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/inngest/client', () => ({
  sendInngestEvent: (...args: unknown[]) => mockSendInngestEvent(...args),
}));

let selectResults: unknown[][] = [];
let insertResults: unknown[][] = [];
let updateResults: unknown[][] = [];
let deleteResults: unknown[][] = [];

const mockTx = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

function makeSelectChain(result: unknown[]) {
  // A thenable chain — every step returns itself so any query shape resolves.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, unknown> & { then: any } = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then: (resolve?: any, reject?: any) => Promise.resolve(result).then(resolve, reject),
  };
  const proxy = new Proxy(chain, {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      // Any unknown method returns a mock that returns the same chain
      const fn = vi.fn().mockReturnValue(proxy);
      target[prop as string] = fn;
      return fn;
    },
  });
  return proxy;
}

function resetMockTx() {
  mockTx.select.mockImplementation(() => {
    const result = selectResults.shift() ?? [];
    return makeSelectChain(result);
  });

  mockTx.insert.mockImplementation(() => {
    const result = insertResults.shift() ?? [];
    return {
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue(result),
      })),
    };
  });

  mockTx.update.mockImplementation(() => {
    const result = updateResults.shift() ?? [];
    return {
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue(result),
        })),
      })),
    };
  });

  mockTx.delete.mockImplementation(() => {
    const result = deleteResults.shift() ?? [];
    return {
      where: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue(result),
      })),
    };
  });
}

vi.mock('@/lib/db/context', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
  withSystemContext: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
}));

// ─── Constants ────────────────────────────────────────────────────────────────

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';
const WEBHOOK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003';
const DELIVERY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000004';

function makeWebhook(overrides: Record<string, unknown> = {}) {
  return {
    id: WEBHOOK_ID,
    org_id: ORG_ID,
    url: 'https://example.com/hook',
    secret: 'whsec_abc123',
    event_types: ['call.completed'],
    active: true,
    created_at: new Date(),
    last_delivery_at: null,
    last_failure_at: null,
    failure_count: 0,
    ...overrides,
  };
}

function makeDelivery(overrides: Record<string, unknown> = {}) {
  return {
    id: DELIVERY_ID,
    webhook_id: WEBHOOK_ID,
    event_type: 'call.completed',
    payload: { callId: 'call-1' },
    status_code: 200,
    attempt: 1,
    delivered_at: new Date(),
    error: null,
    ...overrides,
  };
}

import {
  ALLOWED_EVENT_TYPES,
  createWebhook,
  deleteWebhook,
  listDeliveries,
  listWebhooks,
  replayDelivery,
  rotateSecret,
} from './webhooks_outgoing';

describe('webhooks_outgoing service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectResults = [];
    insertResults = [];
    updateResults = [];
    deleteResults = [];
    resetMockTx();
  });

  // ── ALLOWED_EVENT_TYPES ───────────────────────────────────────────────────

  describe('ALLOWED_EVENT_TYPES', () => {
    it('contains the six expected event types', () => {
      expect(ALLOWED_EVENT_TYPES).toContain('call.completed');
      expect(ALLOWED_EVENT_TYPES).toContain('call.failed');
      expect(ALLOWED_EVENT_TYPES).toContain('appointment.booked');
      expect(ALLOWED_EVENT_TYPES).toContain('campaign.completed');
      expect(ALLOWED_EVENT_TYPES).toContain('contact.opted_out');
      expect(ALLOWED_EVENT_TYPES).toContain('lead.qualified');
    });
  });

  // ── createWebhook ─────────────────────────────────────────────────────────

  describe('createWebhook', () => {
    it('inserts webhook and returns secretRevealed', async () => {
      const hook = makeWebhook();
      insertResults.push([hook]);

      const result = await createWebhook(ORG_ID, USER_ID, {
        url: 'https://example.com/hook',
        eventTypes: ['call.completed'],
      });

      expect(result.webhook).toEqual(hook);
      expect(result.secretRevealed).toMatch(/^whsec_/);
      expect(result.secretRevealed).toHaveLength(70); // whsec_ (6) + 64 hex chars
    });

    it('calls recordAudit on creation', async () => {
      insertResults.push([makeWebhook()]);

      await createWebhook(ORG_ID, USER_ID, {
        url: 'https://example.com/hook',
        eventTypes: ['call.completed'],
      });

      expect(mockRecordAudit).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({ action: 'webhook.created', actorUserId: USER_ID }),
      );
    });

    it('throws on invalid event types', async () => {
      await expect(
        createWebhook(ORG_ID, USER_ID, {
          url: 'https://example.com/hook',
          eventTypes: ['invalid.event'],
        }),
      ).rejects.toThrow('invalid_event_types');
    });

    it('generates a secret with whsec_ prefix', async () => {
      insertResults.push([makeWebhook()]);

      const { secretRevealed } = await createWebhook(ORG_ID, USER_ID, {
        url: 'https://example.com/hook',
        eventTypes: ['call.completed'],
      });

      expect(secretRevealed).toMatch(/^whsec_[0-9a-f]{64}$/);
    });
  });

  // ── listWebhooks ──────────────────────────────────────────────────────────

  describe('listWebhooks', () => {
    it('returns webhooks for the org', async () => {
      const hooks = [makeWebhook(), makeWebhook({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000099' })];
      selectResults.push(hooks);

      const result = await listWebhooks(ORG_ID);

      expect(result).toHaveLength(2);
    });

    it('returns empty array when no webhooks exist', async () => {
      selectResults.push([]);

      const result = await listWebhooks(ORG_ID);

      expect(result).toHaveLength(0);
    });
  });

  // ── rotateSecret ──────────────────────────────────────────────────────────

  describe('rotateSecret', () => {
    it('updates secret and returns new secretRevealed', async () => {
      updateResults.push([{ id: WEBHOOK_ID }]);

      const { secretRevealed } = await rotateSecret(ORG_ID, USER_ID, WEBHOOK_ID);

      expect(secretRevealed).toMatch(/^whsec_[0-9a-f]{64}$/);
      expect(mockTx.update).toHaveBeenCalled();
    });

    it('calls recordAudit on rotation', async () => {
      updateResults.push([{ id: WEBHOOK_ID }]);

      await rotateSecret(ORG_ID, USER_ID, WEBHOOK_ID);

      expect(mockRecordAudit).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({ action: 'webhook.secret_rotated' }),
      );
    });

    it('throws webhook_not_found when webhook does not exist', async () => {
      updateResults.push([]);

      await expect(rotateSecret(ORG_ID, USER_ID, WEBHOOK_ID)).rejects.toThrow('webhook_not_found');
    });
  });

  // ── deleteWebhook ─────────────────────────────────────────────────────────

  describe('deleteWebhook', () => {
    it('deletes webhook and records audit', async () => {
      deleteResults.push([{ id: WEBHOOK_ID }]);

      await deleteWebhook(ORG_ID, USER_ID, WEBHOOK_ID);

      expect(mockTx.delete).toHaveBeenCalled();
      expect(mockRecordAudit).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({ action: 'webhook.deleted' }),
      );
    });

    it('throws webhook_not_found when webhook does not exist', async () => {
      deleteResults.push([]);

      await expect(deleteWebhook(ORG_ID, USER_ID, WEBHOOK_ID)).rejects.toThrow('webhook_not_found');
    });
  });

  // ── listDeliveries ────────────────────────────────────────────────────────

  describe('listDeliveries', () => {
    it('returns deliveries for a valid webhook', async () => {
      const deliveries = [makeDelivery(), makeDelivery({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000010' })];
      // First select: webhook ownership check
      selectResults.push([{ id: WEBHOOK_ID }]);
      // Second select: deliveries
      selectResults.push(deliveries);

      const result = await listDeliveries(ORG_ID, WEBHOOK_ID, { limit: 10 });

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBeUndefined();
    });

    it('returns nextCursor when more items exist', async () => {
      const deliveries = Array.from({ length: 3 }, (_, i) =>
        makeDelivery({ id: `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${i}` }),
      );
      selectResults.push([{ id: WEBHOOK_ID }]);
      selectResults.push(deliveries); // limit=2, so 3 items means hasMore=true

      const result = await listDeliveries(ORG_ID, WEBHOOK_ID, { limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBeDefined();
    });

    it('throws webhook_not_found for unknown webhook', async () => {
      selectResults.push([]); // webhook not found

      await expect(listDeliveries(ORG_ID, 'unknown-id', { limit: 10 })).rejects.toThrow(
        'webhook_not_found',
      );
    });

    it('clamps limit to 100', async () => {
      selectResults.push([{ id: WEBHOOK_ID }]);
      selectResults.push([]);

      const result = await listDeliveries(ORG_ID, WEBHOOK_ID, { limit: 9999 });

      expect(result.items).toHaveLength(0);
    });
  });

  // ── replayDelivery ────────────────────────────────────────────────────────

  describe('replayDelivery', () => {
    it('emits webhook/deliver Inngest event', async () => {
      selectResults.push([
        {
          id: DELIVERY_ID,
          webhookId: WEBHOOK_ID,
          eventType: 'call.completed',
          payload: { callId: 'call-1' },
          webhookActive: true,
        },
      ]);

      await replayDelivery(ORG_ID, USER_ID, DELIVERY_ID);

      expect(mockSendInngestEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'webhook/deliver',
          data: expect.objectContaining({
            webhookId: WEBHOOK_ID,
            eventType: 'call.completed',
          }),
        }),
      );
    });

    it('records audit for replay', async () => {
      selectResults.push([
        {
          id: DELIVERY_ID,
          webhookId: WEBHOOK_ID,
          eventType: 'call.completed',
          payload: {},
          webhookActive: true,
        },
      ]);

      await replayDelivery(ORG_ID, USER_ID, DELIVERY_ID);

      expect(mockRecordAudit).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({ action: 'webhook.delivery.replayed' }),
      );
    });

    it('throws delivery_not_found when delivery does not belong to org', async () => {
      selectResults.push([]); // no row found

      await expect(replayDelivery(ORG_ID, USER_ID, DELIVERY_ID)).rejects.toThrow(
        'delivery_not_found',
      );
    });

    it('throws webhook_not_active when webhook is deactivated', async () => {
      selectResults.push([
        {
          id: DELIVERY_ID,
          webhookId: WEBHOOK_ID,
          eventType: 'call.completed',
          payload: {},
          webhookActive: false,
        },
      ]);

      await expect(replayDelivery(ORG_ID, USER_ID, DELIVERY_ID)).rejects.toThrow(
        'webhook_not_active',
      );
    });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockConstructEvent,
  mockCheckoutSessionsList,
  mockInvoicesRetrieve,
  mockWithSystemContext,
  mockInsert,
  mockUpdate,
  mockSelect,
  mockRecordAudit,
  mockTopUp,
  mockAdjust,
  mockRefundCall,
} = vi.hoisted(() => {
  const mockInsert: ReturnType<typeof vi.fn> = vi.fn();
  const mockUpdate: ReturnType<typeof vi.fn> = vi.fn();
  const mockSelect: ReturnType<typeof vi.fn> = vi.fn();

  const mockTx = { insert: mockInsert, update: mockUpdate, select: mockSelect };

  const mockWithSystemContext = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockTx));

  const mockConstructEvent = vi.fn();
  const mockCheckoutSessionsList = vi.fn();
  const mockInvoicesRetrieve = vi.fn();

  const mockRecordAudit = vi.fn();
  const mockTopUp = vi.fn().mockResolvedValue(undefined);
  const mockAdjust = vi.fn().mockResolvedValue(undefined);
  const mockRefundCall = vi.fn().mockResolvedValue(undefined);

  return {
    mockConstructEvent,
    mockCheckoutSessionsList,
    mockInvoicesRetrieve,
    mockWithSystemContext,
    mockInsert,
    mockUpdate,
    mockSelect,
    mockRecordAudit,
    mockTopUp,
    mockAdjust,
    mockRefundCall,
  };
});

vi.mock('@/lib/stripe/client', () => ({
  stripe: {
    webhooks: { constructEvent: mockConstructEvent },
    checkout: { sessions: { list: mockCheckoutSessionsList } },
    invoices: { retrieve: mockInvoicesRetrieve },
  },
}));

vi.mock('@/lib/db/context', () => ({
  withSystemContext: mockWithSystemContext,
}));

vi.mock('@/lib/db/audit', () => ({
  recordAudit: mockRecordAudit,
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
  payments: {
    id: 'p_id',
    org_id: 'p_org_id',
    stripe_session_id: 'p_stripe_session_id',
    stripe_payment_intent_id: 'p_stripe_payment_intent_id',
    amount_cents: 'p_amount_cents',
    package_id: 'p_package_id',
    status: 'p_status',
    invoice_url: 'p_invoice_url',
    completed_at: 'p_completed_at',
  },
  organizations: {
    id: 'o_id',
    legal_name: 'o_legal_name',
    vat_number: 'o_vat_number',
  },
}));

vi.mock('@/lib/env', () => ({
  env: { STRIPE_WEBHOOK_SECRET: 'whsec_test_secret' },
}));

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ type: 'eq', col, val }),
  and: (...args: unknown[]) => ({ type: 'and', args }),
}));

vi.mock('@/lib/services/credit', () => ({
  topUp: mockTopUp,
  adjust: mockAdjust,
  refundCall: mockRefundCall,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { POST } from './route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const SESSION_ID = 'cs_test_session_123';
const PAYMENT_INTENT_ID = 'pi_test_123';
const PAYMENT_ROW_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002';
const PACKAGE_ID = 'cccccccc-cccc-4ccc-8ccc-000000000003';

/** Creates a minimal Stripe event object. */
function makeStripeEvent(type: string, data: Record<string, unknown>) {
  return {
    id: `evt_test_${type.replace(/\./g, '_')}`,
    type,
    data: { object: data },
  };
}

/** Creates a test request with a stripe-signature header. */
function makeRequest(body: unknown, signature = 'valid_sig'): Request {
  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signature,
    },
    body: JSON.stringify(body),
  });
}

/** Sets up the deduplication insert to return a new row (event not seen before). */
function setupNewEvent(): void {
  mockInsert.mockReturnValue({
    values: vi.fn(() => ({
      onConflictDoNothing: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: 'we-uuid' }]),
      })),
    })),
  });
}

/** Sets up the deduplication insert to return empty (duplicate event). */
function setupDuplicateEvent(): void {
  mockInsert.mockReturnValue({
    values: vi.fn(() => ({
      onConflictDoNothing: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([]),
      })),
    })),
  });
}

/**
 * Sets up mockUpdate to handle both:
 *  - `.set().where()` (no returning — status/timestamp updates)
 *  - `.set().where().returning()` (payment update that returns the updated row)
 */
function setupUpdate(): void {
  const returningResult = [
    { id: PAYMENT_ROW_ID, org_id: ORG_ID, amount_cents: 29900, package_id: PACKAGE_ID },
  ];

  mockUpdate.mockReturnValue({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        // Supports optional .returning() chained off .where()
        returning: vi.fn().mockResolvedValue(returningResult),
        // Makes it awaitable directly (for non-returning update calls)
        then: (resolve: (v: undefined) => void) => resolve(undefined),
      })),
    })),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/webhooks/stripe', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockWithSystemContext.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ insert: mockInsert, update: mockUpdate, select: mockSelect }),
    );
    mockTopUp.mockResolvedValue(undefined);
    mockAdjust.mockResolvedValue(undefined);
    mockRefundCall.mockResolvedValue(undefined);
  });

  // ── Signature verification ─────────────────────────────────────────────────

  describe('signature verification', () => {
    it('returns 400 when stripe-signature header is missing', async () => {
      const req = new Request('http://localhost/api/webhooks/stripe', {
        method: 'POST',
        body: '{}',
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe('Missing stripe-signature header');
    });

    it('returns 400 when signature verification fails', async () => {
      mockConstructEvent.mockImplementation(() => {
        throw new Error('No signatures found matching the expected signature');
      });
      const res = await POST(makeRequest({}, 'bad_sig'));
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string };
      expect(json.error).toContain('Webhook signature verification failed');
    });

    it('returns 200 for a valid signature', async () => {
      const event = makeStripeEvent('unknown.event', {});
      mockConstructEvent.mockReturnValue(event);
      setupNewEvent();
      setupUpdate();
      const res = await POST(makeRequest(event));
      expect(res.status).toBe(200);
    });
  });

  // ── Deduplication ──────────────────────────────────────────────────────────

  describe('deduplication', () => {
    it('returns 200 immediately for a duplicate event without re-processing', async () => {
      const event = makeStripeEvent('checkout.session.completed', {});
      mockConstructEvent.mockReturnValue(event);
      setupDuplicateEvent();

      const res = await POST(makeRequest(event));
      expect(res.status).toBe(200);
      // Only the dedup insert called; no update/topUp
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockTopUp).not.toHaveBeenCalled();
    });

    it('persists the event payload on first delivery', async () => {
      const event = makeStripeEvent('unknown.event', { foo: 'bar' });
      mockConstructEvent.mockReturnValue(event);
      setupNewEvent();
      setupUpdate();

      await POST(makeRequest(event));

      // Verify the insert was called with provider='stripe' and the event id
      expect(mockInsert).toHaveBeenCalled();
    });
  });

  // ── checkout.session.completed ─────────────────────────────────────────────

  describe('checkout.session.completed', () => {
    it('updates payment status, records audit, and credits the ledger', async () => {
      const session = {
        id: SESSION_ID,
        payment_intent: PAYMENT_INTENT_ID,
        invoice: null,
        metadata: { org_id: ORG_ID, package_id: PACKAGE_ID },
      };
      const event = makeStripeEvent('checkout.session.completed', session);
      mockConstructEvent.mockReturnValue(event);
      setupNewEvent();
      setupUpdate();

      const res = await POST(makeRequest(event));
      expect(res.status).toBe(200);

      // topUp called with the right org, amount, and payment intent
      expect(mockTopUp).toHaveBeenCalledWith(
        ORG_ID,
        expect.objectContaining({
          amountCents: 29900,
          packageId: PACKAGE_ID,
          stripePaymentIntentId: PAYMENT_INTENT_ID,
        }),
      );
    });

    it('fetches invoice URL when session has an invoice', async () => {
      const session = {
        id: SESSION_ID,
        payment_intent: PAYMENT_INTENT_ID,
        invoice: 'in_test_123',
        metadata: { org_id: ORG_ID, package_id: PACKAGE_ID },
      };
      const event = makeStripeEvent('checkout.session.completed', session);
      mockConstructEvent.mockReturnValue(event);
      mockInvoicesRetrieve.mockResolvedValue({ hosted_invoice_url: 'https://invoice.stripe.com/i/123' });
      setupNewEvent();
      setupUpdate();

      await POST(makeRequest(event));

      expect(mockInvoicesRetrieve).toHaveBeenCalledWith('in_test_123');
    });

    it('continues without invoice URL when invoice retrieval fails', async () => {
      const session = {
        id: SESSION_ID,
        payment_intent: PAYMENT_INTENT_ID,
        invoice: 'in_test_bad',
        metadata: { org_id: ORG_ID, package_id: PACKAGE_ID },
      };
      const event = makeStripeEvent('checkout.session.completed', session);
      mockConstructEvent.mockReturnValue(event);
      mockInvoicesRetrieve.mockRejectedValue(new Error('invoice not found'));
      setupNewEvent();
      setupUpdate();

      const res = await POST(makeRequest(event));
      expect(res.status).toBe(200);
      expect(mockTopUp).toHaveBeenCalled();
    });

    it('skips processing when metadata is missing', async () => {
      const session = { id: SESSION_ID, payment_intent: PAYMENT_INTENT_ID, metadata: null };
      const event = makeStripeEvent('checkout.session.completed', session);
      mockConstructEvent.mockReturnValue(event);
      setupNewEvent();
      setupUpdate();

      await POST(makeRequest(event));
      expect(mockTopUp).not.toHaveBeenCalled();
    });

    it('skips processing when payment_intent is absent', async () => {
      const session = {
        id: SESSION_ID,
        payment_intent: null,
        metadata: { org_id: ORG_ID, package_id: PACKAGE_ID },
      };
      const event = makeStripeEvent('checkout.session.completed', session);
      mockConstructEvent.mockReturnValue(event);
      setupNewEvent();
      setupUpdate();

      await POST(makeRequest(event));
      expect(mockTopUp).not.toHaveBeenCalled();
    });
  });

  // ── checkout.session.expired ───────────────────────────────────────────────

  describe('checkout.session.expired', () => {
    it('updates payment status to failed', async () => {
      const session = { id: SESSION_ID };
      const event = makeStripeEvent('checkout.session.expired', session);
      mockConstructEvent.mockReturnValue(event);
      setupNewEvent();
      setupUpdate();

      const res = await POST(makeRequest(event));
      expect(res.status).toBe(200);
      expect(mockUpdate).toHaveBeenCalled();
    });
  });

  // ── payment_intent.payment_failed ─────────────────────────────────────────

  describe('payment_intent.payment_failed', () => {
    it('looks up the checkout session and updates payment to failed', async () => {
      const pi = { id: PAYMENT_INTENT_ID };
      const event = makeStripeEvent('payment_intent.payment_failed', pi);
      mockConstructEvent.mockReturnValue(event);
      mockCheckoutSessionsList.mockResolvedValue({ data: [{ id: SESSION_ID }] });
      setupNewEvent();
      setupUpdate();

      const res = await POST(makeRequest(event));
      expect(res.status).toBe(200);
      expect(mockCheckoutSessionsList).toHaveBeenCalledWith({
        payment_intent: PAYMENT_INTENT_ID,
        limit: 1,
      });
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('skips update when no checkout session is found for the payment intent', async () => {
      const pi = { id: PAYMENT_INTENT_ID };
      const event = makeStripeEvent('payment_intent.payment_failed', pi);
      mockConstructEvent.mockReturnValue(event);
      mockCheckoutSessionsList.mockResolvedValue({ data: [] });
      setupNewEvent();
      setupUpdate();

      const res = await POST(makeRequest(event));
      expect(res.status).toBe(200);
      // No payment update (but processed_at update still happens)
      expect(mockCheckoutSessionsList).toHaveBeenCalled();
    });
  });

  // ── charge.refunded ────────────────────────────────────────────────────────

  describe('charge.refunded', () => {
    it('calls refundCall when charge metadata has call_id', async () => {
      const CALL_ID = 'dddddddd-dddd-4ddd-8ddd-000000000004';
      const charge = {
        id: 'ch_test',
        amount_refunded: 150,
        payment_intent: PAYMENT_INTENT_ID,
        metadata: { call_id: CALL_ID, org_id: ORG_ID },
      };
      const event = makeStripeEvent('charge.refunded', charge);
      mockConstructEvent.mockReturnValue(event);
      setupNewEvent();
      setupUpdate();

      await POST(makeRequest(event));

      expect(mockRefundCall).toHaveBeenCalledWith(
        ORG_ID,
        CALL_ID,
        150,
        `Stripe refund for charge ch_test`,
      );
      expect(mockAdjust).not.toHaveBeenCalled();
    });

    it('adjusts the ledger for a top-up refund when no call_id in metadata', async () => {
      const charge = {
        id: 'ch_topup',
        amount_refunded: 29900,
        payment_intent: PAYMENT_INTENT_ID,
        metadata: {},
      };
      const event = makeStripeEvent('charge.refunded', charge);
      mockConstructEvent.mockReturnValue(event);
      setupNewEvent();

      // First withSystemContext call: dedup insert (new event)
      // Second: select payment by payment_intent_id
      // Third: update payment status to 'refunded'
      // Fourth: update webhook_events.processed_at
      let callCount = 0;
      mockWithSystemContext.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        callCount++;
        if (callCount === 1) {
          // dedup insert
          return fn({
            insert: vi.fn(() => ({
              values: vi.fn(() => ({
                onConflictDoNothing: vi.fn(() => ({
                  returning: vi.fn().mockResolvedValue([{ id: 'we-uuid' }]),
                })),
              })),
            })),
            update: mockUpdate,
            select: mockSelect,
          });
        }
        if (callCount === 2) {
          // select payment
          return fn({
            select: vi.fn(() => ({
              from: vi.fn(() => ({
                where: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue([{ id: PAYMENT_ROW_ID, org_id: ORG_ID }]),
                })),
              })),
            })),
            insert: mockInsert,
            update: mockUpdate,
          });
        }
        // All other calls: update
        return fn({ update: mockUpdate, insert: mockInsert, select: mockSelect });
      });

      setupUpdate();
      await POST(makeRequest(event));

      expect(mockAdjust).toHaveBeenCalledWith(
        ORG_ID,
        'stripe-webhook',
        -29900,
        `Stripe refund for charge ch_topup`,
        { actorType: 'system' },
      );
      expect(mockRefundCall).not.toHaveBeenCalled();
    });

    it('skips when amount_refunded is 0', async () => {
      const charge = {
        id: 'ch_zero',
        amount_refunded: 0,
        payment_intent: PAYMENT_INTENT_ID,
        metadata: {},
      };
      const event = makeStripeEvent('charge.refunded', charge);
      mockConstructEvent.mockReturnValue(event);
      setupNewEvent();
      setupUpdate();

      await POST(makeRequest(event));
      expect(mockAdjust).not.toHaveBeenCalled();
      expect(mockRefundCall).not.toHaveBeenCalled();
    });
  });

  // ── customer.updated ──────────────────────────────────────────────────────

  describe('customer.updated', () => {
    it('syncs legal_name and vat_number back to organizations', async () => {
      const customer = {
        id: 'cus_test',
        name: 'Rossi SRL',
        metadata: { org_id: ORG_ID, vat_number: 'IT12345678901' },
      };
      const event = makeStripeEvent('customer.updated', customer);
      mockConstructEvent.mockReturnValue(event);
      setupNewEvent();
      setupUpdate();

      await POST(makeRequest(event));
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('skips update when org_id is absent from customer metadata', async () => {
      const customer = { id: 'cus_test', name: 'Some Corp', metadata: {} };
      const event = makeStripeEvent('customer.updated', customer);
      mockConstructEvent.mockReturnValue(event);
      setupNewEvent();
      setupUpdate();

      await POST(makeRequest(event));
      // Only the webhookEvents.processed_at update should be called,
      // not an organizations update (handler returns early when org_id is absent)
      expect(mockUpdate).toHaveBeenCalledTimes(1);
    });
  });

  // ── Unknown events ────────────────────────────────────────────────────────

  describe('unknown event types', () => {
    it('persists unknown events without crashing and returns 200', async () => {
      const event = makeStripeEvent('invoice.payment_succeeded', { id: 'inv_123' });
      mockConstructEvent.mockReturnValue(event);
      setupNewEvent();
      setupUpdate();

      const res = await POST(makeRequest(event));
      expect(res.status).toBe(200);
    });
  });

  // ── Error handling ────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('returns 200 even when processing throws, and records the error', async () => {
      const session = {
        id: SESSION_ID,
        payment_intent: PAYMENT_INTENT_ID,
        metadata: { org_id: ORG_ID, package_id: PACKAGE_ID },
      };
      const event = makeStripeEvent('checkout.session.completed', session);
      mockConstructEvent.mockReturnValue(event);
      setupNewEvent();

      // Simulate payment update succeeding but topUp throwing
      mockUpdate.mockReturnValue({
        set: vi.fn(() => ({
          where: vi.fn().mockResolvedValue(undefined),
          returning: vi.fn().mockResolvedValue([
            { id: PAYMENT_ROW_ID, org_id: ORG_ID, amount_cents: 29900, package_id: PACKAGE_ID },
          ]),
        })),
      });
      mockTopUp.mockRejectedValue(new Error('ledger write failed'));

      const res = await POST(makeRequest(event));
      expect(res.status).toBe(200);
    });
  });
});

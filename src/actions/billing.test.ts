import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks (available inside vi.mock factories) ───────────────────────

const {
  mockGetAuthContext,
  mockRequireCapability,
  mockStripeSessionCreate,
  mockGetOrCreateCustomer,
  mockWithSystemContext,
  mockWithOrgContext,
  mockTx,
} = vi.hoisted(() => {
  // FIFO queue — filled per-test via selectResults
  let selectQueue: unknown[][] = [];
  const insertCaptured: unknown[] = [];

  function makeSelectChain(result: unknown[]) {
    const chain: Record<string, () => typeof chain> & { then?: unknown } = {
      from: () => chain,
      where: () => chain,
      limit: () => chain,
    };
    (chain as Record<string, unknown>).then = (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject);
    return chain;
  }

  const mockTx = {
    select: vi.fn(),
    insert: vi.fn(),
    execute: vi.fn().mockResolvedValue(undefined),
    _selectQueue: selectQueue,
    _insertCaptured: insertCaptured,
    _resetQueue(rows: unknown[][]) {
      selectQueue = rows;
      mockTx._selectQueue = rows;
    },
    _clearInserts() {
      insertCaptured.length = 0;
    },
  };

  mockTx.select.mockImplementation(() => {
    const result = selectQueue.shift() ?? [];
    return makeSelectChain(result);
  });

  mockTx.insert.mockImplementation(() => ({
    values: vi.fn((data: unknown) => {
      insertCaptured.push(data);
      return Promise.resolve([]);
    }),
  }));

  const mockWithSystemContext = vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx));
  const mockWithOrgContext = vi.fn((_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn(mockTx),
  );

  const mockGetAuthContext = vi.fn().mockResolvedValue({
    orgId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
    userId: 'user-1',
    role: 'owner',
  });
  const mockRequireCapability = vi.fn().mockResolvedValue(undefined);
  const mockStripeSessionCreate = vi.fn();
  const mockGetOrCreateCustomer = vi.fn().mockResolvedValue('cus_test123');

  return {
    mockGetAuthContext,
    mockRequireCapability,
    mockStripeSessionCreate,
    mockGetOrCreateCustomer,
    mockWithSystemContext,
    mockWithOrgContext,
    mockTx,
  };
});

vi.mock('@/lib/auth/context', () => ({
  getAuthContext: (...args: unknown[]) => mockGetAuthContext(...args),
  requireCapability: (...args: unknown[]) => mockRequireCapability(...args),
}));

vi.mock('@/lib/db/context', () => ({
  withSystemContext: mockWithSystemContext,
  withOrgContext: mockWithOrgContext,
}));

vi.mock('@/lib/db/schema', () => ({
  creditPackages: { id: 'id', stripe_price_id: 'stripe_price_id' },
  payments: {},
}));

vi.mock('@/lib/stripe', () => ({
  stripe: {
    checkout: { sessions: { create: (...args: unknown[]) => mockStripeSessionCreate(...args) } },
  },
  getOrCreateCustomerForOrg: (...args: unknown[]) => mockGetOrCreateCustomer(...args),
}));

vi.mock('@/lib/env', () => ({
  env: { NEXT_PUBLIC_APP_URL: 'https://app.example.com' },
}));

import { createTopupSession } from './billing';

// ─── Constants ────────────────────────────────────────────────────────────────

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const PKG_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002';
const SESSION_ID = 'cs_test_abc123';
const SESSION_URL = 'https://checkout.stripe.com/pay/cs_test_abc123';
const STRIPE_PRICE_ID = 'price_test_abc';

const pkgRow = {
  id: PKG_ID,
  slug: 'starter',
  display_name: 'Starter (700 minuti)',
  price_cents: 29900,
  included_minutes: 700,
  stripe_price_id: STRIPE_PRICE_ID,
  active: true,
};

const stripeSession = { id: SESSION_ID, url: SESSION_URL };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function queueSelect(...rows: unknown[][]) {
  mockTx._resetQueue([...rows]);
}

function capturedInserts(): unknown[] {
  return mockTx._insertCaptured;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockTx._resetQueue([]);
  mockTx._clearInserts();

  mockTx.select.mockImplementation(() => {
    const selectQueue = mockTx._selectQueue as unknown[][];
    function makeSelectChain(result: unknown[]) {
      const chain: Record<string, () => typeof chain> & { then?: unknown } = {
        from: () => chain,
        where: () => chain,
        limit: () => chain,
      };
      (chain as Record<string, unknown>).then = (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown,
      ) => Promise.resolve(result).then(resolve, reject);
      return chain;
    }
    const result = selectQueue.shift() ?? [];
    return makeSelectChain(result);
  });

  mockTx.insert.mockImplementation(() => ({
    values: vi.fn((data: unknown) => {
      (mockTx._insertCaptured as unknown[]).push(data);
      return Promise.resolve([]);
    }),
  }));

  mockGetAuthContext.mockResolvedValue({ orgId: ORG_ID, userId: 'user-1', role: 'owner' });
  mockRequireCapability.mockResolvedValue(undefined);
  mockGetOrCreateCustomer.mockResolvedValue('cus_test123');
  mockStripeSessionCreate.mockResolvedValue(stripeSession);

  mockWithSystemContext.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx));
  mockWithOrgContext.mockImplementation((_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn(mockTx),
  );
});

describe('createTopupSession', () => {
  describe('input validation', () => {
    it('returns invalid_package_id for a non-UUID string', async () => {
      const result = await createTopupSession({ packageId: 'not-a-uuid' });
      expect(result).toEqual({ ok: false, message: 'invalid_package_id' });
    });

    it('returns invalid_package_id for an empty string', async () => {
      const result = await createTopupSession({ packageId: '' });
      expect(result).toEqual({ ok: false, message: 'invalid_package_id' });
    });
  });

  describe('capability check', () => {
    it('propagates Forbidden error when billing.topup is not held', async () => {
      mockRequireCapability.mockRejectedValue(
        new Error("Forbidden: role 'operator' does not have capability 'billing.topup'"),
      );
      await expect(createTopupSession({ packageId: PKG_ID })).rejects.toThrow('Forbidden');
    });
  });

  describe('package lookup', () => {
    it('returns package_not_found when package does not exist', async () => {
      queueSelect([]);
      const result = await createTopupSession({ packageId: PKG_ID });
      expect(result).toEqual({ ok: false, message: 'package_not_found' });
    });

    it('returns package_not_available when stripe_price_id is null', async () => {
      queueSelect([{ ...pkgRow, stripe_price_id: null }]);
      const result = await createTopupSession({ packageId: PKG_ID });
      expect(result).toEqual({ ok: false, message: 'package_not_available' });
    });
  });

  describe('Stripe session creation', () => {
    it('returns session_creation_failed when session has no url', async () => {
      queueSelect([pkgRow]);
      mockStripeSessionCreate.mockResolvedValue({ id: SESSION_ID, url: null });
      const result = await createTopupSession({ packageId: PKG_ID });
      expect(result).toEqual({ ok: false, message: 'session_creation_failed' });
    });

    it('creates session with correct parameters', async () => {
      queueSelect([pkgRow]);
      await createTopupSession({ packageId: PKG_ID });

      expect(mockStripeSessionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'payment',
          customer: 'cus_test123',
          line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
          automatic_tax: { enabled: true },
          payment_method_types: ['card', 'sepa_debit'],
          invoice_creation: { enabled: true },
          customer_update: { address: 'auto', name: 'auto' },
        }),
      );
    });

    it('uses correct success and cancel URLs', async () => {
      queueSelect([pkgRow]);
      await createTopupSession({ packageId: PKG_ID });

      const call = mockStripeSessionCreate.mock.calls[0]![0] as Record<string, string>;
      expect(call.success_url).toBe(
        'https://app.example.com/credit/topup/success?session_id={CHECKOUT_SESSION_ID}',
      );
      expect(call.cancel_url).toBe('https://app.example.com/credit/topup?cancelled=1');
    });

    it('includes org_id and package_id in session metadata', async () => {
      queueSelect([pkgRow]);
      await createTopupSession({ packageId: PKG_ID });

      const call = mockStripeSessionCreate.mock.calls[0]![0] as {
        metadata: Record<string, string>;
      };
      expect(call.metadata.org_id).toBe(ORG_ID);
      expect(call.metadata.package_id).toBe(PKG_ID);
      expect(call.metadata.internal_session_id).toBeDefined();
    });
  });

  describe('payments row insertion', () => {
    it('inserts a pending payments row with the session id', async () => {
      queueSelect([pkgRow]);
      await createTopupSession({ packageId: PKG_ID });

      const inserts = capturedInserts();
      expect(inserts).toHaveLength(1);
      expect(inserts[0]).toMatchObject({
        org_id: ORG_ID,
        package_id: PKG_ID,
        stripe_session_id: SESSION_ID,
        amount_cents: pkgRow.price_cents,
        currency: 'eur',
        status: 'pending',
      });
    });

    it('uses the pre-generated id as internal_session_id in metadata', async () => {
      queueSelect([pkgRow]);
      await createTopupSession({ packageId: PKG_ID });

      const sessionCall = mockStripeSessionCreate.mock.calls[0]![0] as {
        metadata: { internal_session_id: string };
      };
      const insertedRow = capturedInserts()[0] as { id: string };
      expect(insertedRow.id).toBe(sessionCall.metadata.internal_session_id);
    });
  });

  describe('success', () => {
    it('returns ok:true with the session URL', async () => {
      queueSelect([pkgRow]);
      const result = await createTopupSession({ packageId: PKG_ID });
      expect(result).toEqual({ ok: true, url: SESSION_URL });
    });
  });
});

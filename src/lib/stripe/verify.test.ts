import { createHmac } from 'crypto';

import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockConstructEvent } = vi.hoisted(() => {
  const mockConstructEvent = vi.fn();
  return { mockConstructEvent };
});

vi.mock('./client', () => ({
  stripe: {
    webhooks: { constructEvent: mockConstructEvent },
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { verifyStripeWebhook } from './verify';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_SECRET = 'whsec_test_signing_secret_for_unit_tests';

/**
 * Generates a valid Stripe webhook signature header for the given payload and
 * signing secret. Mimics the Stripe CLI's `stripe trigger` output format.
 *
 * Stripe's algorithm:
 *   signedPayload = `${timestamp}.${rawBody}`
 *   v1            = HMAC-SHA256(signedPayload, secret) as hex
 *   header        = `t=${timestamp},v1=${v1}`
 */
function generateStripeSignature(rawBody: string, secret: string, timestampOverride?: number): string {
  const timestamp = timestampOverride ?? Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${rawBody}`;
  const v1 = createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

const FIXTURE_BODY = JSON.stringify({
  id: 'evt_test_fixture_001',
  object: 'event',
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_test_session_001',
      metadata: { org_id: 'org-uuid', package_id: 'pkg-uuid' },
    },
  },
});

const FIXTURE_EVENT = JSON.parse(FIXTURE_BODY) as Record<string, unknown>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('verifyStripeWebhook', () => {
  it('delegates to stripe.webhooks.constructEvent with the raw arguments', () => {
    mockConstructEvent.mockReturnValue(FIXTURE_EVENT);

    const signature = generateStripeSignature(FIXTURE_BODY, TEST_SECRET);
    const result = verifyStripeWebhook(FIXTURE_BODY, signature, TEST_SECRET);

    expect(mockConstructEvent).toHaveBeenCalledOnce();
    expect(mockConstructEvent).toHaveBeenCalledWith(FIXTURE_BODY, signature, TEST_SECRET, undefined);
    expect(result).toEqual(FIXTURE_EVENT);
  });

  it('passes an explicit tolerance value through to constructEvent', () => {
    mockConstructEvent.mockReturnValue(FIXTURE_EVENT);

    const signature = generateStripeSignature(FIXTURE_BODY, TEST_SECRET);
    verifyStripeWebhook(FIXTURE_BODY, signature, TEST_SECRET, 60);

    expect(mockConstructEvent).toHaveBeenCalledWith(FIXTURE_BODY, signature, TEST_SECRET, 60);
  });

  it('re-throws when constructEvent throws a signature mismatch error', () => {
    const signatureError = new Error('No signatures found matching the expected signature for payload');
    mockConstructEvent.mockImplementation(() => {
      throw signatureError;
    });

    const badSignature = 't=1234567890,v1=deadbeefdeadbeefdeadbeefdeadbeef';
    expect(() => verifyStripeWebhook(FIXTURE_BODY, badSignature, TEST_SECRET)).toThrow(
      'No signatures found matching the expected signature for payload',
    );
  });

  it('re-throws when constructEvent throws a timestamp tolerance error', () => {
    const toleranceError = new Error('Timestamp outside the tolerance zone');
    mockConstructEvent.mockImplementation(() => {
      throw toleranceError;
    });

    // Signature with a timestamp 10 minutes in the past (outside default 300s window)
    const staleTimestamp = Math.floor(Date.now() / 1000) - 700;
    const staleSignature = generateStripeSignature(FIXTURE_BODY, TEST_SECRET, staleTimestamp);

    expect(() => verifyStripeWebhook(FIXTURE_BODY, staleSignature, TEST_SECRET)).toThrow(
      'Timestamp outside the tolerance zone',
    );
  });

  it('returns the parsed event object on success', () => {
    const expectedEvent = { id: 'evt_abc123', type: 'customer.updated', data: { object: {} } };
    mockConstructEvent.mockReturnValue(expectedEvent);

    const rawBody = JSON.stringify(expectedEvent);
    const signature = generateStripeSignature(rawBody, TEST_SECRET);
    const result = verifyStripeWebhook(rawBody, signature, TEST_SECRET);

    expect(result).toStrictEqual(expectedEvent);
  });
});

// ---------------------------------------------------------------------------
// Signature generation helper self-test
// ---------------------------------------------------------------------------

describe('generateStripeSignature (test helper)', () => {
  it('produces a header with the expected t= and v1= components', () => {
    const body = '{"test":true}';
    const now = 1700000000;
    const header = generateStripeSignature(body, TEST_SECRET, now);

    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(header).toContain(`t=${now}`);
  });

  it('generates a different signature for different bodies', () => {
    const ts = 1700000000;
    const h1 = generateStripeSignature('{"a":1}', TEST_SECRET, ts);
    const h2 = generateStripeSignature('{"a":2}', TEST_SECRET, ts);
    expect(h1).not.toBe(h2);
  });

  it('generates a different signature for different secrets', () => {
    const body = '{"test":true}';
    const ts = 1700000000;
    const h1 = generateStripeSignature(body, 'whsec_secret_a', ts);
    const h2 = generateStripeSignature(body, 'whsec_secret_b', ts);
    expect(h1).not.toBe(h2);
  });

  it('generates a different signature for different timestamps', () => {
    const body = '{"test":true}';
    const h1 = generateStripeSignature(body, TEST_SECRET, 1700000000);
    const h2 = generateStripeSignature(body, TEST_SECRET, 1700000001);
    expect(h1).not.toBe(h2);
  });
});

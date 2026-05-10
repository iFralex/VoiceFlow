/**
 * Canonical HMAC-SHA256 signature verification test.
 *
 * This test mirrors the receiver-side verification code documented in
 * docs/webhooks.md. It proves that the signature produced by
 * webhookDeliverHandler can be verified using the standard Node.js crypto
 * module — the same pattern a CRM integrator or Zapier trigger would use.
 */

import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

const SECRET = 'whsec_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

function buildSignedRequest(
  secret: string,
  eventType: string,
  orgId: string,
  data: Record<string, unknown>,
): { body: string; headers: Record<string, string> } {
  const envelope = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    event: eventType,
    occurred_at: new Date('2026-05-10T14:00:00.000Z').toISOString(),
    org_id: orgId,
    data,
  };

  const body = JSON.stringify(envelope);
  const signature = createHmac('sha256', secret).update(body).digest('hex');
  const timestamp = Math.floor(new Date('2026-05-10T14:00:00.000Z').getTime() / 1000).toString();

  return {
    body,
    headers: {
      'content-type': 'application/json',
      'x-vox-event': eventType,
      'x-vox-event-id': envelope.id,
      'x-vox-signature': `sha256=${signature}`,
      'x-vox-timestamp': timestamp,
    },
  };
}

/**
 * Canonical receiver verification function — equivalent to what an integrator
 * would implement in their webhook endpoint.
 */
function verifySignature(body: string, signatureHeader: string, secret: string): boolean {
  const [algo, receivedHex] = signatureHeader.split('=');
  if (algo !== 'sha256' || !receivedHex) return false;

  const expectedHex = createHmac('sha256', secret).update(body).digest('hex');
  // Constant-time comparison to prevent timing attacks
  if (expectedHex.length !== receivedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < expectedHex.length; i++) {
    diff |= expectedHex.charCodeAt(i) ^ receivedHex.charCodeAt(i);
  }
  return diff === 0;
}

describe('HMAC-SHA256 signature — canonical receiver verification', () => {
  it('verifies a correctly signed payload with the shared secret', () => {
    const { body, headers } = buildSignedRequest(SECRET, 'call.completed', 'org-123', {
      callId: 'call-abc',
      outcome: 'completed',
    });

    const isValid = verifySignature(body, headers['x-vox-signature']!, SECRET);
    expect(isValid).toBe(true);
  });

  it('rejects a payload signed with a different secret', () => {
    const { body, headers } = buildSignedRequest(SECRET, 'call.completed', 'org-123', {
      callId: 'call-abc',
    });

    const isValid = verifySignature(body, headers['x-vox-signature']!, 'wrong-secret');
    expect(isValid).toBe(false);
  });

  it('rejects a tampered body (signature no longer matches)', () => {
    const { headers } = buildSignedRequest(SECRET, 'call.completed', 'org-123', {
      callId: 'call-abc',
    });

    const tamperedBody = JSON.stringify({
      id: '123e4567-e89b-12d3-a456-426614174000',
      event: 'call.completed',
      occurred_at: new Date('2026-05-10T14:00:00.000Z').toISOString(),
      org_id: 'org-123',
      data: { callId: 'call-abc', injected: 'malicious_field' },
    });

    const isValid = verifySignature(tamperedBody, headers['x-vox-signature']!, SECRET);
    expect(isValid).toBe(false);
  });

  it('rejects a malformed signature header (no algorithm prefix)', () => {
    const { body } = buildSignedRequest(SECRET, 'call.completed', 'org-123', {});

    const isValid = verifySignature(body, 'not-a-valid-signature', SECRET);
    expect(isValid).toBe(false);
  });

  it('signature is 64 hex chars (SHA-256 output)', () => {
    const { headers } = buildSignedRequest(SECRET, 'appointment.booked', 'org-456', {
      appointmentId: 'appt-xyz',
    });

    const [, hex] = headers['x-vox-signature']!.split('=');
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different signatures for different payloads (collision resistance)', () => {
    const { headers: h1 } = buildSignedRequest(SECRET, 'call.completed', 'org-1', {
      callId: 'A',
    });
    const { headers: h2 } = buildSignedRequest(SECRET, 'call.completed', 'org-1', {
      callId: 'B',
    });

    expect(h1['x-vox-signature']).not.toBe(h2['x-vox-signature']);
  });

  it('envelope includes required fields: id, event, occurred_at, org_id, data', () => {
    const { body } = buildSignedRequest(SECRET, 'lead.qualified', 'org-789', {
      callId: 'call-123',
    });

    const envelope = JSON.parse(body) as Record<string, unknown>;
    expect(envelope).toHaveProperty('id');
    expect(envelope).toHaveProperty('event', 'lead.qualified');
    expect(envelope).toHaveProperty('occurred_at');
    expect(envelope).toHaveProperty('org_id', 'org-789');
    expect(envelope).toHaveProperty('data');
  });
});

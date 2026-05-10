/**
 * Developer webhook-test tool — plan 13 task 16.
 *
 * Helps the team verify webhook delivery end-to-end during development:
 * - Links to Webhook.site so you can spin up a temporary receiver in seconds
 * - Shows sample envelopes for every event type
 * - Explains how to create a test subscription pointing at Webhook.site
 *
 * Auth: `?token=<INTERNAL_ADMIN_TOKEN>` compared with timingSafeEqual.
 * Wrong/missing token → notFound() so the route is indistinguishable from a 404.
 */

import { timingSafeEqual } from 'crypto';

import { notFound } from 'next/navigation';

import { env } from '@/lib/env';

function isAuthorized(token: string | undefined | string[]): boolean {
  if (typeof token !== 'string' || token.length === 0) return false;
  const expected = env.INTERNAL_ADMIN_TOKEN;
  if (token.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}

const SAMPLE_ENVELOPES: Record<string, object> = {
  'call.completed': {
    id: 'evt_01hx9qkz3e4f5g6h7j8k9m0n1p',
    event: 'call.completed',
    occurred_at: '2024-11-15T14:32:18.000Z',
    org_id: 'org_01hx9qkz3e4f5g6h7j8k9m0n1p',
    data: {
      call_id: 'call_01hx9qkz3e4f5g6h7j8k9m0n1p',
      campaign_id: 'camp_01hx9qkz3e4f5g6h7j8k9m0n1p',
      contact_id: 'ctct_01hx9qkz3e4f5g6h7j8k9m0n1p',
      phone_number: '+39 02 1234567',
      duration_seconds: 142,
      outcome: 'completed',
      recording_url: 'https://cdn.example.com/recordings/call_01hx.mp3',
    },
  },
  'call.failed': {
    id: 'evt_01hx9qkz3e4f5g6h7j8k9m0n1q',
    event: 'call.failed',
    occurred_at: '2024-11-15T14:32:18.000Z',
    org_id: 'org_01hx9qkz3e4f5g6h7j8k9m0n1p',
    data: {
      call_id: 'call_01hx9qkz3e4f5g6h7j8k9m0n1q',
      campaign_id: 'camp_01hx9qkz3e4f5g6h7j8k9m0n1p',
      contact_id: 'ctct_01hx9qkz3e4f5g6h7j8k9m0n1q',
      phone_number: '+39 02 7654321',
      reason: 'no_answer',
    },
  },
  'appointment.booked': {
    id: 'evt_01hx9qkz3e4f5g6h7j8k9m0n1r',
    event: 'appointment.booked',
    occurred_at: '2024-11-15T14:33:05.000Z',
    org_id: 'org_01hx9qkz3e4f5g6h7j8k9m0n1p',
    data: {
      appointment_id: 'appt_01hx9qkz3e4f5g6h7j8k9m0n1r',
      call_id: 'call_01hx9qkz3e4f5g6h7j8k9m0n1p',
      contact_id: 'ctct_01hx9qkz3e4f5g6h7j8k9m0n1p',
      contact_name: 'Mario Rossi',
      contact_phone: '+39 02 1234567',
      scheduled_at: '2024-11-20T10:00:00.000Z',
      notes: 'Cliente interessato al modello Elettra 2025',
    },
  },
  'campaign.completed': {
    id: 'evt_01hx9qkz3e4f5g6h7j8k9m0n1s',
    event: 'campaign.completed',
    occurred_at: '2024-11-15T18:00:00.000Z',
    org_id: 'org_01hx9qkz3e4f5g6h7j8k9m0n1p',
    data: {
      campaign_id: 'camp_01hx9qkz3e4f5g6h7j8k9m0n1p',
      campaign_name: 'Promo Novembre 2024',
      total_contacts: 500,
      calls_completed: 423,
      calls_failed: 77,
      leads_qualified: 34,
      appointments_booked: 12,
      duration_seconds: 18432,
    },
  },
  'contact.opted_out': {
    id: 'evt_01hx9qkz3e4f5g6h7j8k9m0n1t',
    event: 'contact.opted_out',
    occurred_at: '2024-11-15T14:35:00.000Z',
    org_id: 'org_01hx9qkz3e4f5g6h7j8k9m0n1p',
    data: {
      contact_id: 'ctct_01hx9qkz3e4f5g6h7j8k9m0n1t',
      phone_number: '+39 02 9876543',
      opted_out_at: '2024-11-15T14:35:00.000Z',
    },
  },
  'lead.qualified': {
    id: 'evt_01hx9qkz3e4f5g6h7j8k9m0n1u',
    event: 'lead.qualified',
    occurred_at: '2024-11-15T14:36:00.000Z',
    org_id: 'org_01hx9qkz3e4f5g6h7j8k9m0n1p',
    data: {
      call_id: 'call_01hx9qkz3e4f5g6h7j8k9m0n1p',
      contact_id: 'ctct_01hx9qkz3e4f5g6h7j8k9m0n1p',
      contact_name: 'Mario Rossi',
      contact_phone: '+39 02 1234567',
      campaign_id: 'camp_01hx9qkz3e4f5g6h7j8k9m0n1p',
      ai_summary: 'Il cliente è molto interessato al modello Elettra. Ha chiesto informazioni sul finanziamento.',
      recommended_action: 'call_back',
    },
  },
};

const VERIFICATION_NODE = `
const crypto = require('crypto');

function verifyWebhookSignature(body, secret, signatureHeader) {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  // Use timingSafeEqual to prevent timing attacks
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signatureHeader, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Express.js example — use raw body (before JSON.parse)
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['x-vox-signature'];
  if (!verifyWebhookSignature(req.body, process.env.WEBHOOK_SECRET, sig)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  const event = JSON.parse(req.body);
  console.log('Received event:', event.event, event.id);
  res.json({ ok: true });
});
`.trim();

const VERIFICATION_PYTHON = `
import hmac
import hashlib

def verify_webhook_signature(body: bytes, secret: str, signature_header: str) -> bool:
    expected = 'sha256=' + hmac.new(
        secret.encode(), body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header)

# Flask example — use request.data (raw bytes)
@app.route('/webhook', methods=['POST'])
def webhook():
    sig = request.headers.get('X-Vox-Signature', '')
    if not verify_webhook_signature(request.data, os.environ['WEBHOOK_SECRET'], sig):
        return jsonify({'error': 'Invalid signature'}), 401
    event = request.get_json()
    print(f"Received event: {event['event']} {event['id']}")
    return jsonify({'ok': True})
`.trim();

const VERIFICATION_PHP = `
<?php
function verifyWebhookSignature(string $body, string $secret, string $signatureHeader): bool {
    $expected = 'sha256=' . hash_hmac('sha256', $body, $secret);
    return hash_equals($expected, $signatureHeader);
}

// Laravel / plain PHP example — use file_get_contents('php://input') for raw body
$body    = file_get_contents('php://input');
$sig     = $_SERVER['HTTP_X_VOX_SIGNATURE'] ?? '';
$secret  = getenv('WEBHOOK_SECRET');

if (!verifyWebhookSignature($body, $secret, $sig)) {
    http_response_code(401);
    echo json_encode(['error' => 'Invalid signature']);
    exit;
}

$event = json_decode($body, true);
error_log("Received event: {$event['event']} {$event['id']}");
http_response_code(200);
echo json_encode(['ok' => true]);
`.trim();

interface PageProps {
  searchParams: Promise<{ token?: string | string[] }>;
}

export const dynamic = 'force-dynamic';

export default async function WebhookTestPage({ searchParams }: PageProps) {
  const { token } = await searchParams;
  if (!isAuthorized(token)) {
    notFound();
  }

  const pre: React.CSSProperties = {
    background: '#1e1e1e',
    color: '#d4d4d4',
    padding: '1rem',
    borderRadius: '6px',
    overflowX: 'auto',
    fontSize: '0.8rem',
    lineHeight: 1.5,
    whiteSpace: 'pre',
  };
  const sectionTitle: React.CSSProperties = {
    fontSize: '1.1rem',
    fontWeight: 'bold',
    marginBottom: '0.5rem',
    marginTop: '2rem',
  };
  const badge: React.CSSProperties = {
    display: 'inline-block',
    background: '#2563eb',
    color: 'white',
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '0.75rem',
    fontFamily: 'monospace',
    marginRight: '0.5rem',
  };

  return (
    <main style={{ padding: '2rem', fontFamily: 'monospace', maxWidth: '900px' }}>
      <h1 style={{ marginBottom: '0.25rem' }}>Webhook test tool</h1>
      <p style={{ color: '#666', marginBottom: '2rem' }}>
        Developer-only page. Use this to verify end-to-end webhook delivery.
      </p>

      <h2 style={sectionTitle}>Step 1 — Get a temporary receiver URL</h2>
      <p style={{ marginBottom: '0.5rem' }}>
        Go to{' '}
        <a href="https://webhook.site" target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>
          webhook.site
        </a>{' '}
        and copy the unique URL shown on the page. It will look like:
      </p>
      <pre style={pre}>https://webhook.site/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx</pre>

      <h2 style={sectionTitle}>Step 2 — Create a test subscription</h2>
      <p style={{ marginBottom: '0.5rem' }}>
        Go to{' '}
        <a href="/settings/integrations" style={{ color: '#2563eb' }}>
          Settings → Integrations
        </a>
        , click <strong>Add webhook</strong>, paste the Webhook.site URL, and select the event types you
        want to test. Save the signing secret that appears — you will need it for verification.
      </p>

      <h2 style={sectionTitle}>Step 3 — Trigger an event</h2>
      <p>
        Run any action that produces the event (complete a call, mark a contact as opted-out, etc.).
        The delivery will appear in Webhook.site within seconds. Each delivery is also logged under
        the webhook row in{' '}
        <a href="/settings/integrations" style={{ color: '#2563eb' }}>
          Settings → Integrations → Deliveries
        </a>
        .
      </p>

      <h2 style={{ ...sectionTitle, marginTop: '3rem' }}>Envelope shapes</h2>
      <p style={{ color: '#666', marginBottom: '1rem' }}>
        Every delivery is wrapped in a standard envelope. The <code>data</code> field varies by event
        type.
      </p>

      {Object.entries(SAMPLE_ENVELOPES).map(([eventType, envelope]) => (
        <div key={eventType} style={{ marginBottom: '1.5rem' }}>
          <div style={{ marginBottom: '0.4rem' }}>
            <span style={badge}>{eventType}</span>
          </div>
          <pre style={pre}>{JSON.stringify(envelope, null, 2)}</pre>
        </div>
      ))}

      <h2 style={{ ...sectionTitle, marginTop: '3rem' }}>Signature verification</h2>
      <p style={{ color: '#666', marginBottom: '1rem' }}>
        Each request carries an <code>x-vox-signature</code> header containing{' '}
        <code>sha256=&lt;hex&gt;</code>. Compute <code>HMAC-SHA256(body, secret)</code> over the raw
        request body and compare — always use a constant-time comparison.
      </p>

      <p style={sectionTitle}>Node.js</p>
      <pre style={pre}>{VERIFICATION_NODE}</pre>

      <p style={sectionTitle}>Python</p>
      <pre style={pre}>{VERIFICATION_PYTHON}</pre>

      <p style={sectionTitle}>PHP</p>
      <pre style={pre}>{VERIFICATION_PHP}</pre>

      <h2 style={{ ...sectionTitle, marginTop: '3rem' }}>Request headers</h2>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #333', textAlign: 'left' }}>
            <th style={{ padding: '0.5rem' }}>Header</th>
            <th style={{ padding: '0.5rem' }}>Description</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['content-type', 'application/json'],
            ['x-vox-event', 'Event type, e.g. call.completed'],
            ['x-vox-event-id', 'UUID of the envelope (idempotency key)'],
            ['x-vox-signature', 'sha256=<hex> — HMAC-SHA256 of the raw body'],
            ['x-vox-timestamp', 'Unix seconds at time of delivery (for replay protection)'],
          ].map(([h, d]) => (
            <tr key={h} style={{ borderBottom: '1px solid #ddd' }}>
              <td style={{ padding: '0.5rem', fontFamily: 'monospace' }}>{h}</td>
              <td style={{ padding: '0.5rem' }}>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ color: '#888', fontSize: '0.75rem', marginTop: '3rem' }}>
        See <code>docs/webhooks.md</code> for full payload shapes, retry behaviour, and receiver
        implementation guidance.
      </p>
    </main>
  );
}

# Outbound Webhooks

VoiceFlow pushes events to external systems (CRMs, Zapier, Make, custom receivers) via HMAC-signed HTTP POST requests. This document covers payload shapes, signature verification, retry behaviour, and receiver implementation guidance.

## Table of contents

- [Subscribing to events](#subscribing-to-events)
- [Envelope format](#envelope-format)
- [Event types and payloads](#event-types-and-payloads)
  - [call.completed](#callcompleted)
  - [call.failed](#callfailed)
  - [appointment.booked](#appointmentbooked)
  - [campaign.completed](#campaigncompleted)
  - [contact.opted_out](#contactopted_out)
  - [lead.qualified](#leadqualified)
- [Request headers](#request-headers)
- [Signature verification](#signature-verification)
  - [Node.js](#nodejs)
  - [Python](#python)
  - [PHP](#php)
- [Retry and backoff](#retry-and-backoff)
- [Webhook deactivation](#webhook-deactivation)
- [Testing](#testing)

---

## Subscribing to events

Webhook subscriptions are managed from **Settings → Integrations → Webhooks**. Each subscription has:

- An HTTPS endpoint URL (your receiver)
- One or more event types to subscribe to
- A per-subscription HMAC-SHA256 signing secret (shown once at creation/rotation)

When an event occurs, all active subscriptions matching that event type receive a delivery.

---

## Envelope format

Every delivery is a JSON object with a consistent outer envelope. The `data` field contains the event-specific payload.

```json
{
  "id": "evt_01hx9qkz3e4f5g6h7j8k9m0n1p",
  "event": "call.completed",
  "occurred_at": "2024-11-15T14:32:18.000Z",
  "org_id": "org_01hx9qkz3e4f5g6h7j8k9m0n1p",
  "data": { ... }
}
```

| Field | Type | Description |
|---|---|---|
| `id` | string (UUID) | Unique delivery ID — use as an idempotency key |
| `event` | string | Event type (see below) |
| `occurred_at` | ISO 8601 string | When the event occurred (UTC) |
| `org_id` | string (UUID) | Organisation that owns the event |
| `data` | object | Event-specific payload |

---

## Event types and payloads

### call.completed

Fired when an AI call ends with a completed outcome.

```json
{
  "id": "evt_01hx9qkz3e4f5g6h7j8k9m0n1p",
  "event": "call.completed",
  "occurred_at": "2024-11-15T14:32:18.000Z",
  "org_id": "org_01hx9qkz3e4f5g6h7j8k9m0n1p",
  "data": {
    "call_id": "call_01hx9qkz3e4f5g6h7j8k9m0n1p",
    "campaign_id": "camp_01hx9qkz3e4f5g6h7j8k9m0n1p",
    "contact_id": "ctct_01hx9qkz3e4f5g6h7j8k9m0n1p",
    "phone_number": "+39 02 1234567",
    "duration_seconds": 142,
    "outcome": "completed",
    "recording_url": "https://cdn.example.com/recordings/call_01hx.mp3"
  }
}
```

### call.failed

Fired when an AI call cannot be completed (no answer, busy, invalid number, etc.).

```json
{
  "id": "evt_01hx9qkz3e4f5g6h7j8k9m0n1q",
  "event": "call.failed",
  "occurred_at": "2024-11-15T14:32:18.000Z",
  "org_id": "org_01hx9qkz3e4f5g6h7j8k9m0n1p",
  "data": {
    "call_id": "call_01hx9qkz3e4f5g6h7j8k9m0n1q",
    "campaign_id": "camp_01hx9qkz3e4f5g6h7j8k9m0n1p",
    "contact_id": "ctct_01hx9qkz3e4f5g6h7j8k9m0n1q",
    "phone_number": "+39 02 7654321",
    "reason": "no_answer"
  }
}
```

`reason` values: `no_answer`, `busy`, `invalid_number`, `voicemail`, `error`.

### appointment.booked

Fired when the AI assistant books an appointment during a call.

```json
{
  "id": "evt_01hx9qkz3e4f5g6h7j8k9m0n1r",
  "event": "appointment.booked",
  "occurred_at": "2024-11-15T14:33:05.000Z",
  "org_id": "org_01hx9qkz3e4f5g6h7j8k9m0n1p",
  "data": {
    "appointment_id": "appt_01hx9qkz3e4f5g6h7j8k9m0n1r",
    "call_id": "call_01hx9qkz3e4f5g6h7j8k9m0n1p",
    "contact_id": "ctct_01hx9qkz3e4f5g6h7j8k9m0n1p",
    "contact_name": "Mario Rossi",
    "contact_phone": "+39 02 1234567",
    "scheduled_at": "2024-11-20T10:00:00.000Z",
    "notes": "Cliente interessato al modello Elettra 2025"
  }
}
```

### campaign.completed

Fired when all calls in a campaign have been processed.

```json
{
  "id": "evt_01hx9qkz3e4f5g6h7j8k9m0n1s",
  "event": "campaign.completed",
  "occurred_at": "2024-11-15T18:00:00.000Z",
  "org_id": "org_01hx9qkz3e4f5g6h7j8k9m0n1p",
  "data": {
    "campaign_id": "camp_01hx9qkz3e4f5g6h7j8k9m0n1p",
    "campaign_name": "Promo Novembre 2024",
    "total_contacts": 500,
    "calls_completed": 423,
    "calls_failed": 77,
    "leads_qualified": 34,
    "appointments_booked": 12,
    "duration_seconds": 18432
  }
}
```

### contact.opted_out

Fired when a contact is marked as opted-out (by the AI during a call or by a user manually).

```json
{
  "id": "evt_01hx9qkz3e4f5g6h7j8k9m0n1t",
  "event": "contact.opted_out",
  "occurred_at": "2024-11-15T14:35:00.000Z",
  "org_id": "org_01hx9qkz3e4f5g6h7j8k9m0n1p",
  "data": {
    "contact_id": "ctct_01hx9qkz3e4f5g6h7j8k9m0n1t",
    "phone_number": "+39 02 9876543",
    "opted_out_at": "2024-11-15T14:35:00.000Z"
  }
}
```

### lead.qualified

Fired when the AI classifies a contact as a qualified lead (outcome `interested`).

```json
{
  "id": "evt_01hx9qkz3e4f5g6h7j8k9m0n1u",
  "event": "lead.qualified",
  "occurred_at": "2024-11-15T14:36:00.000Z",
  "org_id": "org_01hx9qkz3e4f5g6h7j8k9m0n1p",
  "data": {
    "call_id": "call_01hx9qkz3e4f5g6h7j8k9m0n1p",
    "contact_id": "ctct_01hx9qkz3e4f5g6h7j8k9m0n1p",
    "contact_name": "Mario Rossi",
    "contact_phone": "+39 02 1234567",
    "campaign_id": "camp_01hx9qkz3e4f5g6h7j8k9m0n1p",
    "ai_summary": "Il cliente è molto interessato al modello Elettra. Ha chiesto informazioni sul finanziamento.",
    "recommended_action": "call_back"
  }
}
```

---

## Request headers

| Header | Description |
|---|---|
| `content-type` | `application/json` |
| `x-vox-event` | Event type, e.g. `call.completed` |
| `x-vox-event-id` | UUID of the envelope — use as an idempotency key |
| `x-vox-signature` | `sha256=<hex>` — HMAC-SHA256 of the raw request body |
| `x-vox-timestamp` | Unix seconds at the time of delivery (for replay-protection checks) |

---

## Signature verification

Compute `HMAC-SHA256(rawBody, secret)` and compare the result (prefixed with `sha256=`) against the `x-vox-signature` header. **Always use a constant-time comparison** to prevent timing attacks.

> **Important:** Sign the raw bytes of the request body *before* JSON parsing. Parsers may reformat whitespace and invalidate the signature.

### Node.js

```js
const crypto = require('crypto');

function verifyWebhookSignature(body, secret, signatureHeader) {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signatureHeader, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Express.js — use express.raw() to preserve the body bytes
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['x-vox-signature'];
  if (!verifyWebhookSignature(req.body, process.env.WEBHOOK_SECRET, sig)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  const event = JSON.parse(req.body);
  console.log('Received event:', event.event, event.id);
  res.json({ ok: true });
});
```

### Python

```python
import hmac
import hashlib
import os

def verify_webhook_signature(body: bytes, secret: str, signature_header: str) -> bool:
    expected = 'sha256=' + hmac.new(
        secret.encode(), body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header)

# Flask — request.data gives raw bytes
@app.route('/webhook', methods=['POST'])
def webhook():
    sig = request.headers.get('X-Vox-Signature', '')
    if not verify_webhook_signature(request.data, os.environ['WEBHOOK_SECRET'], sig):
        return jsonify({'error': 'Invalid signature'}), 401
    event = request.get_json()
    print(f"Received event: {event['event']} {event['id']}")
    return jsonify({'ok': True})
```

### PHP

```php
<?php
function verifyWebhookSignature(string $body, string $secret, string $signatureHeader): bool {
    $expected = 'sha256=' . hash_hmac('sha256', $body, $secret);
    return hash_equals($expected, $signatureHeader);
}

$body   = file_get_contents('php://input');
$sig    = $_SERVER['HTTP_X_VOX_SIGNATURE'] ?? '';
$secret = getenv('WEBHOOK_SECRET');

if (!verifyWebhookSignature($body, $secret, $sig)) {
    http_response_code(401);
    echo json_encode(['error' => 'Invalid signature']);
    exit;
}

$event = json_decode($body, true);
error_log("Received event: {$event['event']} {$event['id']}");
http_response_code(200);
echo json_encode(['ok' => true]);
```

---

## Retry and backoff

If your endpoint returns a non-2xx response or times out (10 s limit), the delivery is retried with exponential backoff:

| Attempt | Delay after previous attempt |
|---|---|
| 2 | 1 minute |
| 3 | 5 minutes |
| 4 | 15 minutes |
| 5 | 1 hour |
| 6 | 6 hours |
| 7 | 24 hours |

After 7 consecutive failures the webhook is deactivated automatically (see below). All delivery attempts are visible in **Settings → Integrations → Deliveries**.

Your endpoint should return `2xx` quickly (within the 10 s window) and process the event asynchronously. Use `envelope.id` as an idempotency key to handle duplicate deliveries safely.

---

## Webhook deactivation

When a webhook accumulates **6 consecutive failures** (across all retries) it is automatically marked inactive. The org owner receives an email notification. You can re-enable the webhook from Settings → Integrations or by rotating the secret, which resets the failure counter.

To prevent accidental deactivation during planned downtime, delete the subscription before the maintenance window and recreate it afterward.

---

## Testing

Use [Webhook.site](https://webhook.site) to get a free temporary HTTPS receiver URL during development:

1. Open [webhook.site](https://webhook.site) and copy the unique URL.
2. Go to **Settings → Integrations**, create a webhook subscription pointing at that URL.
3. Trigger an event (complete a call, mark a contact as opted-out, etc.).
4. The delivery appears in Webhook.site within seconds — you can inspect headers, body, and timing.
5. Use the **Replay** button in Deliveries to re-send without triggering a new event.

For automated integration testing, the team's dev tool at `/dev/webhook-test?token=<INTERNAL_ADMIN_TOKEN>` shows sample envelopes for all event types and runnable signature verification snippets.

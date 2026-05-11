# Runbook: Webhook Replay

Use this runbook when a webhook delivery (inbound or outbound) failed and the triggering
event needs to be re-processed.

---

## Part 1 — Inbound webhooks (Stripe → VoxAuto)

These are webhooks sent **to** `/api/webhooks/stripe`, `/api/webhooks/vapi`, etc.
They are stored in the `webhook_events` table for idempotent processing.

### 1.1 Locate the failed event in the Stripe dashboard

1. Go to the Stripe Dashboard → **Developers** → **Webhooks**
2. Select the endpoint registered for the production environment
3. Click **Webhook attempts** and filter by **Failed** or search for a specific `Event ID`
4. Click the failing event to see the error detail and response code

Alternatively, query the `webhook_events` table for events that were received but not
successfully processed:

```sql
SELECT id, provider, provider_event_id, event_type, received_at, processed_at, error
FROM webhook_events
WHERE processed_at IS NULL
   OR error IS NOT NULL
ORDER BY received_at DESC
LIMIT 20;
```

A row with `processed_at IS NULL` means the event was received but never handled.
A row with `error IS NOT NULL` means processing started and threw an exception.

### 1.2 Replay via Stripe dashboard

1. In the event detail view, click **Resend** (top-right corner)
2. Stripe will deliver the event again with the same `id` — the `webhook_events` table
   enforces a `UNIQUE (provider, provider_event_id)` constraint, so the handler checks
   for the existing row and skips re-insertion if already processed

### 1.3 Replay via Stripe CLI

```bash
# Install if needed: https://stripe.com/docs/stripe-cli
stripe login

# Resend a specific event by its ID (evt_...)
stripe events resend evt_1AbcDef000000000xxxxxxxyz
```

The CLI sends the event to the **production** endpoint registered in the dashboard.
To target a local dev environment add `--stripe-account <acct_...> --webhook-id <we_...>`.

### 1.4 Replay via Vapi dashboard

1. Go to the Vapi Dashboard → **Logs** → **Webhook logs**
2. Locate the failed delivery (filter by endpoint URL or date range)
3. Click **Retry** on the specific event

### 1.5 Verify idempotency after replay

After triggering the resend, confirm the event was processed exactly once:

```sql
SELECT provider, provider_event_id, event_type, received_at, processed_at, error
FROM webhook_events
WHERE provider = 'stripe'          -- or 'vapi', 'retell', 'twilio'
  AND provider_event_id = 'evt_...' -- the event id you replayed
LIMIT 1;
```

Expected: `processed_at` is non-null and `error` is null.

---

## Part 2 — Outbound webhooks (VoxAuto → customer endpoint)

These are webhooks sent **from** VoxAuto to URLs registered by org admins.
They are delivered by the `webhook/deliver` Inngest job with exponential backoff.

### Delivery lifecycle

| Attempt | Delay before retry |
|---------|--------------------|
| 1       | immediate          |
| 2       | 1 minute           |
| 3       | 5 minutes          |
| 4       | 15 minutes         |
| 5       | 1 hour             |
| 6       | 6 hours            |

After 6 consecutive failures the webhook is **automatically deactivated** and the org
owner receives a notification email. No further retries are attempted until the webhook
is re-enabled by an admin.

### 2.1 Locate the failed delivery in the UI

1. Sign in as the org's `admin` or `owner`
2. Navigate to **Settings → Integrations**
3. Find the webhook subscription and click the delivery history icon
4. The drawer lists all recent delivery attempts with status code and error message

### 2.2 Locate the failed delivery in the database

```sql
-- List recent failed deliveries for an org
SELECT
  d.id            AS delivery_id,
  d.webhook_id,
  d.event_type,
  d.attempt,
  d.status_code,
  d.error,
  d.delivered_at,
  w.url           AS endpoint_url,
  w.active        AS webhook_active
FROM webhook_deliveries d
JOIN webhooks_outgoing w ON w.id = d.webhook_id
WHERE w.org_id = '<org-uuid>'
  AND d.error IS NOT NULL
ORDER BY d.delivered_at DESC
LIMIT 20;
```

### 2.3 Replay via the in-app UI

1. Open the delivery history drawer (Settings → Integrations)
2. Click **Replay** on the specific failed delivery
3. The UI calls `replayDeliveryAction` which enqueues a new `webhook/deliver` Inngest event
4. The replay attempt increments to `attempt + 1` and goes through the same delivery path

Note: replay is only available while the webhook is **active** (`active = true`).
If the webhook has been deactivated (6 failures), you must re-enable it first:

```sql
-- Re-enable a deactivated webhook (use only after the customer has fixed their endpoint)
UPDATE webhooks_outgoing
SET active = true, failure_count = 0
WHERE id = '<webhook-uuid>';
```

Then replay from the UI.

### 2.4 Verify the replay succeeded

```sql
SELECT attempt, status_code, error, delivered_at
FROM webhook_deliveries
WHERE webhook_id = '<webhook-uuid>'
ORDER BY delivered_at DESC
LIMIT 5;
```

A row with `status_code` in the 2xx range and `error IS NULL` confirms successful delivery.

Also check the Inngest dashboard for the `webhook/deliver` function run status:
**Inngest Dashboard → Functions → webhook/deliver → Filter by webhook_id**

---

## Part 3 — Escalation

### When to escalate

Escalate to the engineering on-call if:

- Replay succeeds but the downstream system (e.g. a dealer's CRM) shows no effect — the
  bug may be in the customer's idempotency handling, not VoxAuto
- Multiple orgs report the same event type failing — may indicate a schema change or a
  bug in the fanout logic (`webhook-fanout.ts`)
- The `webhook_events` table has a backlog of `processed_at IS NULL` rows older than
  1 hour — Inngest may be down or the handler is throwing silently
- A webhook is repeatedly deactivated after re-enabling — suspect the customer endpoint
  is rejecting a specific event shape

### Escalation contacts

| Situation                        | Contact                                   |
|----------------------------------|-------------------------------------------|
| Inngest outage                   | status.inngest.com; page on-call engineer |
| Stripe event backlog > 1 hour    | Stripe Status; page on-call engineer      |
| Customer's endpoint is incorrect | Contact the org owner; note in audit log  |

### Inngest retry status check

```bash
# List recent function runs for a specific event type
# (Inngest CLI or dashboard — requires INNGEST_TOKEN)
inngest run list --function webhook/deliver --status failed --limit 50
```

### Verify no duplicate side-effects after replay

Before replaying a Stripe event that triggered a payment (e.g. `payment_intent.succeeded`),
confirm the effect was not already applied:

```sql
SELECT id, entry_type, delta_cents, description, created_at
FROM credit_ledger
WHERE org_id = '<org-uuid>'
ORDER BY created_at DESC
LIMIT 10;
```

If the credit was already applied, **do not replay**. Instead, investigate why
`processed_at` was not set on the `webhook_events` row and fix the handler.

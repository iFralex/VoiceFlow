# Runbook: Manual Credit Adjustment

Use this runbook when an org's credit balance needs to be corrected outside the normal top-up flow
(e.g. billing error, goodwill credit, refund reconciliation after an external dispute).

## Prerequisites

- Access to `INTERNAL_ADMIN_TOKEN` from 1Password (vault: Production Secrets)
- The target org's UUID from the database or Supabase dashboard
- A clear, concise reason for the adjustment (recorded in the audit log)

## Endpoint

```
POST /api/admin/credit-adjustment
```

### Headers

| Header         | Value                                  |
|----------------|----------------------------------------|
| Content-Type   | application/json                       |
| x-admin-token  | Value of `INTERNAL_ADMIN_TOKEN` env var |

### Body

```json
{
  "orgId": "<uuid>",
  "deltaCents": 29900,
  "reason": "Goodwill credit — system outage 2026-05-03 (ticket #1234)"
}
```

- `orgId`: The organization's UUID (required)
- `deltaCents`: Integer cents to add (positive) or debit (negative). E.g. `29900` = €299.00
- `reason`: Free-text description recorded verbatim in the audit log (required, non-empty)

### Response

```json
{ "ok": true }
```

HTTP 200 on success. HTTP 401 if the token is wrong. HTTP 400 if the body is invalid.

## Example — add €99 goodwill credit

```bash
curl -s -X POST https://app.voxauto.it/api/admin/credit-adjustment \
  -H "Content-Type: application/json" \
  -H "x-admin-token: $INTERNAL_ADMIN_TOKEN" \
  -d '{
    "orgId": "11111111-1111-1111-1111-111111111111",
    "deltaCents": 9900,
    "reason": "Goodwill credit — call quality issue reported by customer (ticket #987)"
  }'
```

## Example — debit €50 for a billing error reversal

```bash
curl -s -X POST https://app.voxauto.it/api/admin/credit-adjustment \
  -H "Content-Type: application/json" \
  -H "x-admin-token: $INTERNAL_ADMIN_TOKEN" \
  -d '{
    "orgId": "22222222-2222-2222-2222-222222222222",
    "deltaCents": -5000,
    "reason": "Reversal — duplicate top-up credited twice (Stripe charge ch_xxx)"
  }'
```

## What happens internally

1. The route validates the admin token via constant-time comparison against `INTERNAL_ADMIN_TOKEN`
2. The request body is validated (UUID format, integer cents, non-empty reason)
3. `adjust(orgId, 'system', deltaCents, reason, { actorType: 'system' })` is called:
   - Acquires a `SELECT ... FOR UPDATE` lock on the org's latest ledger row
   - Inserts a new `credit_ledger` entry of type `adjustment`
   - Records an `audit_log` entry with `actor_type = 'system'`, `action = 'credit.adjusted'`
4. Returns `{ ok: true }` — no email or notification is triggered automatically

## Audit trail

All adjustments appear in:
- The credit history page (`/credit`) for the affected org, with type badge "adjustment"
- The `audit_log` table: `action = 'credit.adjusted'`, `actor_type = 'system'`

To verify an adjustment was applied:

```sql
SELECT id, delta_cents, balance_after_cents, description, created_at
FROM credit_ledger
WHERE org_id = '<uuid>'
  AND entry_type = 'adjustment'
ORDER BY created_at DESC
LIMIT 10;
```

## Notes

- The adjustment is **not idempotent** — calling the endpoint twice will apply the delta twice
- For large adjustments (> €500), get a second approval from a team lead before executing
- The Reconciliation Cron (Task 16) does not reverse manual adjustments; they are permanent
- Full operational details and escalation path will be added in plan 14

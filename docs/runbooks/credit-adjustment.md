# Runbook: Manual Credit Adjustment

Use this runbook when an org's credit balance needs to be corrected outside the normal top-up flow
(e.g. billing error, goodwill credit, refund reconciliation after an external dispute).

**Who can execute:** Founder only. Any adjustment requires a documented approval before execution.

---

## 1. Approval Flow

Before touching the endpoint, record the intent:

1. Open the shared **Credit Adjustments** Notion page (link in 1Password notes under "Internal Docs").
2. Create a new entry with the following fields:
   - **Date:** today's date
   - **Org name + UUID:** find in Supabase dashboard → Table Editor → `memberships` or `organizations`
   - **Amount:** e.g. +€99.00 (positive = add credit; negative = debit)
   - **Reason:** concise factual description (no more than two sentences)
   - **Related ticket / evidence:** Stripe charge ID, support thread URL, or email subject
   - **Approved by:** your name (as founder, self-approval is acceptable for amounts ≤ €500)
3. For amounts **> €500**, get a written second confirmation from a co-founder or technical lead before proceeding (reply in the Notion entry or in a shared Slack thread).
4. Note the Notion entry URL — you will paste it into the `reason` field of the API call.

---

## 2. Prerequisites

- Access to `INTERNAL_ADMIN_TOKEN` from 1Password (vault: **Production Secrets**)
- The target org's UUID (see §1 above for how to find it)
- The approved Notion entry URL for the `reason` field

---

## 3. Endpoint

```
POST /api/admin/credit-adjustment
```

### Headers

| Header         | Value                                   |
|----------------|-----------------------------------------|
| Content-Type   | application/json                        |
| x-admin-token  | Value of `INTERNAL_ADMIN_TOKEN` env var |

### Body

```json
{
  "orgId": "<uuid>",
  "deltaCents": 29900,
  "reason": "Goodwill credit — system outage 2026-05-03 (ticket #1234, approval: <notion-url>)"
}
```

- `orgId`: the organization's UUID (required)
- `deltaCents`: integer cents to add (positive) or debit (negative). E.g. `29900` = €299.00
- `reason`: free-text recorded verbatim in the audit log (required, non-empty). Always include the Notion entry URL.

### Response

```json
{ "ok": true }
```

HTTP 200 on success. HTTP 401 if the token is wrong. HTTP 400 if the body is invalid.
HTTP 400 with `{ "error": "adjustment_would_overdraft" }` if a negative delta would push the balance below zero (use `allowNegative: true` only with explicit approval and documented reason).

---

## 4. Executing the Adjustment

### Add €99 goodwill credit

```bash
curl -s -X POST https://app.voxauto.it/api/admin/credit-adjustment \
  -H "Content-Type: application/json" \
  -H "x-admin-token: $INTERNAL_ADMIN_TOKEN" \
  -d '{
    "orgId": "11111111-1111-1111-1111-111111111111",
    "deltaCents": 9900,
    "reason": "Goodwill credit — call quality issue 2026-05-10 (notion.so/xxx)"
  }'
```

### Debit €50 for a billing reversal

```bash
curl -s -X POST https://app.voxauto.it/api/admin/credit-adjustment \
  -H "Content-Type: application/json" \
  -H "x-admin-token: $INTERNAL_ADMIN_TOKEN" \
  -d '{
    "orgId": "22222222-2222-2222-2222-222222222222",
    "deltaCents": -5000,
    "reason": "Reversal — duplicate top-up credited twice (Stripe charge ch_xxx, notion.so/yyy)"
  }'
```

**Warning:** The adjustment is **not idempotent** — calling the endpoint twice applies the delta twice. Verify the response is `{ "ok": true }` before deciding to retry.

---

## 5. Confirming on the Org's Credit Page

After calling the endpoint, verify the change landed correctly:

1. In the app, impersonate or navigate to the org's credit history page: `/credit` (or open it in the Supabase dashboard).
2. Confirm the new ledger row appears with `entry_type = adjustment` and the correct `delta_cents`.
3. Verify the **running balance** shown on the page matches the expected new total.
4. Cross-check via SQL if you want a second source of truth:

```sql
SELECT id, delta_cents, balance_after_cents, description, created_at
FROM credit_ledger
WHERE org_id = '<uuid>'
  AND entry_type = 'adjustment'
ORDER BY created_at DESC
LIMIT 5;
```

5. Also confirm the audit log entry exists:

```sql
SELECT action, metadata, created_at
FROM audit_log
WHERE org_id = '<uuid>'
  AND action = 'credit.adjusted'
ORDER BY created_at DESC
LIMIT 5;
```

6. Record the new balance in the Notion entry (field: **Balance after**).

---

## 6. What Happens Internally

1. The route validates the admin token via constant-time comparison against `INTERNAL_ADMIN_TOKEN`.
2. The request body is validated (UUID format, integer cents, non-empty reason).
3. `adjust(orgId, 'system', deltaCents, reason, { actorType: 'system' })` acquires a `SELECT ... FOR UPDATE` lock on the org's latest ledger row, inserts a new `credit_ledger` entry of type `adjustment`, and records an `audit_log` entry with `actor_type = 'system'`, `action = 'credit.adjusted'`.
4. Returns `{ ok: true }` — no automatic email or notification is triggered. Dealer communication is manual (see §7).

---

## 7. Communication Template to the Dealer

Send via email (Resend) or WhatsApp depending on the org's preferred channel. Adjust the amount and reason accordingly.

---

**Subject:** Aggiornamento del credito VoxAuto — [Nome organizzazione]

Ciao [Nome],

ti scrivo per informarti che abbiamo applicato un aggiustamento manuale al credito del tuo account VoxAuto.

**Dettaglio:**
- Organizzazione: [nome org]
- Importo: [+€XX.XX / −€XX.XX]
- Motivazione: [breve spiegazione — es. "credito di cortesia a seguito di un disservizio il 10/05/2026"]
- Data applicazione: [data odierna]

Il nuovo saldo disponibile è visibile nella sezione **Credito** del tuo pannello VoxAuto.

Se hai domande, rispondimi a questa email o scrivimi direttamente.

Grazie,
[Nome fondatore]
VoxAuto

---

**Notes on timing:**
- Send the communication within **1 business hour** of the adjustment for amounts > €50.
- For small goodwill credits (< €20), sending by end of day is sufficient.
- For debits, always send proactively — never wait for the dealer to notice.

---

## 8. Escalation

| Situation | Action |
|-----------|--------|
| Endpoint returns 500 | Check Sentry for the error; do not retry blindly |
| Balance still wrong after confirmed 200 | Check `credit_ledger` table directly; call may have applied but response was lost — do NOT retry without checking |
| Dealer disputes the adjustment | Open a Notion escalation entry; freeze further adjustments until resolved |
| Amount > €1,000 | Requires written approval from two founders before execution |

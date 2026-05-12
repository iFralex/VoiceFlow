# Runbook: Credential Rotation

This runbook documents the procedure for rotating every service credential used by VoxAuto.
Rotate on schedule or immediately after a suspected compromise. All secrets are stored in
1Password (vault: **Production Secrets**) and mirrored to Vercel environment variables.

**Do not skip verification steps.** A bad rotation causes an outage; an incomplete rotation
leaves the old credential live. Always finish both before closing the change.

---

## Rotation Schedule Summary

| Credential                      | Frequency    | Next due (update when rotated) |
|---------------------------------|--------------|-------------------------------|
| Stripe API keys                 | 12 months    |                               |
| Vapi API key                    | 6 months     |                               |
| Retell API key                  | 6 months     |                               |
| Supabase service-role key       | 12 months    |                               |
| Resend API key                  | 12 months    |                               |
| SBC trunk passwords             | 6 months     |                               |
| `CRON_SECRET`                   | 12 months    |                               |
| `INTERNAL_ADMIN_TOKEN`          | 12 months    |                               |
| `WEBHOOK_SIGNING_SECRET`        | 12 months    |                               |
| User PATs                       | User-driven  | (see §8)                      |

---

## 1. Stripe API Keys

**Rotation interval:** 12 months, or immediately after a suspected leak.

### Where to rotate

1. Log into [dashboard.stripe.com](https://dashboard.stripe.com) → Developers → API keys.
2. Click **Create restricted key** (or roll the secret key if it has no restrictions).
3. Scope the new key with the same permissions as the existing one (check the old key's
   label for the scope description).
4. Do **not** delete the old key yet — keep it active during the switchover window.

### Update env vars

1. Open 1Password → Production Secrets → **Stripe Live Secret Key**.
2. Add the new value as a new version (keep old version visible for rollback).
3. In Vercel → Project Settings → Environment Variables:
   - Update `STRIPE_SECRET_KEY` (Production + Preview) with the new value.
   - Update `STRIPE_WEBHOOK_SECRET` if a new webhook endpoint signing secret was also generated.
4. Trigger a Vercel redeployment so the new value is picked up.

### Verification

```bash
# Confirm the new key works
curl -s https://api.stripe.com/v1/balance \
  -u "$STRIPE_SECRET_KEY:" | jq '.available'
```

Expected: JSON object with currency/amount data (not an error object).

Also check the `/api/ready` endpoint:

```bash
curl https://app.voxauto.it/api/ready | jq '.checks.stripe'
```

Expected: `"ok"`.

### Rollback

1. In Vercel, revert `STRIPE_SECRET_KEY` to the previous value (stored in 1Password history).
2. Redeploy.
3. Revoke the new key in the Stripe dashboard.

---

## 2. Vapi API Key

**Rotation interval:** 6 months.

### Where to rotate

1. Log into [dashboard.vapi.ai](https://dashboard.vapi.ai) → Settings → API Keys.
2. Create a new API key.
3. Note the new value — Vapi shows it only once.

### Update env vars

1. 1Password → Production Secrets → **Vapi API Key** — add new version.
2. Vercel → `VAPI_API_KEY` (Production + Preview) → update.
3. Redeploy.

### Verification

```bash
curl https://app.voxauto.it/api/ready | jq '.checks.vapi'
```

Expected: `"ok"`.

### Rollback

Revert `VAPI_API_KEY` in Vercel to the previous value from 1Password history and redeploy.
Delete the newly created Vapi key.

---

## 3. Retell API Key

**Rotation interval:** 6 months.

### Where to rotate

1. Log into [app.retellai.com](https://app.retellai.com) → Settings → API Keys.
2. Generate a new key; copy it immediately.

### Update env vars

1. 1Password → Production Secrets → **Retell API Key** — add new version.
2. Vercel → `RETELL_API_KEY` (Production + Preview) → update.
3. Redeploy.

### Verification

```bash
# Manual: confirm no 401 errors appear in Axiom/Sentry for Retell calls
# after the first batch of real calls post-rotation
curl https://app.voxauto.it/api/ready | jq '.checks.vapi'
```

If Retell is the active voice provider (`VOICE_PROVIDER=retell`), the ready check pings it.

### Rollback

Revert `RETELL_API_KEY` in Vercel; redeploy. Delete the new key in Retell dashboard.

---

## 4. Supabase Service-Role Key

**Rotation interval:** 12 months. **This key bypasses Row Level Security — treat it like a
root database password. Rotate with extreme care and outside business hours.**

### Where to rotate

1. Log into [app.supabase.com](https://app.supabase.com) → project → Settings → API.
2. Under **Project API keys**, click **Reveal** next to `service_role`.
3. Supabase does not auto-rotate this key. Instead, copy the current key before proceeding;
   the actual rotation is done by revoking the old JWT after the new one is live.
   - At the time of writing, Supabase's project key rotation is performed via
     **Project Settings → API → Roll API keys** (if available for your tier) or by
     contacting Supabase support.
4. If rolling is not available, you must **update the value in Vercel first**, then invalidate
   the old key via Supabase support.

### Update env vars

1. 1Password → Production Secrets → **Supabase Service Role Key** — add new version.
2. Vercel → `SUPABASE_SERVICE_ROLE_KEY` (Production + Preview) → update.
3. Redeploy.

### Verification

```bash
# A successful admin auth action (e.g. membership invite) confirms the key works.
# Also check Sentry for any AuthenticationError events in the 5 min post-rotation window.
curl https://app.voxauto.it/api/ready | jq '.checks.database'
```

Expected: `"ok"`.

### Rollback

If the new key is rejected, revert `SUPABASE_SERVICE_ROLE_KEY` in Vercel and redeploy
immediately. Contact Supabase support if the old key was already invalidated.

---

## 5. Resend API Key

**Rotation interval:** 12 months, or immediately after a suspected leak (Resend keys allow
sending email on your behalf).

### Where to rotate

1. Log into [resend.com](https://resend.com) → API Keys.
2. Click **Create API Key**; select the same domain permission as the current key.
3. Copy the new key — shown only once.

### Update env vars

1. 1Password → Production Secrets → **Resend API Key** — add new version.
2. Vercel → `RESEND_API_KEY` (Production + Preview) → update.
3. Redeploy.

### Verification

Trigger a test email (e.g. invite yourself to an org) and confirm delivery. Check Resend
dashboard Logs for a successful `200` response within 60 seconds.

### Rollback

Revert `RESEND_API_KEY` in Vercel and redeploy. Delete the new key in Resend dashboard.

---

## 6. SBC Trunk Passwords

**Rotation interval:** 6 months. Applies to each SBC trunk used in the CLI pool.

### Where to rotate

SBC trunk credentials are set in the SBC provider's admin panel (e.g. Twilio SIP domain
or dedicated SBC portal). For each trunk:

1. Log into the SBC/carrier admin panel.
2. Navigate to the trunk or SIP domain configuration.
3. Generate or set a new password for the trunk authentication credential.

### Update env vars

SBC trunk credentials are typically stored as part of the CLI pool configuration. Update:

1. 1Password → Production Secrets → **SBC Trunk Credentials** (one entry per trunk) —
   add new password version.
2. Vercel → update the relevant `SBC_TRUNK_PASSWORD` env var(s).
3. Redeploy.
4. Update the SBC dial-out configuration in `src/lib/voice/` if trunk passwords are
   embedded in dial strings.

### Verification

After rotation, run a test call to the internal smoke-test number:

```bash
curl -X POST https://app.voxauto.it/api/cron/sbc-smoke-test \
  -H "Authorization: Bearer $CRON_SECRET"
```

Expected: smoke test passes; Axiom logs show `sbc/smoke-test-passed`.

### Rollback

Revert the trunk password in the SBC admin panel and in Vercel env vars; redeploy.

---

## 7. Internal HMAC / Bearer Secrets

This covers `CRON_SECRET`, `INTERNAL_ADMIN_TOKEN`, and `WEBHOOK_SIGNING_SECRET`.

**Rotation interval:** 12 months.

### Where to rotate

These are self-generated values with no external dashboard. Generate new secrets with:

```bash
# CRON_SECRET — at least 32 chars
openssl rand -base64 32

# INTERNAL_ADMIN_TOKEN — at least 32 chars
openssl rand -base64 48

# WEBHOOK_SIGNING_SECRET — 32 bytes hex
openssl rand -hex 32
```

### Update env vars

For each secret:

1. 1Password → Production Secrets → update the corresponding entry (add new version).
2. Vercel → update the env var (Production + Preview).
   - `CRON_SECRET` — also update any Vercel Cron job configuration that passes this value
     in the `Authorization` header if it is hard-coded there.
   - `INTERNAL_ADMIN_TOKEN` — used only by the `/api/admin/*` endpoints.
   - `WEBHOOK_SIGNING_SECRET` — used by outgoing webhook HMAC signing; updating this
     will invalidate all existing webhook subscriptions' signatures. Notify customers
     (or your own integration tests) that they must re-register their webhooks or accept
     the new secret value.
3. Redeploy.

### Verification

`CRON_SECRET`:
```bash
curl -I https://app.voxauto.it/api/cron/retention-purge \
  -H "Authorization: Bearer $CRON_SECRET"
```
Expected: `200 OK` (or `204`).

`INTERNAL_ADMIN_TOKEN`:
```bash
curl -s https://app.voxauto.it/api/admin/credit-adjustment \
  -H "Content-Type: application/json" \
  -H "x-admin-token: $INTERNAL_ADMIN_TOKEN" \
  -d '{"orgId":"00000000-0000-0000-0000-000000000000","deltaCents":0,"reason":"rotation-test"}' \
  | jq '.ok'
```
Expected: `false` (invalid UUID, but 400 not 401 means token was accepted).

`WEBHOOK_SIGNING_SECRET`: trigger a test webhook delivery and confirm the HMAC header
is valid on the receiving end.

### Rollback

Revert to the previous secret in 1Password; update Vercel; redeploy. For
`WEBHOOK_SIGNING_SECRET`, also revert the secret stored on any webhook consumer side.

---

## 8. User Personal Access Tokens (PATs)

Users may generate PATs from `/settings/api-tokens` to authenticate API calls from
their own integrations or scripts.

### Policy

- PATs have no forced expiry by default but users are encouraged to set an expiration
  date when creating them.
- Support may request a user to regenerate a PAT if it is suspected compromised (e.g.
  found in a public GitHub repo).
- Founders or admins cannot read PAT values (they are stored as bcrypt hashes). They can
  only revoke tokens.

### User-initiated rotation

The user visits `/settings/api-tokens`, clicks **Revoke** next to the old token, then
clicks **New token** to generate a replacement. The new raw value is shown once on creation.

### Admin-initiated revocation (suspected compromise)

1. Open the Supabase dashboard → Table Editor → `personal_access_tokens`.
2. Filter by `org_id` and `user_id` to locate the suspect token.
3. Delete the row. The token will be rejected on the next API call.
4. Notify the user by email (use the template in `src/lib/email/dispatcher.ts` or send
   a manual email from the `EMAIL_FROM_ADDRESS` address explaining the revocation reason).

### Verification

Have the user confirm their integration returns `401 Unauthorized` with the old token
and `200 OK` with the new one.

---

## General Notes

- **Principle of least privilege:** When creating a new key, request only the scopes
  the application actually uses. Document the scope in the 1Password item's notes field.
- **No credential in source code:** All secrets must live in env vars or 1Password.
  If you discover a secret committed to git, rotate it immediately and use
  `git filter-repo` or BFG to purge it from history.
- **Overlap window:** For keys that are not atomic (i.e. you cannot atomically swap old
  for new in all servers simultaneously), keep the old key valid for 5 minutes after the
  new one is deployed to allow in-flight requests to drain.
- **Incident rotation:** If rotating due to a suspected breach, also rotate every other
  credential that could have been accessed via the compromised one (e.g. if the Supabase
  service-role key was leaked, rotate all keys stored in the database).

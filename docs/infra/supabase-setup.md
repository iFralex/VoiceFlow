# Supabase Project Provisioning Guide

This document covers the one-time manual steps required to provision the three VoiceFlow Supabase projects.
Settings that can be version-controlled are in `supabase/config.toml`; settings that must be applied via
the Supabase Dashboard or Management API are described here.

---

## 1. Create projects

In the [Supabase Dashboard](https://supabase.com/dashboard) create three projects in the **EU (Frankfurt)** region:

| Display name         | Slug (example)          | Tier     |
|----------------------|-------------------------|----------|
| VoiceFlow-dev        | voiceflow-dev           | Free/Pro |
| VoiceFlow-staging    | voiceflow-staging       | Pro      |
| VoiceFlow-prod       | voiceflow-prod          | Pro      |

For each project:
- Select **Postgres 16**
- Enable **Authentication**, **Storage**, **Realtime** during project creation (all are on by default)

---

## 2. Capture credentials to 1Password

After each project is created, save the following into the `VoiceFlow / Supabase` 1Password vault under
separate entries for `dev`, `staging`, and `prod`:

- Project URL: `https://<ref>.supabase.co`
- Anon key (JWT)
- Service-role key (JWT) — **never expose to browsers**
- Pooler connection string (port 6543, Transaction mode) — used as `DATABASE_URL`
- Direct connection string (port 5432) — used as `DATABASE_DIRECT_URL`

---

## 3. Storage buckets

In **Storage → Buckets** for each project, create four **private** buckets:

| Bucket name    | Max upload size |
|----------------|-----------------|
| recordings     | 500 MB          |
| transcripts    | 50 MB           |
| csv-uploads    | 50 MB           |
| exports        | 50 MB           |

Set each bucket to **private** (unauthenticated reads disabled).
RLS storage policies are applied by migration `drizzle/migrations/0004_storage_policies.sql`.

---

## 4. Authentication providers

In **Authentication → Providers**:

- **Email**: enabled
  - Disable "Confirm email" if using magic link only (or keep enabled and test the flow)
  - Enable "Email OTP" / magic link
  - **Disable passwords** — set _Minimum password length_ to a very high value or use the Supabase
    CLI to disable the password flow entirely
- All other providers (Google, GitHub, etc.): **disabled**

---

## 5. Magic link / OTP settings

In **Authentication → Configuration → Auth**:

- OTP expiry: **1800 seconds** (30 minutes)
- OTP length: **6 digits**
- Site URL: `https://voiceflow.example.com` (prod), `https://staging.voiceflow.example.com` (staging),
  `http://localhost:3000` (dev)

In **Authentication → URL Configuration → Redirect URLs** add:

```
http://localhost:3000
https://staging.voiceflow.example.com
https://voiceflow.example.com
```

---

## 6. Italian email templates

In **Authentication → Email Templates** set the following for each template. The language must be Italian.

### Confirm signup (Conferma registrazione)

```
Oggetto: Conferma la tua registrazione a VoiceFlow

Salve,

Clicca il link seguente per confermare il tuo account:

{{ .ConfirmationURL }}

Il link scadrà tra 30 minuti.
Se non hai effettuato questa richiesta, ignora questa email.

Il team VoiceFlow
```

### Magic link / OTP

```
Oggetto: Il tuo link di accesso a VoiceFlow

Salve,

Ecco il tuo codice di accesso: {{ .Token }}

Oppure clicca il link seguente:
{{ .ConfirmationURL }}

Il codice scadrà tra 30 minuti.
Se non hai richiesto l'accesso, ignora questa email.

Il team VoiceFlow
```

### Password reset placeholder (not used in Phase 1)

```
Oggetto: Reimpostazione password VoiceFlow

Salve,

Per reimpostare la tua password clicca:
{{ .ConfirmationURL }}

Il link scadrà tra 30 minuti.

Il team VoiceFlow
```

### Change email confirm

```
Oggetto: Conferma il cambio email VoiceFlow

Salve,

Clicca il link seguente per confermare il tuo nuovo indirizzo email:
{{ .ConfirmationURL }}

Il link scadrà tra 30 minuti.

Il team VoiceFlow
```

---

## 7. Link local dev to a project

After provisioning, link a local Supabase CLI session to the dev project:

```bash
supabase login
supabase link --project-ref <dev-project-ref>
```

Then apply migrations:

```bash
pnpm db:migrate
```

---

## 8. Verification checklist

- [ ] Three projects visible in Supabase Dashboard
- [ ] All credentials saved in 1Password vault `VoiceFlow / Supabase`
- [ ] Four private storage buckets created in each project
- [ ] Auth providers: email + magic link only; no OAuth
- [ ] Italian email templates applied in each project
- [ ] OTP expiry = 1800 s, OTP length = 6
- [ ] Redirect allowlist includes localhost:3000, staging URL, prod URL

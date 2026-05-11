# Runbook — GDPR Article 17 Erasure (Right to Be Forgotten)

**Applies to:** Owner, Admin  
**Capability required:** `compliance.erase`  
**Regulation:** GDPR Article 17, D.Lgs. 196/2003 (Codice Privacy italiano)  
**Response deadline:** 30 calendar days from receipt of the request (Art. 12 GDPR)

---

## 1. Intake — how requests arrive

### 1a. In-app (self-service)
Contact the customer (dealer) via their dashboard. If they ask you to erase
a data subject on their behalf, collect the subject's phone number or email
address and proceed to §3.

### 1b. Email
Erasure requests usually arrive at the support address (`SUPPORT_EMAIL_ADDRESS`
env var, visible in email footers). Forward the email to a dedicated inbox or
Notion page so you can track the 30-day deadline.

### 1c. Postal mail
Italian GDPR requests sent by registered letter are valid. Scan the letter
and record it in the same tracking inbox / Notion page as email requests.
Start the 30-day clock from the date on the postmark or the date of receipt
(whichever is later).

---

## 2. Identity verification of the requestor

Before executing any erasure you must confirm that:

1. **The requestor is the data subject themselves** — ask for a copy of a
   government-issued ID (carta d'identità / passaporto). Verify the name
   matches what is stored in the contact record.
2. **Or the requestor is an authorised representative** — ask for a written
   proxy (*delega scritta*) plus the representative's ID.
3. **The request is unambiguous** — it must clearly state the right being
   exercised (erasure / cancellazione) and identify the subject (phone number
   or email address registered in the platform).

Do **not** proceed if you cannot verify identity. Reply explaining the
verification requirement and restart the 30-day clock once documentation
arrives.

---

## 3. Executing the erasure

The erasure is performed by an **Owner** or **Admin** via the compliance
settings page. Operators do not have the `compliance.erase` capability.

### Step-by-step

1. Navigate to **Settings → Compliance** in the dashboard
   (`/settings/compliance`).
2. In the "Cancellazione dati soggetto (GDPR Art. 17)" section, enter:
   - **Identifier** — the subject's phone number (E.164, e.g. `+393331234567`)
     or email address.
   - **Confirm phone** — retype the subject's E.164 phone number exactly.
     This confirmation guard prevents accidental erasure.
   - **Reason** — a short note such as
     `"Richiesta di cancellazione ricevuta per email il 2026-05-11"`.
3. Click **Cancella dati**.

### What the system does immediately

- Scrubs `first_name`, `last_name`, `email` from the contact row.
- Keeps `phone_e164` in place so the opt-out registry stays queryable.
- Tombstones the `metadata` field: `{ gdpr_erasure: true, erased_at, erasure_reason }`.
- Sets `deleted_at` on the contact (soft-delete).
- Tombstones `calls.metadata` for every call linked to the contact, removing
  transcript snippets and raw outcome text.
- Deletes call recordings and transcripts from Supabase Storage immediately
  (best-effort; storage errors are logged and retried by the retention cron).
- Registers a permanent org-wide opt-out via the standard opt-out flow
  with source `gdpr_request`.
- Writes an `audit_log` entry with action `compliance.gdpr_erasure`.
- Emits an Inngest event `compliance/gdpr-erasure` which triggers a
  confirmation email to the operator who performed the erasure.

### Verify the erasure

1. In the same compliance page, scroll to **Storico richieste GDPR** and
   confirm the new entry appears with action `gdpr_erasure`.
2. Attempt a contact lookup or export for the same identifier — it must
   return `subject_not_found`.
3. Check the Axiom logs for `[gdpr.erase]` to confirm `storageErrors: 0`
   (or follow-up if non-zero — see §6).

---

## 4. 30-day grace period and final hard purge

The contact row is **soft-deleted** at erasure time. The `deleted_at` timestamp
is set but the row remains in the database.

After **30 calendar days** the daily retention cron (`/api/cron/retention-purge`,
runs at **03:00 Europe/Rome**) hard-deletes the contact row. The FK
`calls.contact_id ON DELETE CASCADE` automatically removes all associated call
rows, and any residual storage objects (orphaned by a prior storage error) are
purged in the same cron run.

**Legal hold exception:** if the contact has an active `legal_hold_until` date
in the future (e.g. due to a police inquiry), the retention cron skips that row
until the hold expires. Check with legal counsel before lifting a hold.

You do **not** need to do anything to trigger the hard purge — it is fully
automatic. To verify it has run, check the Axiom log stream for
`[retention-purge]` with `action: compliance.retention_purge_completed` on the
morning after the 30-day mark.

---

## 5. Communication template — confirmation to the requestor

Send the following email once the erasure has been confirmed (§3 "Verify").
Adjust the Italian/English language based on how the request arrived.

**Subject:** Conferma cancellazione dati — GDPR Art. 17 / Confirmation of data erasure — GDPR Art. 17

---

Gentile [Nome Cognome],

Confermiamo la ricezione della Sua richiesta di cancellazione dei dati personali ai sensi dell'art. 17 del Regolamento UE 2016/679 (GDPR), ricevuta in data [DATA RICEZIONE].

La cancellazione è stata eseguita in data [DATA ESECUZIONE]. In particolare sono stati eliminati:

- i dati anagrafici (nome, cognome, indirizzo e-mail) associati al numero [NUMERO TELEFONO];
- i metadati delle registrazioni delle chiamate;
- i file audio e le trascrizioni delle chiamate effettuate.

Il numero di telefono rimane registrato nel nostro registro opt-out per impedire futuri contatti.

Le ricordiamo che ai sensi dell'art. 77 GDPR ha il diritto di proporre reclamo al Garante per la Protezione dei Dati Personali (www.garanteprivacy.it) qualora ritenga che il trattamento dei Suoi dati non sia conforme alla normativa vigente.

Cordiali saluti,  
[NOME OPERATORE]  
[NOME AZIENDA]

---

Dear [First Name Last Name],

We confirm receipt of your personal data erasure request pursuant to Art. 17 of EU Regulation 2016/679 (GDPR), received on [RECEIPT DATE].

The erasure was completed on [EXECUTION DATE]. Specifically, the following data has been deleted:

- personal details (first name, last name, email address) associated with phone number [PHONE NUMBER];
- call metadata (transcript snippets, outcome data);
- call recordings and transcripts.

Your phone number remains in our opt-out registry to prevent future contacts.

Under Art. 77 GDPR you have the right to lodge a complaint with the Italian Data Protection Authority (Garante per la Protezione dei Dati Personali, www.garanteprivacy.it) if you believe your data has not been processed in accordance with applicable law.

Kind regards,  
[OPERATOR NAME]  
[COMPANY NAME]

---

## 6. Escalation — storage errors

If the erasure result shows `storageErrors > 0`:

1. Check Axiom logs for `[gdpr.erase] recording delete failed` or
   `[gdpr.erase] transcript delete failed` to identify the affected paths.
2. The retention cron will retry storage deletion during the next run
   (within 24 hours). Check again the morning after.
3. If storage errors persist after 3 days, escalate to Supabase support
   with the affected bucket paths. Do **not** grant the requestor a
   "erasure incomplete" response — the DB-layer scrub already ensures no PII
   is readable; the storage objects are inaccessible without a DB pointer.
4. Once storage errors are resolved, update the audit log entry notes if your
   tracking system supports it.

---

## 7. Record-keeping

Italian law requires you to keep evidence of erasure requests and their
fulfilment for **5 years** (per the statute of limitations for privacy
violations). Store:

- The original request (email / scanned letter).
- The identity verification documents (encrypted, access-restricted).
- A copy of this confirmation email.

The `audit_log` table entry with action `compliance.gdpr_erasure` serves as
the system-of-record proof of execution and is retained per the platform's
own audit log retention policy.

---

## 8. Related runbooks

- `docs/runbooks/credential-rotation.md` — if the subject's data was also
  present in an API key or token, rotate accordingly.
- `docs/runbooks/disaster-recovery.md` — if you restore from a backup after
  an erasure, you must re-apply the erasure to the restored dataset before
  it carries any live traffic.

# Plan: Contacts and CSV Import

**Branch:** `feat/06-contacts-and-csv-import`
**Wave:** 2
**Depends on:** 01, 02, 03, 04
**Estimated effort:** 3–5 days

## Overview

Implements the contact ingestion pipeline described in spec §5.4 (CSV upload UX), §6.5 (Inngest job for parsing), §7.2 (`contact_lists` and `contacts` tables) and §12.4 (data minimisation, consent basis). After this plan merges, a dealer can upload a CSV from the dashboard, the file is parsed asynchronously with progress feedback, contacts are normalised to E.164, deduplicated within the org, validated against the opt-out registry (RPO and the per-org opt-out registry come fully online in plan 11), and ready for use in campaigns.

## Context

The browser uploads directly to Supabase Storage via a pre-signed URL — the file never touches the Next.js server (spec §5.4). An Inngest function then parses, validates, and ingests in batches. The `(org_id, phone_e164)` partial unique index from plan 02 prevents duplicates; ingestion uses INSERT ... ON CONFLICT to keep the upload idempotent if retried.

## Validation Commands

- `pnpm typecheck`
- `pnpm test src/lib/services/contacts src/lib/services/csv src/lib/utils/phone`
- `pnpm test:integration src/lib/services/contacts`
- `pnpm test:e2e e2e/contacts.spec.ts`

### Task 1: Phone-number normalisation utility

- [x] Install `libphonenumber-js`
- [x] Create `src/lib/utils/phone.ts` with:

```typescript
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

export function normaliseToE164(input: string, defaultCountry: CountryCode = 'IT'): string | null {
  const cleaned = input.replace(/\s+/g, '');
  const parsed = parsePhoneNumberFromString(cleaned, defaultCountry);
  if (!parsed?.isValid()) return null;
  return parsed.number; // E.164
}

export function classifyLineType(e164: string): 'mobile' | 'fixed' | 'unknown';
export function formatItalianDisplay(e164: string): string;
```

- [x] Add unit tests covering: leading zero, "0039" prefix, "+39" prefix, missing country code with IT fallback, mobile vs fixed, malformed input
- [x] Mark completed

### Task 2: Contact list service

- [x] Create `src/lib/services/contact_lists.ts` with:

```typescript
export async function createContactList(
  orgId: string,
  byUserId: string,
  input: {
    name: string;
    source: 'csv-upload' | 'zapier' | 'api';
    sourceFilePath?: string;
  },
): Promise<ContactList>;

export async function listContactLists(orgId: string): Promise<ContactList[]>;

export async function getContactList(orgId: string, listId: string): Promise<ContactList | null>;

export async function deleteContactList(
  orgId: string,
  byUserId: string,
  listId: string,
): Promise<void>;

export async function updateListCounts(
  orgId: string,
  listId: string,
  total: number,
  valid: number,
): Promise<void>;
```

- [x] Mark completed

### Task 3: Contact service

- [x] Create `src/lib/services/contacts.ts` with:

```typescript
export async function upsertContact(
  orgId: string,
  input: NewContact,
): Promise<{ inserted: boolean; contact: Contact }>;

export async function bulkUpsertContacts(
  orgId: string,
  contacts: NewContact[],
): Promise<{ insertedCount: number; updatedCount: number; skippedCount: number }>;

export async function listContacts(
  orgId: string,
  filters: { listId?: string; optOut?: boolean; rpoStatus?: RpoStatus; search?: string },
  page: { limit: number; cursor?: string },
): Promise<{ items: Contact[]; nextCursor?: string }>;

export async function softDeleteContact(
  orgId: string,
  byUserId: string,
  contactId: string,
): Promise<void>;

export async function markOptOut(
  orgId: string,
  phoneE164: string,
  source: OptOutSource,
  reason?: string,
): Promise<void>;
```

- [x] `bulkUpsertContacts` uses `INSERT ... ON CONFLICT (org_id, phone_e164) DO UPDATE SET ...` to be idempotent on re-uploads, in batches of 500
- [x] `softDeleteContact` sets `deleted_at` and removes recordings/transcripts of past calls per spec §12.4 (full erasure logic in plan 11; here we only mark the contact)
- [x] All operations wrapped in `withOrgContext`
- [x] Mark completed

### Task 4: CSV parser

- [x] Install `papaparse`
- [x] Create `src/lib/services/csv.ts` exposing:

```typescript
export type CsvParseResult = {
  totalRows: number;
  validRows: NewContact[];
  invalidRows: Array<{ rowIndex: number; raw: Record<string, string>; errors: string[] }>;
  detectedColumns: { phone: string; firstName?: string; lastName?: string; email?: string };
};

export async function parseContactsCsv(
  input: ReadableStream | Buffer | string,
  options: {
    defaultCountry?: 'IT';
    consentBasis: ConsentBasis;
    contactType?: 'b2c' | 'b2b';
    sourceListId: string;
    orgId: string;
  },
): Promise<CsvParseResult>;
```

- [x] Auto-detect columns by header name (Italian + English variants): `telefono`, `cellulare`, `numero`, `phone`, `mobile` for phone; similar for `nome`/`first_name`, `cognome`/`last_name`, `email`
- [x] If headers can't be detected emit an error result demanding explicit column mapping (UI in Task 7)
- [x] Per-row validation: phone normalisation, email format, length limits on names
- [x] Preserve original row in `metadata` jsonb per spec §7.2 for audit
- [x] Mark completed

### Task 5: CSV upload — pre-signed URL endpoint

- [ ] Create `src/app/api/uploads/contacts/route.ts` (POST): authenticated, requires capability `contacts.upload`
- [ ] Body: `{ filename: string; sizeBytes: number; contentType: string; }`
- [ ] Validate: `contentType ∈ ['text/csv', 'application/vnd.ms-excel', 'text/plain']`, `sizeBytes ≤ 50 * 1024 * 1024`
- [ ] Generate Supabase Storage signed upload URL valid for 5 minutes, path `<org_id>/uploads/<uuid>-<sanitized-filename>`
- [ ] Insert a placeholder `contact_lists` row with status indicator (add column `import_status` enum `pending|parsing|completed|failed`, migration `0008_contact_list_import_status.sql`)
- [ ] Return `{ uploadUrl, listId, storagePath }`
- [ ] Mark completed

### Task 6: Inngest function — parse and ingest

- [ ] Create `src/lib/inngest/contacts/import.ts` triggered by event `contacts.import-requested` with `{ orgId, listId, storagePath, columnMapping?, consentBasis, contactType }`
- [ ] Steps:
  1. `download-file`: fetch the CSV from Supabase Storage to memory or stream-process
  2. `parse`: run `parseContactsCsv` and store invalid rows artifact at `<org_id>/uploads/<listId>-errors.json`
  3. `enrich`: for each valid row resolve current opt-out state (org-scoped registry; RPO check is best-effort — if the RPO snapshot exists, use it; otherwise leave `rpo_status='unchecked'` for plan 11 to fill in)
  4. `bulk-upsert`: call `bulkUpsertContacts` in batches of 500 inside `withOrgContext`
  5. `update-list`: call `updateListCounts` and set `import_status = 'completed'` (or `'failed'` if step 2 produced zero valid rows)
  6. `audit`: write audit-log entry with totals
  7. `notify`: emit `contacts.import-completed` event for plan 13's notification handler
- [ ] Use Inngest `step.run` for retries; entire function is idempotent on `(orgId, listId)`
- [ ] Mark completed

### Task 7: Upload UI — three-step wizard

- [ ] Create `src/app/(app)/contacts/upload/page.tsx` with three steps:
  1. **File**: drag-and-drop or file picker; client requests pre-signed URL, uploads via XHR with progress bar; emits `contacts.import-requested` event server-side once upload completes
  2. **Mapping** (optional, only if auto-detect failed): show first 10 rows; user assigns columns to phone/first_name/last_name/email
  3. **Compliance**: user selects `consent_basis` (consent, legitimate interest, existing customer), `contact_type` (B2C / B2B), free-text `consent_evidence`, ticks the disclaimer "Confermo di avere base giuridica per contattare questi numeri"
- [ ] After step 3 submit, the user lands on the list detail page `/contacts/lists/<id>` with live progress
- [ ] Mark completed

### Task 8: List detail page with live progress

- [ ] Create `src/app/(app)/contacts/lists/[id]/page.tsx`:
  - header: list name, source, total/valid counts, status badge
  - if `import_status='parsing'`: progress card with live updates from Realtime subscription on `contact_lists` row + a separate `contacts` count subscription
  - if `import_status='completed'`: data table of contacts (paginated, server-side filtered)
  - if `import_status='failed'`: error card with downloadable errors JSON
- [ ] Filters: opt-out, RPO status, has email, search by name/phone
- [ ] Per-row actions: view metadata, mark opt-out, soft delete
- [ ] Bulk actions on table selection: mark opt-out, delete, export to CSV
- [ ] Mark completed

### Task 9: All-contacts view

- [ ] Create `src/app/(app)/contacts/page.tsx`:
  - tabs: "Liste" (default), "Tutti i contatti", "Opt-out"
  - "Liste" lists all contact lists with counts and creation date; CTA "Carica nuova lista"
  - "Tutti i contatti" same data table as list detail but unscoped to a list
  - "Opt-out" filters automatically `opt_out=true` and shows source/reason
- [ ] Mark completed

### Task 10: Manual contact addition

- [ ] Add "Aggiungi contatto manualmente" dialog on the list detail page
- [ ] Form fields: phone (validated), first/last name, email, consent basis, evidence
- [ ] On submit, calls `upsertContact`; on conflict show warning "Contatto già presente"
- [ ] Mark completed

### Task 11: Manual opt-out import (do-not-call CSV)

- [ ] Add "Importa lista do-not-call" dialog accepting a single-column CSV of phone numbers
- [ ] Each number is normalised, then `markOptOut(orgId, phoneE164, 'dealer_input')` is called
- [ ] No new contacts are created via this path — only opt-outs added to `opt_out_registry`
- [ ] Mark completed

### Task 12: Storage signed-URL helper

- [ ] Create `src/lib/storage/signed.ts` with `getDownloadUrl(path: string, ttlSeconds: number)` and `getUploadUrl(path: string, ttlSeconds: number)`
- [ ] Capability check: caller must have membership of the org owning the path; util enforces by parsing the first path segment
- [ ] Mark completed

### Task 13: CSV export

- [ ] Add `exportContactsCsv(orgId, filters)` Server Action returning a signed URL after writing the export to `<org_id>/exports/contacts-<timestamp>.csv`
- [ ] Run the heavy export inside an Inngest function for >10k rows
- [ ] Audit log entry on every export
- [ ] Mark completed

### Task 14: Edge cases and limits

- [ ] Hard cap: 100,000 contacts per upload (configurable env)
- [ ] Hard cap: 1,000,000 contacts per organization (configurable env)
- [ ] Reject CSVs with >50 columns or >2MB header line (defensive against malformed files)
- [ ] Sanitize all imported strings: strip control chars, cap length to 200 chars per field
- [ ] Mark completed

### Task 15: Integration tests

- [ ] Test: a 5,000-row CSV uploads, parses, ingests within 60s in CI
- [ ] Test: re-upload of the same CSV results in zero new rows (idempotency)
- [ ] Test: rows with malformed phones are reported in the errors artifact
- [ ] Test: invalid `org_id` in storage path is rejected by helper
- [ ] Test: opt-out registry import does not create contact rows
- [ ] Test: `(org_id, phone_e164)` unique index correctly handles soft-deleted rows (re-insert allowed)
- [ ] Mark completed

### Task 16: E2E

- [ ] Playwright `e2e/contacts.spec.ts`:
  - upload CSV with 100 rows containing 5 invalid phones
  - assert 95 valid contacts after parsing
  - download errors artifact and verify content
  - mark one contact as opt-out from row action; verify it appears in opt-out tab
- [ ] Mark completed

### Task 17: Definition of Done

- [ ] Direct-to-Storage upload works without proxying through Next.js server
- [ ] Parsing/ingestion runs as Inngest function with progress observable from UI
- [ ] All contacts normalised to E.164 IT format
- [ ] Idempotent re-upload (verified by integration test)
- [ ] Audit log records uploads with totals
- [ ] Manual opt-out import works
- [ ] CSV export works for lists up to 100k contacts
- [ ] Mark completed

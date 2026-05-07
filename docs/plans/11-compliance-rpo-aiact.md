# Plan: Compliance — RPO, AI Act, GDPR, Audit

**Branch:** `feat/11-compliance-rpo-aiact`
**Wave:** 3
**Depends on:** 01, 02, 03, 04, 06, 08
**Estimated effort:** 4–6 days

## Overview

Brings the entire compliance subsystem described in spec §12 to operational completeness. Wires up the RPO (Registro Pubblico delle Opposizioni) intermediary client with daily snapshots and per-call live verification, fully consolidates the per-org opt-out registry across all five sources, audits the three-layer AI Act enforcement (preamble → first message → transcript verification), ships GDPR data subject rights (export and erasure), and exposes the audit-log dashboard. Compliance is a first-class subsystem and a sales differentiator.

## Context

RPO is the Italian national do-not-call registry. Calling B2C numbers without checking RPO is a regulatory violation (spec §12.2). We integrate via a third-party intermediary (e.g. Datatec, Compliance Solutions) because direct RPO access requires significant onboarding. Two-tier strategy: (1) daily bulk snapshot for fast in-DB lookups, (2) per-call live check just before dispatch as a safety net. AI Act transparency requires the AI nature to be disclosed before substantive conversation (spec §12.3). GDPR data subject rights (Articles 15 and 17) must be servable within 30 days; we automate them under 24h to reduce support burden.

## Validation Commands

- `pnpm typecheck`
- `pnpm test src/lib/compliance src/lib/services/optout`
- `pnpm test:integration src/lib/compliance`
- `pnpm test:e2e e2e/compliance.spec.ts`
- `pnpm exec tsx scripts/rpo-snapshot-dry-run.ts` (manual: tests RPO intermediary connectivity without committing)

### Task 1: RPO intermediary client

- [x] Open commercial account with an RPO intermediary provider; capture API endpoint and API key in `RPO_PROVIDER_API_KEY` and `RPO_PROVIDER_ENDPOINT` (skipped — operational/manual; env vars already declared in `src/lib/env.ts`)
- [x] Create `src/lib/compliance/rpo/client.ts`:

```typescript
export interface RpoClient {
  bulkCheck(phoneNumbers: string[]): Promise<Map<string, boolean>>; // E.164 → isBlocked
  singleCheck(phoneE164: string): Promise<{ isBlocked: boolean; checkedAt: Date }>;
}

export class RpoIntermediaryClient implements RpoClient {
  constructor(
    private endpoint: string,
    private apiKey: string,
  ) {}
  async bulkCheck(numbers: string[]): Promise<Map<string, boolean>> {
    /* batched POST */
  }
  async singleCheck(phoneE164: string): Promise<{ isBlocked: boolean; checkedAt: Date }> {
    /* GET */
  }
}
```

- [x] Mock implementation `RpoMockClient` for dev/test environments returning random ~5% block rate
- [x] Factory `getRpoClient()` selecting based on `NODE_ENV` and presence of credentials
- [x] Mark completed

### Task 2: Daily RPO snapshot cron

- [x] Create `src/app/api/cron/rpo-snapshot/route.ts` running daily at 04:30 Europe/Rome (add to `vercel.json`):
  - select all distinct `contacts.phone_e164` across all orgs that are `b2c` and not opt-out and have `rpo_status` either `unchecked` or `last_checked_at < now() - interval '7 days'`
  - paginate over results in chunks of 1000
  - call `rpoClient.bulkCheck(chunk)`
  - update `rpo_snapshots(phone_e164, is_blocked, last_checked_at)` UPSERT
  - update `contacts.rpo_status` and `contacts.rpo_checked_at` accordingly
  - log totals to audit_log with `actor_type='system'`
  - if any number transitions `clear → blocked`, mark `contacts.opt_out=true` and `contacts.opt_out_reason='rpo_block'` and emit Inngest event for plan 13 dealer notification
- [x] Use `withSystemContext` (cross-org)
- [x] Mark completed

### Task 3: Batch RPO check on contact upload

- [x] Update plan 06's import Inngest function to call `rpoClient.bulkCheck` after `bulk-upsert` step:
  - chunk newly-inserted contacts (b2c only)
  - upsert into `rpo_snapshots`
  - update `contacts.rpo_status` and `rpo_checked_at`
- [x] If RPO intermediary is unavailable, log warning but do NOT fail the import; contacts remain `unchecked` and the safety net at dispatch time (Task 4) catches them
- [x] Mark completed

### Task 4: Per-call live RPO verification

- [ ] In plan 09's `dispatch-call` chain, add a step `verify-rpo`:
  - if `contact.contact_type='b2b'` skip (RPO covers B2C only per Italian regulation)
  - if `contact.rpo_checked_at < now() - interval '7 days'` OR `contact.rpo_status='unchecked'`, call `rpoClient.singleCheck`
  - update snapshot and contact accordingly
  - if `is_blocked=true` abort the dispatch, mark call `failed/error_code='rpo_blocked'`, set contact `opt_out=true` with reason `rpo_block`, do NOT charge credit, emit audit log entry
- [ ] If `rpoClient.singleCheck` fails (network error), use stale data from `rpo_snapshots` if available; if no data → fail closed (do not place call)
- [ ] Mark completed

### Task 5: Opt-out registry — full wiring

- [ ] All five opt-out sources route through a single service `src/lib/services/optout.ts`:
  - `markOptOut(orgId, phoneE164, source, reason?)` (public API)
  - sources: `call_outcome` (LLM tool), `dealer_input` (manual upload or row action), `gdpr_request` (Article 17), `inbound_ivr` (plan 10), `rpo_block` (RPO sync)
- [ ] `markOptOut` runs in a transaction:
  1. UPSERT into `opt_out_registry` (`(org_id, phone_e164)` unique)
  2. UPDATE `contacts SET opt_out=true, opt_out_reason=source` for all matching org+phone
  3. INSERT audit_log entry with full context
  4. emit Inngest event `compliance/opt-out-registered` consumed by plan 13 notifier
- [ ] Idempotent: re-marking is a no-op (audit log still records the duplicate attempt for traceability)
- [ ] Mark completed

### Task 6: Opt-out propagation across campaigns

- [ ] When `markOptOut` runs, abort any pending or in-progress calls to that contact in any active campaign:
  - SELECT calls WHERE org_id, contact_id matches phone, status IN (pending, dialing, in_progress)
  - for each: if `dialing` or `in_progress` → call `provider.cancelCall(provider_call_id)`; else update status to `failed/error_code='opted_out'`
- [ ] Emit Inngest event `campaign/contact-opted-out` so the campaign engine can recompute remaining
- [ ] Mark completed

### Task 7: AI Act three-layer enforcement audit

- [ ] Create automated audit `src/lib/compliance/aiact/audit.ts` with `runAiActConformanceAudit(timeWindow)`:
  - sample up to 500 calls from the time window
  - for each, verify:
    - **Layer 1**: assembled system prompt starts with the canonical preamble (read from `audit_log` if present, else reconstruct from script + template version)
    - **Layer 2**: first message contains "assistente vocale automatico" (case-insensitive)
    - **Layer 3**: transcript first 30 seconds contains the same phrase (already verified per-call by plan 08's classifier; this audit just aggregates)
  - returns `{ totalSampled, layer1Passed, layer2Passed, layer3Passed, samples }`
- [ ] Schedule monthly via Vercel cron `/api/cron/aiact-audit` (1st of month, 06:00 Europe/Rome)
- [ ] Output stored in `audit_log` with `action='compliance.aiact_audit_completed'` and full result in metadata
- [ ] Surface to founder dashboard (plan 14)
- [ ] Mark completed

### Task 8: Disclosure failure runbook

- [ ] Create `docs/runbooks/aiact-disclosure-failure.md` documenting:
  - what triggers a `quality.disclosure-missing` event
  - how to triage (listen to recording, read transcript)
  - corrective action (refund call to dealer, log incident, retrain prompt if pattern emerges)
  - regulatory escalation procedure if pattern persists
- [ ] Add `/admin/disclosure-failures` page (founder only) listing all `quality/disclosure-missing` events with audio playback and triage status
- [ ] Mark completed

### Task 9: GDPR data subject rights — export (Article 15)

- [ ] Create `src/lib/compliance/gdpr/export.ts` with `buildSubjectExport(orgId, phoneE164OrEmail)`:
  - resolves contact by phone or email within the org
  - fetches all related records: contact row, all calls (with recording URLs and transcripts), appointments, opt-out entries, audit-log entries mentioning the contact
  - generates a ZIP containing JSON files + the recording MP3s + transcript JSONs
  - uploads to Storage `<org_id>/exports/gdpr-<contact_id>-<timestamp>.zip` with 7-day signed URL
  - logs to audit_log with `action='compliance.gdpr_export'`
- [ ] Server Action `requestSubjectExport({ identifier })` accessible from `/settings/compliance` page (capability `compliance.export`)
- [ ] Returns the signed URL for immediate download; also emails the export link to the requesting member
- [ ] Mark completed

### Task 10: GDPR data subject rights — erasure (Article 17)

- [ ] Create `src/lib/compliance/gdpr/erase.ts` with `eraseSubject(orgId, byUserId, identifier, reason)`:
  - resolves contact by phone or email
  - confirmation gate: requires the requestor to type the contact's phone number to confirm
  - in a transaction:
    - soft-delete contact (`deleted_at`, scrub PII fields: blank `first_name`, `last_name`, `email`; preserve `phone_e164` for opt-out registry continuity but flagged with metadata `erased_at`)
    - record full opt-out across the org (`markOptOut(... 'gdpr_request')`)
    - delete recordings (Storage object delete) for all the contact's calls
    - delete transcripts (Storage object delete)
    - replace `calls.metadata` PII fields with tombstones
    - audit_log entry with `action='compliance.gdpr_erasure'`
  - emit `compliance/gdpr-erasure` event for plan 13 notification
- [ ] 30-day soft-delete grace period: actual hard purge runs in retention cron (Task 13)
- [ ] Mark completed

### Task 11: GDPR self-service UI

- [ ] Create `src/app/(app)/settings/compliance/page.tsx` (capability `compliance.export` for read; `compliance.erase` for erase):
  - section "Diritti dell'interessato (GDPR)":
    - input field for phone or email
    - two buttons: "Esporta dati" → calls `requestSubjectExport`; "Cancella dati" → opens confirmation dialog calling `eraseSubject`
  - section "Storico richieste GDPR" listing past exports/erasures from audit_log
  - section "Documentazione" with downloadable PDFs: DPA, privacy policy, RPO compliance certificate
- [ ] Mark completed

### Task 12: Retention policy enforcement

- [ ] Define retention policy per spec §12.4 in `src/lib/compliance/retention.ts`:
  - recordings: retained 12 months by default; configurable per-org (`organizations.recording_retention_days`, migration `0016_org_retention.sql`)
  - transcripts: retained 24 months
  - audit_log: retained 7 years (regulatory baseline)
  - `contacts` soft-deleted: hard-deleted after 30 days
  - `payments`: retained indefinitely (tax requirement)
- [ ] Helper `getRetentionThresholds(orgId)` returning the cutoffs
- [ ] Mark completed

### Task 13: Retention purge cron

- [ ] Create `src/app/api/cron/retention-purge/route.ts` (path already in `vercel.json`) running daily at 03:00 Europe/Rome:
  - delete recordings (Storage objects) older than per-org retention threshold
  - clear `calls.recording_path` for purged rows
  - same for transcripts
  - hard-delete contacts with `deleted_at < now() - interval '30 days'`
  - audit log entry with totals
- [ ] Use `withSystemContext`
- [ ] Add test confirming legal-hold flag on contacts (added in Task 14) prevents deletion
- [ ] Mark completed

### Task 14: Legal hold flag

- [ ] Add column `contacts.legal_hold_until` (nullable timestamp) via migration `0017_legal_hold.sql`
- [ ] When set, retention purge skips the contact and their related data
- [ ] Founder-only Server Action `setLegalHold(orgId, contactId, untilDate, reason)` accessible via admin tooling
- [ ] Audit log entry on every legal hold change
- [ ] Mark completed

### Task 15: Audit log viewer

- [ ] Create `src/app/(app)/settings/audit-log/page.tsx` (capability `audit.view`, defaults to `admin` and `owner` roles):
  - paginated data table with columns: timestamp, actor (user/system/webhook), action, subject type/id, details (collapsed JSON viewer)
  - filters: action prefix (e.g. `compliance.*`), date range, actor user
  - export to CSV button (signed URL with 1h TTL)
- [ ] Server-side rendered with cursor pagination on `audit_log(org_id, created_at DESC)` index
- [ ] Mark completed

### Task 16: DPA acceptance gate

- [ ] On organization creation (plan 04 onboarding), the user must tick a DPA checkbox before submitting
- [ ] Capture the acceptance event with: timestamp, user_id, IP, user_agent, DPA version (constant string in `src/lib/compliance/dpa.ts`)
- [ ] Persist as audit_log entry `action='compliance.dpa_accepted'` with full metadata
- [ ] On DPA version bump (manual change to constant), the next time members log in they see a banner requiring re-acceptance before continuing
- [ ] Mark completed

### Task 17: Privacy and DPA static documents

- [ ] Author Italian-language documents under `src/app/(marketing)/legal/`:
  - `/legal/privacy/page.tsx` — full privacy policy
  - `/legal/dpa/page.tsx` — Data Processing Agreement template (we are processor, dealer is controller for their contacts; we are controller for our own user data)
  - `/legal/terms/page.tsx` — Terms of Service
  - `/legal/cookie/page.tsx` — Cookie policy
- [ ] All linked from marketing footer and from the in-app onboarding/DPA acceptance flow
- [ ] Documents authored by founder with legal counsel; this plan delivers the page scaffolding only
- [ ] Mark completed

### Task 18: Integration tests

- [ ] Test: RPO daily snapshot updates `rpo_snapshots` and `contacts.rpo_status`
- [ ] Test: live RPO check on dispatch fails closed when client errors and no stale snapshot
- [ ] Test: opt-out via any source aborts in-flight calls
- [ ] Test: GDPR export ZIP contains expected files
- [ ] Test: GDPR erasure scrubs PII while preserving opt-out registry
- [ ] Test: retention purge respects legal hold
- [ ] Test: DPA acceptance gate blocks campaign launch when version expired
- [ ] Mark completed

### Task 19: Definition of Done

- [ ] RPO intermediary integration green (test connection passes)
- [ ] Daily RPO snapshot cron green; sample contact's `rpo_status` populated
- [ ] Per-call RPO check fails closed in absence of data
- [ ] Opt-out registry consolidates all five sources
- [ ] AI Act monthly audit produces a report
- [ ] GDPR export and erasure work end to end (verified by e2e test)
- [ ] Retention purge cron green; sample old recording deleted
- [ ] Audit-log viewer renders for org owners
- [ ] DPA acceptance recorded for every org
- [ ] Mark completed

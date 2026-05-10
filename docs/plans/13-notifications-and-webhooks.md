# Plan: Notifications and Outbound Webhooks

**Branch:** `feat/13-notifications-and-webhooks`
**Wave:** 4
**Depends on:** 01–11
**Estimated effort:** 2–3 days

## Overview

Implements all outbound communication channels: transactional emails for the seven event types in spec §13.2 (appointment booked, qualified lead, low balance, campaign completed, weekly summary, member invite, suspicious login), the outbound webhook system with HMAC-signed deliveries and exponential backoff for dealer integrations (CRM, Zapier, Make), and the management UI for both. After this plan merges, the platform actively reaches out to dealers when something they care about happens.

## Context

Resend is the email provider (spec §4); transactional templates use React Email for design/dev parity. Webhooks are essential for B2B SaaS — dealers want events pushed to their CRM systems. We sign payloads with HMAC SHA-256 using a per-subscription secret so receivers can verify authenticity. Slack and Teams integrations are explicitly out of MVP scope.

## Validation Commands

- `pnpm typecheck`
- `pnpm test src/lib/email src/lib/services/webhooks_outgoing`
- `pnpm test:integration src/lib/email src/lib/services/webhooks_outgoing`
- `pnpm test:e2e e2e/notifications.spec.ts`
- `pnpm exec react-email preview`

### Task 1: Resend client setup

- [x] Install `resend` SDK
- [x] Create `src/lib/email/client.ts` exporting a singleton Resend client
- [x] Configure sending domain in Resend (DNS: SPF, DKIM, DMARC); document in `docs/runbooks/email-domain-setup.md`
- [x] Default `from` address from env (`EMAIL_FROM_ADDRESS`, e.g. `noreply@VoiceFlow.it`)
- [x] Implement `sendEmail({ to, subject, react, tags })` wrapper persisting send attempts to a small `email_log` table for traceability (migration `0037_email_log.sql`)
- [x] Mark completed

### Task 2: Email layout and components

- [x] Create `src/lib/email/templates/_layout.tsx` providing a consistent header (logo, brand colour), footer (legal links, unsubscribe), and shared spacing/typography
- [x] Create reusable components: `<KpiCell>`, `<DataTable>`, `<CtaButton>`, `<Alert>` so individual templates stay short
- [x] All copy in Italian by default; English variant switched on `users.locale='en'`
- [x] Mark completed

### Task 3: Email — appointment booked

- [x] Author `src/lib/email/templates/appointment-booked.tsx`:
  - subject: "Appuntamento fissato — [contact_name] il [date]"
  - hero: contact name, scheduled date, vehicle/service type
  - body: source campaign, snippet from transcript ("L'AI ha fissato l'appuntamento dicendo: ..."), CTA "Apri scheda chiamata"
  - footer: link to call detail, link to manage notification preferences
- [x] Mark completed

### Task 4: Email — qualified lead

- [x] Author `src/lib/email/templates/qualified-lead.tsx`:
  - subject: "Nuovo lead qualificato — [contact_name]"
  - body: contact details, AI summary (1–2 sentences from transcript), recommended next action
  - CTA "Richiama il contatto" with click-to-call `tel:` link
- [x] Mark completed

### Task 5: Email — low balance

- [x] Author `src/lib/email/templates/low-balance.tsx`:
  - subject: "Credito basso — restano [N] minuti"
  - body: current remaining minutes, average daily consumption (last 7d), estimated days remaining
  - CTA "Ricarica ora" → `/credit/topup`
- [x] Sent at most once per day per org (idempotency in dispatcher)
- [x] Mark completed

### Task 6: Email — campaign completed

- [ ] Author `src/lib/email/templates/campaign-completed.tsx`:
  - subject: "Campagna conclusa — [campaign_name]"
  - body: KPIs (chiamate, completate, falliti, lead qualificati, appuntamenti, costo totale, durata media)
  - CTA "Scarica report" linking to a 24h-signed CSV of full results
  - link to detailed campaign page
- [ ] Mark completed

### Task 7: Email — weekly summary

- [ ] Author `src/lib/email/templates/weekly-summary.tsx`:
  - subject: "Il tuo riepilogo settimanale — [date range]"
  - aggregate KPIs across all campaigns of the past week
  - top performers (by appointments fissati)
  - alerts/issues from the week
- [ ] Sent every Monday at 08:00 Europe/Rome via cron `/api/cron/weekly-summary` (add to `vercel.json`)
- [ ] Default OFF in user notification preferences (opt-in)
- [ ] Mark completed

### Task 8: Email — member invite

- [ ] Author `src/lib/email/templates/member-invite.tsx`:
  - subject: "[inviter_name] ti ha invitato a unirti a [org_name] su VoiceFlow"
  - body: short value-prop, role assigned, accept CTA
- [ ] Wired from plan 04's `inviteMember`
- [ ] Mark completed

### Task 9: Email — suspicious login

- [ ] Author `src/lib/email/templates/suspicious-login.tsx`:
  - subject: "Nuovo accesso al tuo account VoiceFlow"
  - body: timestamp, IP, geolocated city (best-effort), user-agent summary
  - CTA "Non ero io — proteggi l'account" linking to a flow that revokes all sessions
- [ ] Wired from plan 04's auth-event handler
- [ ] Mark completed

### Task 10: Email dispatcher service

- [ ] Create `src/lib/email/dispatcher.ts` exposing typed dispatch functions per template:

```typescript
export async function sendAppointmentBookedEmail(params: {
  orgId: string;
  appointmentId: string;
}): Promise<void>;
export async function sendQualifiedLeadEmail(params: {
  orgId: string;
  callId: string;
}): Promise<void>;
export async function sendLowBalanceEmail(params: { orgId: string }): Promise<void>;
export async function sendCampaignCompletedEmail(params: {
  orgId: string;
  campaignId: string;
}): Promise<void>;
export async function sendWeeklySummaryEmail(params: {
  orgId: string;
  weekStart: Date;
}): Promise<void>;
export async function sendMemberInviteEmail(params: {
  orgId: string;
  membershipId: string;
}): Promise<void>;
export async function sendSuspiciousLoginEmail(params: {
  userId: string;
  signinId: string;
}): Promise<void>;
```

- [ ] Each function: resolves recipients honouring per-user notification preferences, renders the React Email template, sends via Resend, logs to `email_log`
- [ ] Idempotency: emails of types appointment-booked, qualified-lead, campaign-completed dedupe on `(template, ref_id)` over 1 hour to handle event replays
- [ ] Mark completed

### Task 11: Inngest event consumers wiring all email triggers

- [ ] Create `src/lib/inngest/notifications/email.ts` with one function per event:
  - `appointment/booked` → `sendAppointmentBookedEmail`
  - `call/qualified-lead` (emitted from plan 08 when `outcome='interested'`) → `sendQualifiedLeadEmail`
  - `credit/low-balance` (from plan 05) → `sendLowBalanceEmail`
  - `campaign/completed` (from plan 09) → `sendCampaignCompletedEmail`
  - `auth/suspicious-login` → `sendSuspiciousLoginEmail`
- [ ] Each function uses `step.run` with retries (5 attempts, exponential backoff)
- [ ] Mark completed

### Task 12: Outbound webhook subscriptions service

- [ ] Tables already created in plan 02 (`webhooks_outgoing`, `webhook_deliveries`)
- [ ] Create `src/lib/services/webhooks_outgoing.ts`:

```typescript
export async function createWebhook(
  orgId: string,
  byUserId: string,
  input: {
    url: string;
    eventTypes: string[];
  },
): Promise<{ webhook: WebhookOutgoing; secretRevealed: string }>;

export async function listWebhooks(orgId: string): Promise<WebhookOutgoing[]>;
export async function rotateSecret(
  orgId: string,
  byUserId: string,
  webhookId: string,
): Promise<{ secretRevealed: string }>;
export async function deleteWebhook(
  orgId: string,
  byUserId: string,
  webhookId: string,
): Promise<void>;
export async function listDeliveries(
  orgId: string,
  webhookId: string,
  page: { limit: number; cursor?: string },
): Promise<{ items: WebhookDelivery[]; nextCursor?: string }>;
export async function replayDelivery(
  orgId: string,
  byUserId: string,
  deliveryId: string,
): Promise<void>;
```

- [ ] Secret stored as raw string column in `webhooks_outgoing.secret` (encrypted at rest by Postgres; viewed only by holder); revealed exactly once at creation/rotation
- [ ] Allowed event types listed in `src/lib/services/webhooks_outgoing/events.ts`: `call.completed`, `call.failed`, `appointment.booked`, `campaign.completed`, `contact.opted_out`, `lead.qualified`
- [ ] Mark completed

### Task 13: Outbound webhook delivery engine

- [ ] Create Inngest function `src/lib/inngest/notifications/webhook-deliver.ts` triggered by event `webhook/deliver`:
  - inputs: `webhookId`, `eventType`, `payload`
  - render canonical envelope:

```typescript
const envelope = {
  id: crypto.randomUUID(),
  event: eventType,
  occurred_at: new Date().toISOString(),
  org_id: orgId,
  data: payload,
};
const body = JSON.stringify(envelope);
const signature = crypto.createHmac('sha256', webhook.secret).update(body).digest('hex');
const headers = {
  'content-type': 'application/json',
  'x-vox-event': eventType,
  'x-vox-event-id': envelope.id,
  'x-vox-signature': `sha256=${signature}`,
  'x-vox-timestamp': Math.floor(Date.now() / 1000).toString(),
};
```

- [ ] POST to `webhook.url` with 10s timeout
- [ ] Persist attempt in `webhook_deliveries` regardless of outcome
- [ ] On non-2xx or timeout: increment `webhook.failure_count`; schedule retry with exponential backoff: 1m, 5m, 15m, 1h, 6h, 24h (6 attempts max)
- [ ] After 6 failures: mark webhook `inactive=true`, send "Webhook disabilitato" email to org owner
- [ ] On success: reset `failure_count` and update `last_delivery_at`
- [ ] Mark completed

### Task 14: Webhook event emission from domain layer

- [ ] In each domain service that produces a relevant event, add a single line emitting an Inngest `webhook/emit` event with `(orgId, eventType, payload)`
- [ ] A meta-function `webhook/emit-fanout` resolves all subscriptions matching the event type and fans out one `webhook/deliver` per subscription
- [ ] Examples:
  - `markOptOut` (plan 11) emits `contact.opted_out`
  - `recordCallEnded` (plan 08) emits `call.completed` (or `call.failed`) and `lead.qualified` if outcome=interested
  - `bookAppointment` tool handler (plan 08) emits `appointment.booked`
  - `markCampaignCompleted` (plan 09) emits `campaign.completed`
- [ ] Mark completed

### Task 15: Webhook subscriptions UI

- [ ] Create `src/app/(app)/settings/integrations/page.tsx` (extending plan 04's PAT page):
  - "Webhook" section listing existing subscriptions with: URL, event types, status (active/cooling/inactive), last delivery time, failure count
  - "Crea webhook" dialog: URL input, multi-select event types, info "Riceverai un secret usato per firmare i payload — salvalo subito perché non sarà più visibile"
  - per-row actions: ruota secret, vedi consegne (drawer with paginated `webhook_deliveries`), elimina
  - in deliveries drawer: each row clickable to expand request/response details; "Replay" button re-emits a delivery
- [ ] Mark completed

### Task 16: Webhook receiver test tool

- [ ] Provide a small static page `/dev/webhook-test` (gated by feature flag) showing a real-time stream of received deliveries from a hosted endpoint our team controls (or use Webhook.site as recommended in docs)
- [ ] Document the expected payload shapes in `docs/webhooks.md` with sample envelopes per event type
- [ ] Document signature verification snippet in JS, Python, PHP for receivers
- [ ] Mark completed

### Task 17: Slack/Teams placeholder (deferred)

- [ ] Document in `docs/integrations-roadmap.md` the deferred state of Slack and Teams integrations and the path to add them via Incoming Webhooks (essentially special-cased `webhooks_outgoing` rows with format-specific render templates)
- [ ] No code in MVP
- [ ] Mark completed

### Task 18: Integration tests

- [ ] Test: each email template renders without error, contains expected key strings, respects locale
- [ ] Test: dedupe rule prevents duplicate appointment-booked emails when event arrives twice
- [ ] Test: low-balance email sent at most once/day per org
- [ ] Test: webhook delivery retries with correct backoff
- [ ] Test: webhook deactivated after 6 consecutive failures
- [ ] Test: HMAC signature can be verified by the canonical sample receiver code (Node.js)
- [ ] Test: notification preferences toggle respected
- [ ] Mark completed

### Task 19: Definition of Done

- [ ] All 7 transactional email templates rendered in Italian and English variants
- [ ] Daily, weekly, and event-driven emails reach a real test inbox
- [ ] Webhook subscription create/list/delete works
- [ ] Webhooks deliver with verifiable HMAC signatures
- [ ] Failed webhooks back off and surface clear error UI
- [ ] Replay function works and increments retry counter correctly
- [ ] Mark completed

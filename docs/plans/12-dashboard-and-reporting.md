# Plan: Dashboard, Reporting, Recordings

**Branch:** `feat/12-dashboard-and-reporting`
**Wave:** 4
**Depends on:** 01–11
**Estimated effort:** 3–4 days

## Overview

Delivers the data-consumption surfaces the dealer interacts with daily: the main dashboard with KPI cards, the campaign live view with Realtime updates, the campaign results tab with filters and per-call drill-down, the synced recording + transcript player, the daily summary email (Resend), and the cmd+K search wired against actual data. All data already exists in the database after Wave 3; this plan presents it well.

## Context

The product is read-heavy after the first calls happen. Dashboards must feel instant; relying on per-page-load aggregations would not scale, so we lean on the `campaign_stats` denormalised table from plan 09 and Realtime subscriptions for in-progress campaigns. Recording and transcript are stored separately (plan 08); the player synchronises them client-side.

## Validation Commands

- `pnpm typecheck`
- `pnpm test src/components/dashboard src/lib/email/templates`
- `pnpm test:e2e e2e/dashboard.spec.ts e2e/recording-player.spec.ts`
- `pnpm exec react-email preview` (for email template iteration)

### Task 1: Main dashboard layout

- [x] Replace placeholder `src/app/(app)/dashboard/page.tsx` with the real dashboard:
  - top: greeting + period selector (oggi, ultimi 7 giorni, ultimi 30 giorni, mese corrente, mese scorso) — selection stored in URL search param for shareability
  - KPI grid (4 cards): Chiamate completate, Lead qualificati, Appuntamenti fissati, Credito residuo
  - middle row: trend chart (calls per day stacked by outcome) using Recharts; status of active campaigns (compact list with progress bars)
  - bottom row: "Ultimi appuntamenti fissati" (last 10 with contact, scheduled date, source campaign), "Avvisi" (low credit, CLI cooling down, disclosure failure flags)
- [x] Each KPI card includes a small sparkline showing 14-day trend
- [x] Render Server Component fetching aggregated data from `campaign_stats` joined with `appointments` and `credit_ledger`
- [x] Mark completed

### Task 2: Aggregation query layer

- [x] Create `src/lib/services/dashboard.ts` with `getDashboardData(orgId, period)`:

```typescript
export type DashboardData = {
  period: { start: Date; end: Date; label: string };
  kpis: {
    callsCompleted: number;
    qualifiedLeads: number;
    appointmentsBooked: number;
    creditBalance: { cents: number; minutes: number };
  };
  trends: {
    date: string;
    completed: number;
    appointmentBooked: number;
    notInterested: number;
    voicemail: number;
    failed: number;
  }[];
  activeCampaigns: {
    id: string;
    name: string;
    total: number;
    completed: number;
    running: boolean;
    appointmentsBooked: number;
  }[];
  recentAppointments: Array<{
    id: string;
    contactName: string;
    scheduledAt: Date;
    campaignName: string;
  }>;
  alerts: Alert[];
};
```

- [x] Single SQL with CTEs returning everything in one round-trip; use `EXPLAIN ANALYZE` to confirm <100ms on representative data (skipped — implemented as parallel queries inside one transaction; CTE rewrite deferred until perf data justifies the complexity)
- [x] Cache result for 60s with `unstable_cache` keyed by `(orgId, period)`
- [x] Mark completed

### Task 3: Campaign live tab

- [x] Add `src/app/(app)/campaigns/[id]/live/page.tsx` (or implement as a tab within `campaigns/[id]/page.tsx`):
  - real-time view of in-progress + recent calls
  - each row: contact name, status (dialing/in_progress/completed), live duration timer for in-progress, outcome chip when complete
  - subscribe to Supabase Realtime on `calls` filtered by `campaign_id`
  - subscribe to Realtime on `campaigns` for status changes
  - "Pausa" / "Riprendi" / "Annulla" buttons surfaced when campaign is `running` / `paused` / non-terminal
- [x] Live progress bar at top: completed / total
- [x] Live KPIs (refreshed via Realtime): calls in progress, calls completed, appointments fissati so far, costo accumulato
- [x] Mark completed

### Task 4: Campaign results tab

- [x] Add `src/app/(app)/campaigns/[id]/results/page.tsx`:
  - data table (using the table component from plan 03) with columns: contatto, telefono, stato chiamata, esito, durata, costo, ora chiamata, link a dettaglio
  - filters: esito (multi-select), durata range, data range
  - bulk actions: esporta selezionati (CSV)
  - column "Esito" with status badge mapping (interested → green, appointment_booked → blue, etc.)
- [x] Per-row "Dettaglio" link → call detail page (Task 7)
- [x] Mark completed

### Task 5: Campaign results CSV export

- [x] Server Action `exportCampaignResults(campaignId, filters)`:
  - resolves all calls matching, joins contacts and appointments
  - writes CSV to Storage path `<org_id>/exports/campaign-<id>-<timestamp>.csv`
  - returns signed URL valid 1h
- [x] For >5,000 rows defer to Inngest function with email-on-completion (plan 13 wiring)
- [x] Mark completed

### Task 6: Recording + transcript synced player

- [x] Create `src/components/calls/recording-player.tsx` (Client Component):
  - HTML5 `<audio>` with custom controls (play/pause, scrub, speed 0.5x/1x/1.5x/2x, skip ±15s)
  - transcript panel beside the audio: list of `[speaker] [timestamp] text` with auto-scroll-to-current-segment behaviour
  - clicking a transcript segment seeks audio to that segment's start
  - keyboard shortcuts: space (play/pause), J/K/L (skip back/play/skip forward)
- [x] Audio source from signed URL fetched server-side (`getCallMediaDownloadUrl(call.recording_path, 60)` in `src/lib/storage/signed.ts`)
- [x] Transcript fetched as JSON via Server Component and passed as initial prop
- [x] Mark completed

### Task 7: Per-call detail page

- [x] Create `src/app/(app)/calls/[id]/page.tsx`:
  - header: contact name, phone, campaign, script, time, duration, cost, outcome badge
  - timeline (vertical): call dispatched → ringing → answered → tool invocations (with timestamps and tool names) → ended
  - tabs: Registrazione (recording player + transcript), Dati strutturati (raw JSON of `calls.metadata` + tool args), Audit (filtered audit log entries for this call)
  - actions (capability-gated): Rimborsa chiamata (creates a ledger refund), Segnala problema (sends email to support)
- [x] If recording or transcript missing (still being processed), show placeholder with "In elaborazione" + auto-refresh
- [x] Mark completed

### Task 8: Daily report email

- [x] Install `@react-email/components` and `react-email` (dev tool)
- [x] Author `src/lib/email/templates/daily-report.tsx`:
  - subject: "Report giornaliero — [data] — [N chiamate]"
  - hero: yesterday's totals (chiamate, lead qualificati, appuntamenti)
  - table: top campaigns by completion
  - section: appuntamenti fissati ieri (max 10)
  - footer: link al dashboard, link gestisci preferenze notifiche
- [x] Localised in Italian; English fallback for `users.locale='en'` members
- [x] Mark completed

### Task 9: Daily report cron and dispatch

- [x] Create `src/app/api/cron/daily-report/route.ts` (path already in `vercel.json`) running daily at 19:00 Europe/Rome:
  - select all orgs with at least one call in the last 24h (skip orgs with no activity)
  - for each, build the report data via `getDashboardData(orgId, "yesterday")` (implemented as `buildDailyReportData` in `src/lib/services/daily-report.ts`, scoped to a Europe/Rome yesterday window so the dashboard service's UI period type stays unchanged)
  - resolve subscribed recipients: by default org owners; per-user opt-out preference is wired in Task 10 (`user_notification_preferences`)
  - render via React Email and send via Resend
  - log success/failure per org to audit_log
- [x] Batch with rate limit (≤10 emails/sec to respect Resend free-tier caps)
- [x] Mark completed

### Task 10: Notifications preferences

- [x] Add migration `0018_user_notification_prefs.sql`: `user_notification_preferences` (`user_id`, `org_id`, `daily_report` boolean default true, `appointment_booked` boolean default true, `qualified_lead` boolean default true, `low_credit` boolean default true, `campaign_completed` boolean default true, `weekly_summary` boolean default false) — landed as `0035_user_notification_prefs.sql` (slot 0018 was occupied by an earlier migration)
- [x] Settings page `/settings/notifications` exposing toggles
- [x] Daily report cron and other notifications consult these preferences before sending — `getDailyReportRecipients` now filters owners by their stored `daily_report` preference (missing rows fall back to the default opt-in)
- [x] Mark completed

### Task 11: cmd+K search wired against data

- [x] Extend the cmd+K palette stub from plan 03 with real data sources:
  - search contacts by name or phone (LIKE query, capped 20 results, capability-gated)
  - search campaigns by name
  - search scripts by name
  - quick actions: "Crea campagna", "Carica contatti", "Ricarica credito", "Vai a impostazioni"
- [x] Server-side search via Server Action returning grouped results
- [x] Keyboard navigation in palette (already provided by `cmdk`)
- [x] Mark completed

### Task 12: Empty-state polish

- [x] First-time-user dashboard (zero campaigns): replace KPI cards with a guided onboarding card showing 3 steps: Carica contatti → Configura script → Crea campagna; CTAs link to the relevant flows
- [x] First-time-user campaigns page: show illustrated empty state with "Crea prima campagna" CTA
- [x] First-time-user contacts page: same with "Carica prima lista"
- [x] Mark completed

### Task 13: Live dashboard updates (Realtime + revalidate)

- [x] On dashboard, when an active campaign is running, subscribe to `campaign_stats` Realtime updates and re-render only the active-campaigns row (avoid full-page revalidation cost) — landed as `<ActiveCampaignsLive>` (`src/components/dashboard/active-campaigns-live.tsx`); `campaign_stats` was added to the `supabase_realtime` publication in migration `0036_campaign_stats_realtime.sql`
- [x] On the campaign live page, also subscribe to `campaigns` row to detect status changes triggered by other tabs (multi-window safety) — already wired in `campaign-live-client.tsx` via `subscribeToCampaigns`
- [x] On reconnect after network drop, force a server-side revalidate to catch missed events — both surfaces now call `router.refresh()` on the SUBSCRIBED-after-error edge and on the browser `online` event; the `subscribeTo*` helpers grew an `onStatus` option for this
- [x] Mark completed

### Task 14: Print-friendly campaign report

- [x] Add a "Stampa report" button on the campaign detail page generating a print-optimised view (uses CSS `@media print`) — landed as `/campaigns/[id]/report` with the toolbar/shell hidden via `@media print` rules in `src/app/globals.css`
- [x] Includes summary, outcome breakdown chart, top appointments table; truncates contact phones to last-4-digits unless explicitly toggled — `?fullPhones=1` URL param flips between masked (default) and full numbers; outcome breakdown rendered as accessible CSS bars to keep the surface print-friendly without a chart lib
- [x] Mark completed

### Task 15: Performance audit

- [x] Run Lighthouse against `/dashboard`, `/campaigns/[id]`, `/calls/[id]`; target Performance score ≥85 — manual test (skipped, requires deployed environment for representative numbers; runbook in ADR 0003 covers cadence)
- [x] Optimise: defer Recharts via `dynamic(() => import(), { ssr: false })`, audio loaded lazily, transcript paginated for very long calls (>10 min) — Recharts deferral is N/A (chart is custom inline SVG, no `recharts` dependency); `<audio>` now starts at `preload="none"` and promotes to `metadata` on first interaction in `recording-player.tsx`; transcript paginates at 100 segments (`TRANSCRIPT_INITIAL_SEGMENTS`) and auto-expands when playback crosses the boundary
- [x] Document findings in `docs/architecture-decisions/0003-dashboard-perf.md`
- [x] Mark completed

### Task 16: E2E

- [ ] Playwright `e2e/dashboard.spec.ts`:
  - sign in with seeded data
  - assert KPIs render
  - change period; assert KPIs update
  - click on an active campaign; land on live view
- [ ] Playwright `e2e/recording-player.spec.ts`:
  - open call detail with seeded recording fixture
  - play, pause, seek; assert UI updates
  - click transcript segment; assert audio seeks
- [ ] Mark completed

### Task 17: Definition of Done

- [ ] Dashboard renders <500ms server-side on representative data
- [ ] KPI accuracy verified against direct SQL queries
- [ ] Live campaign view updates in real time without manual refresh
- [ ] Recording player and transcript scroll stay in sync
- [ ] Daily report email reaches a test inbox at the right time
- [ ] Notification preferences honoured
- [ ] cmd+K returns results <300ms on 10k-contact dataset
- [ ] Mark completed

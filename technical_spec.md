# Voice AI Outbound Platform — Technical Specification

**Project codename:** _(TBD — placeholder: `VoiceFlow`)_
**Document version:** 1.0
**Date:** May 2026
**Audience:** Founding engineer, technical co-founder, first-hire developer
**Status:** Implementation-ready blueprint
**Confidentiality:** Internal

---

## Table of Contents

1. [Document Purpose and Scope](#1-document-purpose-and-scope)
2. [System Overview and Guiding Principles](#2-system-overview-and-guiding-principles)
3. [High-Level Architecture (Phase 1 MVP)](#3-high-level-architecture-phase-1-mvp)
4. [Technology Stack and Rationale](#4-technology-stack-and-rationale)
5. [Frontend Architecture](#5-frontend-architecture)
6. [Backend Architecture](#6-backend-architecture)
7. [Database Schema](#7-database-schema)
8. [Voice AI Orchestration (Phase 1)](#8-voice-ai-orchestration-phase-1)
9. [Telephony Layer](#9-telephony-layer)
10. [Campaign Execution Engine](#10-campaign-execution-engine)
11. [Billing, Credits and Stripe Integration](#11-billing-credits-and-stripe-integration)
12. [Compliance Subsystem (GDPR, AI Act, RPO)](#12-compliance-subsystem-gdpr-ai-act-rpo)
13. [Reporting, Recordings and Notifications](#13-reporting-recordings-and-notifications)
14. [Security and Multi-Tenancy](#14-security-and-multi-tenancy)
15. [Observability and Quality Monitoring](#15-observability-and-quality-monitoring)
16. [Deployment, Environments and DevOps](#16-deployment-environments-and-devops)
17. [Phase 2 — Migration to Proprietary Voice Stack](#17-phase-2--migration-to-proprietary-voice-stack)
18. [Appendix A — Environment Variables](#appendix-a--environment-variables)
19. [Appendix B — Third-Party Accounts Checklist](#appendix-b--third-party-accounts-checklist)
20. [Appendix C — Glossary](#appendix-c--glossary)

---

## 1. Document Purpose and Scope

This document is the engineering blueprint for the Voice AI Outbound platform described in the business plan dated May 2026. It is intended to be detailed enough that a competent full-stack engineer (whether the founder or a first hire) can begin implementation directly from it, without further architectural decisions being required for the MVP.

The scope covers two clearly separated phases:

**Phase 1 (months 0–6) — MVP on managed voice infrastructure.** The platform leans on Vapi or Retell as the conversational orchestrator, Twilio as the telephony provider, ElevenLabs as the voice synthesizer (via the orchestrator), and OpenAI as the language model (via the orchestrator). The product team owns the application layer (dashboard, campaigns, billing, compliance, reporting) and treats the voice agent as a configurable third-party service. This minimises time-to-market and engineering burden while the business model is being validated.

**Phase 2 (months 6–12) — migration to a proprietary voice stack.** Once unit economics, reliability and call quality are well understood, the orchestrator layer is rebuilt in-house on top of OpenAI Realtime API + ElevenLabs Conversational + a custom SIP/media bridge. This reduces per-minute cost by 20–30%, removes a strategic dependency, and unlocks deeper product features (custom barge-in tuning, answering-machine detection, voice cloning, etc.). Phase 2 is described as a roadmap, not as ready-to-build specification, because several decisions will be informed by Phase 1 production data.

Out of scope for this document: the AI-powered acquisition machine (the system that calls car dealers to sell the product itself), native CRM connectors for DealerK and MotorK, and verticals beyond automotive. These are intentionally deferred — they are independent modules that benefit from being scoped against real Phase 1 telemetry.

## 2. System Overview and Guiding Principles

The product, in one sentence: a multi-tenant web application where Italian car dealers upload contact lists, configure conversational scripts via templates, launch outbound calling campaigns executed by AI voice agents, and receive structured outcomes (qualified leads, booked appointments, transcripts) integrated back into their workflow.

Five guiding principles drive every architectural choice in this document:

**1. Ship fast, refactor with data.** The product market fit is unproven. Optimise for time-to-first-paying-customer, not for theoretical scale. Choose managed services aggressively; defer custom builds until they are demonstrably worth the engineering hours.

**2. Single tenant boundary, hard isolation.** Each dealer's data — contacts, recordings, transcripts, billing — must be isolated at the database level (Row Level Security) and at the API level (token-bound organization scope). A leaked contact list across customers is a business-ending event in this market.

**3. Cash before service.** The credit ledger is authoritative. Calls are only dispatched when sufficient credit is reserved. This matches the prepaid business model and removes credit-collection risk by construction.

**4. Compliance is a feature, not a layer.** GDPR, AI Act and RPO are not bolted on at the end. The data model, the call orchestration, and the dashboards all encode compliance primitives (opt-out, AI disclosure, RPO check, retention windows) from day one.

**5. Single-developer ergonomics.** Until month 6 the team is one person. Every choice — monolithic Next.js app, managed Postgres, no Kubernetes, no microservices, opinionated frameworks — is biased toward keeping the entire system understandable and operable by one human.

## 3. High-Level Architecture (Phase 1 MVP)

The platform is a single Next.js application deployed on Vercel, backed by a managed Postgres database (Supabase), with two external worker subsystems: a job orchestrator (Inngest) for campaign scheduling and a third-party voice orchestrator (Vapi or Retell) for the actual phone calls.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            BROWSER (Dealer)                             │
│                          Next.js React Frontend                         │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ HTTPS
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         NEXT.JS APP (Vercel)                            │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐  │
│  │ App Router UI   │  │ Route Handlers  │  │ Server Actions          │  │
│  │ (RSC + Client)  │  │ (REST + webhook)│  │ (mutations from UI)     │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────┘  │
│                                │                                        │
│                                ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │              Service Layer (TypeScript modules)                 │    │
│  │  campaigns │ contacts │ credits │ scripts │ compliance │ ...    │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└───────────┬─────────────────────────────┬─────────────────────┬─────────┘
            │                             │                     │
            ▼                             ▼                     ▼
    ┌───────────────┐            ┌────────────────┐    ┌─────────────────┐
    │  SUPABASE     │            │   INNGEST      │    │   STRIPE        │
    │  Postgres+RLS │            │ Job orchestr.  │    │ Payments+webhook│
    │  Auth+Storage │            │ Cron+retries   │    │                 │
    └───────────────┘            └───────┬────────┘    └─────────────────┘
                                         │
                                         ▼
                                 ┌────────────────┐
                                 │  VAPI / RETELL │  ◄── Phase 1
                                 │  Voice agent   │      orchestrator
                                 │  orchestration │
                                 └───────┬────────┘
                                         │
                          ┌──────────────┼──────────────┐
                          ▼              ▼              ▼
                    ┌──────────┐  ┌─────────────┐  ┌──────────────┐
                    │  TWILIO  │  │  ELEVENLABS │  │   OPENAI     │
                    │ Telephony│  │  TTS voice  │  │  LLM brain   │
                    │ (+SBC IT)│  │             │  │              │
                    └────┬─────┘  └─────────────┘  └──────────────┘
                         │
                         ▼
                  ┌──────────────┐
                  │ Italian PSTN │
                  │ (TIM, Voda,  │
                  │  WindTre)    │
                  └──────────────┘
```

The data flow for a typical campaign is:

1. The dealer uploads a CSV (or syncs via Zapier/Make in later iterations) containing leads. The Next.js app validates the file, runs the RPO and opt-out checks, and writes contacts to Postgres.
2. The dealer configures the campaign by picking a script template, filling in the variables (dealership name, brand, available appointment slots), and launches the campaign. The app reserves the maximum potential credit cost up-front against the organization's credit balance.
3. Inngest takes over: it iterates through pending contacts respecting the legal call-window (08:00–22:00 Italian time on weekdays), concurrency limits, and per-number cooldown. For each contact, Inngest issues a "create call" request to the voice orchestrator (Vapi or Retell).
4. The orchestrator places the call via Twilio (with an Italian SBC for CLI presentation), runs the conversation using OpenAI's LLM and ElevenLabs' synthesised voice, classifies the outcome, and posts a webhook back to the Next.js app when the call ends.
5. The app receives the webhook, persists the outcome and recording, deducts the actual minutes used from the credit ledger, and — if the call was classified as a qualified lead or an appointment booking — triggers downstream actions (email notification to the dealer, calendar booking, optional CRM push).
6. At end of day, a scheduled Inngest job aggregates the campaign's results and sends a summary email to the dealer with links to recordings and transcripts.

This architecture deliberately has no Kubernetes, no message broker beyond Inngest, no separate background-worker service: the application is a single Next.js process plus stateless Inngest functions. One developer can hold the entire system in their head.

## 4. Technology Stack and Rationale

The stack is chosen for one criterion above all others: how quickly can one person build, ship, and operate it.

**Frontend framework: Next.js 15 (App Router) with React 19.** Server components handle the data-heavy dashboard pages with zero client-side fetch logic; client components handle the interactive bits (CSV uploader, campaign wizard, live status). The same framework provides the API layer (Route Handlers) and Server Actions for mutations, eliminating the frontend/backend split entirely.

**Hosting: Vercel.** Zero-config deployment, automatic preview environments per branch, edge functions where they help (auth middleware) and Node.js functions where they don't (long-running webhook processors). The cost at this scale is negligible compared to the engineering hours saved.

**Database: Supabase Postgres.** Provides Postgres 16 with built-in Row Level Security (essential for multi-tenancy), authentication (email + magic link + OAuth), file storage (call recordings, CSV uploads), and a realtime channel (for live campaign status in the dashboard). Neon is a viable alternative if Supabase Auth is replaced with Clerk, but Supabase's bundling reduces vendor surface area.

**Authentication: Supabase Auth.** Email + magic link for the MVP. Multi-factor authentication is enabled but optional. Organization-scoped roles (owner, admin, operator, viewer) live in application tables, not in Supabase's built-in roles, to keep the model flexible.

**Job orchestration: Inngest.** Replaces what would otherwise be a Redis + BullMQ + worker process trio. Inngest functions are deployed alongside the Next.js app and triggered by events; it handles retries, scheduling, fan-out, concurrency limits and step-level idempotency natively. Trigger.dev is an equivalent alternative.

**Voice orchestration (Phase 1): Vapi (primary) or Retell (fallback).** Both provide a managed conversational layer that wires together the LLM, TTS, telephony, barge-in handling and outcome detection. Vapi is preferred for its richer Italian voice support and its more permissive pricing for outbound use cases; Retell is held in reserve as a vendor diversification option. Decision reviewed at month 3 based on production call quality.

**Telephony: Twilio Programmable Voice + Telnyx as a fallback carrier.** Twilio provides the API and global presence; an Italian SBC (Voiped or Messagenet) is layered in front for proper Italian CLI presentation, which is non-negotiable for spam-filter avoidance.

**Payments: Stripe.** Top-up flow uses Stripe Checkout (hosted page) for the MVP — no custom card form, no PCI scope. Webhooks reconcile completed payments into the credit ledger.

**Email: Resend.** Transactional and report emails. React Email for templates. Postmark is the alternative if deliverability issues emerge.

**File storage: Supabase Storage.** Call recordings and CSV uploads. Signed URLs for time-limited access; bucket-level policies aligned to organization isolation.

**Observability: Vercel Analytics + Sentry + Axiom (or Better Stack).** Sentry for application errors, Axiom for structured log aggregation and ad-hoc queries against call telemetry. Healthchecks.io for cron-style heartbeat monitoring of Inngest scheduled jobs.

**TypeScript everywhere.** Strict mode. Shared types between server and client via the same module imports. Drizzle ORM (over Prisma) for type-safe SQL with first-class support for Postgres-specific features (RLS, partial indexes, generated columns) needed by this product.

## 5. Frontend Architecture

### 5.1 Application structure

The dealer-facing application is organised around the App Router convention. Routes are grouped by access role to make middleware enforcement trivial.

```
src/
  app/
    (marketing)/                  # Public pages
      page.tsx                    # Landing
      pricing/page.tsx
      legal/privacy/page.tsx
      legal/terms/page.tsx
      legal/dpa/page.tsx
    (auth)/
      login/page.tsx
      signup/page.tsx
      verify/page.tsx
    (app)/                        # Authenticated dealer app
      layout.tsx                  # Sidebar shell, org switcher
      dashboard/page.tsx          # Home: KPIs, recent campaigns
      campaigns/
        page.tsx                  # List view
        new/page.tsx              # 3-step wizard
        [id]/page.tsx             # Detail + live status
        [id]/results/page.tsx     # Per-call outcomes
      contacts/
        page.tsx                  # Lead lists
        upload/page.tsx           # CSV importer
      scripts/
        page.tsx                  # Template gallery
        [id]/page.tsx             # Script editor (variable wizard)
      credit/
        page.tsx                  # Balance + history
        topup/page.tsx            # Stripe checkout entry
      settings/
        organization/page.tsx
        members/page.tsx
        integrations/page.tsx     # Calendar, Zapier
        compliance/page.tsx       # DPA, opt-out registry
    api/
      webhooks/
        stripe/route.ts
        vapi/route.ts             # Call lifecycle events
        twilio/route.ts           # Optional: status callbacks
      cron/
        daily-report/route.ts
        retention-purge/route.ts
      uploads/
        contacts/route.ts         # Pre-signed URL issuance
  components/
    ui/                           # shadcn/ui primitives
    campaign/
    contact/
    billing/
  lib/
    supabase/                     # Client + server helpers
    db/                           # Drizzle schema + queries
    services/                     # Business logic modules
    inngest/                      # Job definitions
    voice/                        # Vapi/Retell adapter
    compliance/                   # RPO check, opt-out
    stripe/
  middleware.ts                   # Auth gate, org resolution
```

### 5.2 Rendering strategy

Server Components are the default. They handle initial data load directly via Drizzle queries against Supabase, scoped to the active organization through a request-bound Postgres connection that has the org_id GUC set (this drives RLS policies). Client Components are used only where interactivity demands it: the campaign wizard, the CSV uploader, the live status panel (subscribed to Supabase Realtime), and form inputs.

There is no separate "API for the frontend." Mutations from the dashboard go through Server Actions, which import the same service-layer modules used by webhook handlers and Inngest functions. This keeps the business logic in one place and prevents drift.

### 5.3 Authentication flow

Authentication uses Supabase's email + magic link as the primary mechanism (no password to remember, lower support burden). On signup the user picks or creates an organization; this creates rows in `organizations`, `memberships` (linking the user as `owner`), and a starter credit ledger entry of zero.

The Next.js middleware runs on every request to `/(app)/*`:

1. Reads the Supabase session cookie.
2. Resolves the active organization (cookie `active_org_id`, validated against memberships).
3. Rejects with redirect to `/login` if no session.
4. Rejects with 403 if the user is not a member of the active org.
5. Stamps the request with org_id and user_id headers consumed by downstream Server Components and Actions.

Sessions are JWT-based, refreshed by Supabase. There is no separate API key system in Phase 1; programmatic access (for Zapier/Make integrations) uses scoped personal access tokens that are validated by the middleware in the same way.

### 5.4 Key UI flows

**Campaign creation wizard (3 steps).** Step 1: select script template (cards showing the five built-in templates). Step 2: variable form auto-generated from the template's variable schema (4–6 fields like dealership name, brand, available slots). Step 3: pick a contact list (already uploaded) or upload a new CSV inline, then review estimated cost and confirm. The wizard uses client-side state (Zustand) for the in-progress draft and only persists on final confirm.

**CSV upload.** The browser uploads directly to Supabase Storage via a pre-signed URL (so the file never touches the Next.js server). On upload completion an Inngest job parses, validates and ingests the file: column mapping, phone-number normalisation to E.164, RPO check, opt-out check, deduplication against existing contacts. The user sees real-time progress via Supabase Realtime.

**Campaign detail page.** Three tabs: Overview (KPIs: calls placed, completion rate, qualified leads, appointments booked, credit consumed), Live (a streaming list of in-progress and just-completed calls, updated via Realtime), Results (filterable list of every call with outcome, duration, recording link, transcript). The recording player streams from Supabase Storage via a short-lived signed URL.

**Top-up flow.** The dealer picks a package (Test, Starter, Growth, Scale), is redirected to Stripe Checkout, completes payment, and is returned to a success page that polls the credit ledger until the webhook has reconciled the payment (typically <5 seconds). The success page falls back to a "we'll email you when credit is added" message if reconciliation takes longer than 30 seconds.

### 5.5 Design system

The UI is built on **shadcn/ui** components with Tailwind CSS 4. The design language is intentionally restrained — this is a B2B operational tool used by sales managers, not a consumer product. Dense data tables, clear status indicators, generous use of monospace fonts for technical fields (phone numbers, IDs, timings). No animations beyond functional micro-interactions. Italian as the default UI language; English available as a toggle from day one for the founder's own use and for future market expansion.

## 6. Backend Architecture

### 6.1 Layered organisation

The backend code lives in three concentric layers with strict dependency rules: outer layers depend on inner layers, never the reverse.

**Layer 1 — Domain modules (`lib/db`, `lib/services`).** Pure TypeScript. No Next.js imports, no HTTP awareness. Each domain has a Drizzle schema fragment, a query module, and a service module. Example domains: organizations, campaigns, contacts, calls, credit, scripts, compliance.

**Layer 2 — Integration adapters (`lib/voice`, `lib/stripe`, `lib/email`, `lib/storage`).** Wrap third-party SDKs behind interfaces the domain layer can call. This is what allows Phase 2 to swap Vapi/Retell for a custom orchestrator with no domain-layer changes — only the adapter's implementation changes.

**Layer 3 — Entrypoints (`app/api`, Server Actions, `lib/inngest` functions).** Translate HTTP requests, form submissions and events into calls into the domain layer. Handle authentication, validation (Zod), rate limiting, and response shaping. They contain no business logic of their own.

### 6.2 Service-layer example structure

Each service module exposes a small set of high-level operations that encapsulate transactionally-consistent business rules. For example, the campaign service:

```typescript
// lib/services/campaign.ts (illustrative)

export interface LaunchCampaignInput {
  orgId: string;
  scriptId: string;
  contactListId: string;
  variables: Record<string, string>;
  scheduledStart?: Date;
}

export async function launchCampaign(input: LaunchCampaignInput) {
  return db.transaction(async (tx) => {
    const estimate = await estimateCampaignCost(tx, input);
    await reserveCredit(tx, input.orgId, estimate.maxCents);
    const campaign = await insertCampaign(tx, input, estimate);
    await inngest.send({
      name: 'campaign/launched',
      data: { campaignId: campaign.id },
    });
    return campaign;
  });
}
```

The service layer is the only place where multi-table writes, credit reservation, and event emission happen together inside a single transaction. Webhook handlers, Server Actions and Inngest functions never write directly to the database — they always go through a service.

### 6.3 Route Handlers (HTTP API surface)

Route Handlers are limited to webhooks and pre-signed URL issuance. There is no public REST API in Phase 1; the dashboard uses Server Actions, and external integrations (Zapier, Make) consume a small webhook-out system rather than a request-in API. This keeps the surface area small and audit-friendly.

The webhook handlers are the most critical pieces of the HTTP surface:

| Endpoint                         | Source            | Purpose                                                             |
| -------------------------------- | ----------------- | ------------------------------------------------------------------- |
| `POST /api/webhooks/stripe`      | Stripe            | Payment completion → credit top-up                                  |
| `POST /api/webhooks/vapi`        | Vapi/Retell       | Call lifecycle events (started, ended, transcript-ready)            |
| `POST /api/webhooks/twilio`      | Twilio (optional) | Carrier-level status (busy, failed, completed) for cross-validation |
| `POST /api/cron/daily-report`    | Vercel Cron       | Trigger end-of-day aggregation per org                              |
| `POST /api/cron/retention-purge` | Vercel Cron       | Enforce data retention policies                                     |

All webhook handlers verify signatures, are idempotent (keyed on the provider's event ID), and respond 200 within 3 seconds — heavy work is deferred to Inngest jobs they emit.

### 6.4 Server Actions (mutations from UI)

Server Actions are typed function exports annotated with `"use server"`. They are the single way the UI mutates state. Every action follows the same pattern:

1. Validate input with Zod.
2. Resolve the authenticated user and active org from request headers (set by middleware).
3. Authorize: check the user's role on the org permits the action.
4. Call into the service layer.
5. Return a discriminated-union result (`{ ok: true, data } | { ok: false, error }`).
6. Trigger UI revalidation via `revalidatePath` or `revalidateTag`.

Form components use `useActionState` to bind directly to actions, surfacing validation errors inline.

### 6.5 Background jobs (Inngest)

Inngest functions are defined as event handlers and grouped by domain. Key functions:

| Function                   | Trigger                              | Responsibility                                                                                  |
| -------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `campaign.launched`        | Event from `launchCampaign`          | Plan dispatch schedule, enqueue per-contact dispatch jobs                                       |
| `campaign.dispatch-call`   | Event per contact                    | Check time-window + concurrency, request call from Vapi, persist call record in `pending` state |
| `call.completed`           | Event from Vapi webhook              | Reconcile actual minutes used, deduct credit, classify outcome, fan out notifications           |
| `campaign.aggregate`       | Cron (every 5 min)                   | Update campaign-level aggregate counters                                                        |
| `report.daily`             | Cron (20:00 IT)                      | Generate per-campaign + per-org daily report email                                              |
| `retention.purge`          | Cron (daily 03:00)                   | Delete recordings/transcripts past retention window                                             |
| `credit.low-balance-alert` | Event when balance crosses threshold | Email org owner                                                                                 |

Inngest's first-class concurrency controls are used to enforce per-organization concurrent-call limits (e.g., max 10 simultaneous calls per org by default), per-phone-number cooldowns, and global system limits to protect Twilio rate caps.

## 7. Database Schema

### 7.1 Schema design principles

The data model is built around four invariants:

**Tenancy invariant.** Every row in every business table carries an `org_id` column. RLS policies on every table restrict access to rows where `org_id` matches the request-scoped GUC `app.current_org_id`. There are no "shared" rows across organizations except in clearly-marked reference tables (script templates, RPO snapshots).

**Money invariant.** All monetary values are stored as integer cents in the smallest unit (cents of EUR). All call costs, package prices, ledger entries use the same integer currency. Floating-point money never appears anywhere in the codebase.

**Time invariant.** All timestamps are `timestamptz` stored in UTC. Italian timezone conversion happens only at presentation and at compliance-check boundaries (the 08:00–22:00 call window check converts to Europe/Rome).

**Audit invariant.** Every business-critical mutation (credit movement, campaign launch, opt-out registration, member changes) writes an immutable row in an audit log table in the same transaction as the mutation itself.

### 7.2 Core tables

The schema below covers Phase 1. Foreign keys and indexes are described in prose where they aren't obvious from the column definition.

#### `organizations`

| Column       | Type          | Notes                            |
| ------------ | ------------- | -------------------------------- |
| `id`         | `uuid` PK     | Generated by `gen_random_uuid()` |
| `name`       | `text`        | Dealership trade name            |
| `legal_name` | `text`        | For invoices                     |
| `vat_number` | `text`        | Italian P.IVA, validated         |
| `country`    | `text`        | Default `IT`                     |
| `timezone`   | `text`        | Default `Europe/Rome`            |
| `created_at` | `timestamptz` |                                  |
| `deleted_at` | `timestamptz` | Soft delete                      |

#### `users` (mirror of Supabase Auth, extended)

| Column       | Type          | Notes                   |
| ------------ | ------------- | ----------------------- |
| `id`         | `uuid` PK     | Matches `auth.users.id` |
| `email`      | `text`        |                         |
| `full_name`  | `text`        |                         |
| `locale`     | `text`        | `it` or `en`            |
| `created_at` | `timestamptz` |                         |

#### `memberships`

| Column        | Type                      | Notes                                        |
| ------------- | ------------------------- | -------------------------------------------- |
| `id`          | `uuid` PK                 |                                              |
| `org_id`      | `uuid` FK → organizations |                                              |
| `user_id`     | `uuid` FK → users         |                                              |
| `role`        | `text`                    | `owner` \| `admin` \| `operator` \| `viewer` |
| `invited_at`  | `timestamptz`             |                                              |
| `accepted_at` | `timestamptz`             | Null until invite accepted                   |

Unique index on `(org_id, user_id)`.

#### `script_templates` (system-owned, not org-scoped)

| Column             | Type          | Notes                                                                                              |
| ------------------ | ------------- | -------------------------------------------------------------------------------------------------- |
| `id`               | `uuid` PK     |                                                                                                    |
| `slug`             | `text` UNIQUE | e.g. `lead-reactivation`, `appointment-confirm`, `car-renewal`, `post-sale-followup`, `csi-survey` |
| `name`             | `text`        | Display name                                                                                       |
| `version`          | `int`         | Templates are versioned; campaigns reference specific versions                                     |
| `system_prompt`    | `text`        | The base instruction set for the LLM                                                               |
| `variable_schema`  | `jsonb`       | JSON schema describing required variables                                                          |
| `default_voice_id` | `text`        | ElevenLabs voice ID                                                                                |
| `default_language` | `text`        | `it-IT`                                                                                            |
| `published_at`     | `timestamptz` |                                                                                                    |

#### `scripts` (per-org instances of templates)

| Column        | Type                         | Notes                       |
| ------------- | ---------------------------- | --------------------------- |
| `id`          | `uuid` PK                    |                             |
| `org_id`      | `uuid` FK                    |                             |
| `template_id` | `uuid` FK → script_templates |                             |
| `name`        | `text`                       | User-given label            |
| `variables`   | `jsonb`                      | The 4–6 customised values   |
| `voice_id`    | `text`                       | Override voice if requested |
| `created_at`  | `timestamptz`                |                             |
| `updated_at`  | `timestamptz`                |                             |

#### `contact_lists`

| Column             | Type          | Notes                                  |
| ------------------ | ------------- | -------------------------------------- |
| `id`               | `uuid` PK     |                                        |
| `org_id`           | `uuid` FK     |                                        |
| `name`             | `text`        |                                        |
| `source`           | `text`        | `csv-upload` \| `zapier` \| `api`      |
| `source_file_path` | `text`        | Supabase Storage key for original file |
| `total_count`      | `int`         |                                        |
| `valid_count`      | `int`         | After validation/RPO/opt-out filtering |
| `created_at`       | `timestamptz` |                                        |

#### `contacts`

| Column             | Type          | Notes                                                     |
| ------------------ | ------------- | --------------------------------------------------------- |
| `id`               | `uuid` PK     |                                                           |
| `org_id`           | `uuid` FK     |                                                           |
| `contact_list_id`  | `uuid` FK     |                                                           |
| `phone_e164`       | `text`        | Normalised; primary index for dedup                       |
| `first_name`       | `text`        | Optional                                                  |
| `last_name`        | `text`        | Optional                                                  |
| `email`            | `text`        | Optional                                                  |
| `consent_basis`    | `text`        | `consent` \| `legitimate_interest` \| `existing_customer` |
| `consent_evidence` | `text`        | Free text from dealer for audit                           |
| `rpo_status`       | `text`        | `clear` \| `blocked` \| `unchecked`                       |
| `rpo_checked_at`   | `timestamptz` |                                                           |
| `opt_out`          | `boolean`     | Default false                                             |
| `opt_out_reason`   | `text`        |                                                           |
| `metadata`         | `jsonb`       | Original CSV row preserved                                |
| `created_at`       | `timestamptz` |                                                           |

Composite unique index on `(org_id, phone_e164)` to prevent double-loading the same number into the same organization.

#### `campaigns`

| Column                | Type              | Notes                                                                         |
| --------------------- | ----------------- | ----------------------------------------------------------------------------- |
| `id`                  | `uuid` PK         |                                                                               |
| `org_id`              | `uuid` FK         |                                                                               |
| `name`                | `text`            |                                                                               |
| `script_id`           | `uuid` FK         |                                                                               |
| `contact_list_id`     | `uuid` FK         |                                                                               |
| `status`              | `text`            | `draft` \| `scheduled` \| `running` \| `paused` \| `completed` \| `cancelled` |
| `estimated_max_cents` | `int`             | Reserved at launch                                                            |
| `actual_cents`        | `int`             | Updated as calls complete                                                     |
| `scheduled_start`     | `timestamptz`     |                                                                               |
| `started_at`          | `timestamptz`     |                                                                               |
| `completed_at`        | `timestamptz`     |                                                                               |
| `concurrency_limit`   | `int`             | Default 5                                                                     |
| `time_window_start`   | `time`            | Default 09:00                                                                 |
| `time_window_end`     | `time`            | Default 19:00                                                                 |
| `created_by`          | `uuid` FK → users |                                                                               |
| `created_at`          | `timestamptz`     |                                                                               |

#### `calls`

| Column                 | Type                     | Notes                                                                                                                                                   |
| ---------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                   | `uuid` PK                |                                                                                                                                                         |
| `org_id`               | `uuid` FK                |                                                                                                                                                         |
| `campaign_id`          | `uuid` FK                |                                                                                                                                                         |
| `contact_id`           | `uuid` FK                |                                                                                                                                                         |
| `provider`             | `text`                   | `vapi` \| `retell` \| `proprietary` (Phase 2)                                                                                                           |
| `provider_call_id`     | `text`                   | External call ID                                                                                                                                        |
| `from_number`          | `text`                   | Italian CLI used                                                                                                                                        |
| `to_number`            | `text`                   | E.164                                                                                                                                                   |
| `status`               | `text`                   | `pending` \| `dialing` \| `in_progress` \| `completed` \| `failed` \| `no_answer` \| `voicemail` \| `busy`                                              |
| `outcome`              | `text`                   | Business-level: `interested` \| `not_interested` \| `appointment_booked` \| `wrong_number` \| `callback_requested` \| `voicemail_left` \| `do_not_call` |
| `outcome_confidence`   | `numeric(3,2)`           | 0.00–1.00, set by AI classifier                                                                                                                         |
| `started_at`           | `timestamptz`            |                                                                                                                                                         |
| `ended_at`             | `timestamptz`            |                                                                                                                                                         |
| `duration_seconds`     | `int`                    |                                                                                                                                                         |
| `billable_seconds`     | `int`                    | After rounding rules                                                                                                                                    |
| `cost_cents`           | `int`                    | Charged to credit ledger                                                                                                                                |
| `recording_path`       | `text`                   | Supabase Storage key                                                                                                                                    |
| `transcript_path`      | `text`                   | Supabase Storage key                                                                                                                                    |
| `appointment_id`       | `uuid` FK → appointments | Nullable                                                                                                                                                |
| `transferred_to_agent` | `boolean`                |                                                                                                                                                         |
| `error_code`           | `text`                   | When status = failed                                                                                                                                    |
| `created_at`           | `timestamptz`            |                                                                                                                                                         |

Indexes on `(org_id, campaign_id, status)`, `(org_id, contact_id)`, and a partial index on `provider_call_id` for webhook lookups.

#### `appointments`

| Column         | Type          | Notes                                                              |
| -------------- | ------------- | ------------------------------------------------------------------ |
| `id`           | `uuid` PK     |                                                                    |
| `org_id`       | `uuid` FK     |                                                                    |
| `call_id`      | `uuid` FK     |                                                                    |
| `contact_id`   | `uuid` FK     |                                                                    |
| `scheduled_at` | `timestamptz` |                                                                    |
| `notes`        | `text`        | AI-extracted summary                                               |
| `status`       | `text`        | `booked` \| `confirmed` \| `cancelled` \| `no_show` \| `completed` |
| `created_at`   | `timestamptz` |                                                                    |

#### `credit_packages` (system-owned reference)

| Column             | Type          | Notes                                              |
| ------------------ | ------------- | -------------------------------------------------- |
| `id`               | `uuid` PK     |                                                    |
| `slug`             | `text` UNIQUE | `test`, `starter`, `growth`, `scale`, `enterprise` |
| `display_name`     | `text`        |                                                    |
| `price_cents`      | `int`         |                                                    |
| `included_minutes` | `int`         |                                                    |
| `stripe_price_id`  | `text`        |                                                    |
| `active`           | `boolean`     |                                                    |

#### `credit_ledger`

The single source of truth for the prepaid balance. Append-only.

| Column                | Type          | Notes                                                                         |
| --------------------- | ------------- | ----------------------------------------------------------------------------- |
| `id`                  | `uuid` PK     |                                                                               |
| `org_id`              | `uuid` FK     |                                                                               |
| `entry_type`          | `text`        | `topup` \| `reservation` \| `release` \| `charge` \| `refund` \| `adjustment` |
| `delta_cents`         | `int`         | Positive (credit) or negative (debit)                                         |
| `balance_after_cents` | `int`         | Materialised running total per org                                            |
| `reference_type`      | `text`        | `stripe_payment` \| `campaign` \| `call` \| `manual`                          |
| `reference_id`        | `text`        |                                                                               |
| `description`         | `text`        |                                                                               |
| `created_at`          | `timestamptz` |                                                                               |

A `credit_balances` materialised view (or trigger-maintained table) provides O(1) balance reads. The `(org_id, reference_type, reference_id, entry_type)` tuple is unique to enforce idempotency of duplicate webhook deliveries.

#### `payments`

| Column                     | Type          | Notes                                              |
| -------------------------- | ------------- | -------------------------------------------------- |
| `id`                       | `uuid` PK     |                                                    |
| `org_id`                   | `uuid` FK     |                                                    |
| `package_id`               | `uuid` FK     |                                                    |
| `stripe_session_id`        | `text` UNIQUE |                                                    |
| `stripe_payment_intent_id` | `text`        |                                                    |
| `amount_cents`             | `int`         |                                                    |
| `currency`                 | `text`        | `eur`                                              |
| `status`                   | `text`        | `pending` \| `succeeded` \| `failed` \| `refunded` |
| `invoice_url`              | `text`        |                                                    |
| `created_at`               | `timestamptz` |                                                    |
| `completed_at`             | `timestamptz` |                                                    |

#### `opt_out_registry`

Org-scoped registry of phone numbers that must never be called again. Entries are populated automatically when a call ends with outcome `do_not_call`, when a contact is reported by the dealer, or when an opt-out is processed via inbound channel.

| Column        | Type          | Notes                                              |
| ------------- | ------------- | -------------------------------------------------- |
| `id`          | `uuid` PK     |                                                    |
| `org_id`      | `uuid` FK     |                                                    |
| `phone_e164`  | `text`        |                                                    |
| `source`      | `text`        | `call_outcome` \| `dealer_input` \| `gdpr_request` |
| `recorded_at` | `timestamptz` |                                                    |

Unique index `(org_id, phone_e164)`.

#### `rpo_snapshots` (system-owned, not org-scoped)

The Italian Registro Pubblico delle Opposizioni is consulted in batch. Snapshots of cleared/blocked numbers are cached here to avoid per-call lookups.

| Column            | Type          | Notes |
| ----------------- | ------------- | ----- |
| `phone_e164`      | `text` PK     |       |
| `is_blocked`      | `boolean`     |       |
| `last_checked_at` | `timestamptz` |       |

Cache TTL is 30 days as required by current AGCOM guidance.

#### `audit_log`

| Column          | Type           | Notes                                                      |
| --------------- | -------------- | ---------------------------------------------------------- |
| `id`            | `bigserial` PK |                                                            |
| `org_id`        | `uuid`         | Nullable for system events                                 |
| `actor_user_id` | `uuid`         | Nullable for system actors                                 |
| `actor_type`    | `text`         | `user` \| `system` \| `webhook`                            |
| `action`        | `text`         | e.g. `campaign.launched`, `credit.topup`, `member.invited` |
| `subject_type`  | `text`         |                                                            |
| `subject_id`    | `text`         |                                                            |
| `metadata`      | `jsonb`        |                                                            |
| `created_at`    | `timestamptz`  |                                                            |

#### `webhook_events`

Inbound webhook deduplication and replay store.

| Column              | Type          | Notes                          |
| ------------------- | ------------- | ------------------------------ |
| `id`                | `uuid` PK     |                                |
| `provider`          | `text`        | `stripe` \| `vapi` \| `twilio` |
| `provider_event_id` | `text`        |                                |
| `event_type`        | `text`        |                                |
| `payload`           | `jsonb`       |                                |
| `received_at`       | `timestamptz` |                                |
| `processed_at`      | `timestamptz` |                                |
| `error`             | `text`        |                                |

Unique index `(provider, provider_event_id)` enforces idempotency.

### 7.3 Row Level Security pattern

Every org-scoped table has the same RLS pattern:

```sql
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY campaigns_org_isolation ON campaigns
  USING (org_id = current_setting('app.current_org_id')::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id')::uuid);
```

The Next.js Supabase client wrapper sets `app.current_org_id` via `SET LOCAL` at the start of every request transaction, derived from the middleware-validated active org. Service-role connections (used by webhook handlers and Inngest functions) bypass RLS but the service layer enforces org scoping in code; the dual layer of defence catches both bugs and credential mishandling.

### 7.4 Migrations and seeds

Migrations are managed by Drizzle Kit, checked into the repo, and applied via a CI step on deploy. Seed data — the five script templates, the five credit packages, the system roles — lives in a separate idempotent seed script run after migrations.

## 8. Voice AI Orchestration (Phase 1)

### 8.1 Why a managed orchestrator

Building a production-grade real-time voice agent involves wiring together telephony, voice activity detection, a streaming LLM, a streaming text-to-speech engine, barge-in handling, answering-machine detection, and call lifecycle webhooks. Each of these is non-trivial. Vapi and Retell have already done this work at high quality; Phase 1 leverages their orchestration so that the application team can focus on script design, dashboard, billing and compliance — the parts of the product that actually differentiate the business.

### 8.2 Adapter abstraction

The application interacts with the orchestrator through a single TypeScript interface. This interface is the boundary at which Phase 2 will swap implementations.

```typescript
// lib/voice/types.ts (illustrative)

export interface VoiceProvider {
  createCall(params: CreateCallParams): Promise<{ providerCallId: string }>;
  cancelCall(providerCallId: string): Promise<void>;
  fetchRecording(providerCallId: string): Promise<Buffer>;
  fetchTranscript(providerCallId: string): Promise<TranscriptSegment[]>;
}

export interface CreateCallParams {
  toNumber: string; // E.164
  fromNumber: string; // Italian CLI
  systemPrompt: string; // Composed from template + variables
  firstMessage: string; // First utterance
  voiceId: string; // ElevenLabs voice
  language: string; // it-IT
  maxDurationSeconds: number; // Hard cap
  webhookUrl: string; // Lifecycle callback
  metadata: {
    orgId: string;
    campaignId: string;
    callId: string; // Our internal ID
    contactId: string;
  };
  endCallFunctions: ToolDefinition[]; // e.g. book_appointment, transfer_to_agent
}
```

Two concrete implementations live behind this interface in Phase 1: `VapiAdapter` (primary) and `RetellAdapter` (fallback). The active one is selected by an environment-variable feature flag, allowing per-organization or per-campaign A/B testing later.

### 8.3 Script template structure

Each script template is composed of three parts:

**System prompt template.** A long-form instruction in Italian that defines the agent's persona, the conversation goals, the rules of engagement, the tone, the obligation to disclose AI nature in the first 5 seconds, the available tools, and the criteria for outcome classification. Variables are referenced as `{{variable_name}}` placeholders.

**Variable schema.** A JSON schema declaring the variables a script instance must provide. Example for the `lead-reactivation` template: `dealership_name`, `brand`, `salesperson_first_name`, `available_slots`, `lead_origin_context`, `incentive_to_offer`.

**Tool definitions.** A list of function-call tools the LLM can invoke during the conversation: `book_appointment(date, time, contact_confirmation)`, `mark_not_interested(reason)`, `mark_wrong_number()`, `request_callback(preferred_window)`, `transfer_to_human_agent(reason)`, `register_opt_out()`. Each tool maps to an outcome and side effects in our system.

The system prompt always ends with the standard AI Act disclosure rule and the standard outcome-classification instructions, prepended automatically by the adapter so that template authors can never accidentally omit them.

### 8.4 Conversation lifecycle

For a single call the lifecycle is:

```
       ┌───────────────────────────────────────────────────────┐
       │         Inngest: campaign.dispatch-call               │
       │  ─ Verify time window + concurrency + credit          │
       │  ─ Insert calls row (status: pending)                 │
       │  ─ adapter.createCall(...)                            │
       │  ─ Update calls row (status: dialing, providerCallId) │
       └────────────────────────┬──────────────────────────────┘
                                │
                                ▼
                ┌──────────────────────────────────┐
                │        Vapi/Retell platform      │
                │  ─ Dials via Twilio              │
                │  ─ AMD: human or voicemail?      │
                │  ─ Streams LLM ↔ TTS ↔ caller    │
                │  ─ Tools invoked (book, etc.)    │
                │  ─ Posts lifecycle webhooks      │
                └──────────────────┬───────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
  call.started              call.ended                tool.invoked
        │                          │                          │
        ▼                          ▼                          ▼
  Update status      Persist transcript+rec.       Side-effect job:
  → in_progress      Compute billable_seconds      book appointment,
                     Deduct from credit ledger     register opt-out,
                     Classify outcome              etc.
                     Emit downstream events
```

Webhook idempotency is enforced through the `webhook_events` table: if a duplicate `provider_event_id` arrives, the handler returns 200 immediately and skips processing.

### 8.5 Outcome classification

Outcomes are determined in two ways and reconciled. **Tool-driven outcomes** are authoritative: if the LLM invoked `book_appointment`, the outcome is `appointment_booked` regardless of what a downstream classifier thinks. **Inferred outcomes** are produced by an asynchronous classification job that reads the full transcript after call end and assigns one of the outcome enum values plus a confidence score; this is used when no tool was invoked (e.g., a brief conversation where the contact was simply "interested but didn't book").

Discrepancies between tool-driven and inferred outcomes are surfaced in an internal quality dashboard, not in customer-facing reports. Over time, low-confidence and frequently-disagreed cases are sampled for human review and feed back into prompt tuning.

### 8.6 Live transfer to human agent

When the LLM invokes `transfer_to_human_agent`, the orchestrator initiates a warm transfer to a phone number configured per script (typically the dealership's commercial line or a specific salesperson's mobile). Vapi and Retell both support this natively. The transfer event is recorded on the `calls` row (`transferred_to_agent = true`) and a notification is sent to the dealership's configured channel (email + optional SMS) so that the receiving human knows context immediately.

## 9. Telephony Layer

### 9.1 Carrier topology

Twilio is the primary carrier provider. Telnyx is configured as a backup carrier accessible through a runtime feature flag, used if Twilio quality degrades or pricing pressure mandates diversification.

For Italian outbound calling, raw Twilio CLI presentation often gets flagged by TIM, Vodafone and WindTre spam filters. The mitigation is to route calls through an Italian SBC (Session Border Controller) provided by Voiped or Messagenet, which presents proper Italian-format CLI numbers from a pool the platform owns. Two architectural options:

**Option A — SIP trunk via SBC.** The SBC owns a block of Italian numbers (geographic or mobile-format). Twilio is configured to send outbound calls via a SIP trunk to the SBC, which presents CLIs from the pool. This is the recommended approach for Phase 1 because it keeps the Vapi/Retell integration unchanged (they speak SIP to the SBC) while solving the CLI problem.

**Option B — Italian numbers purchased directly through the orchestrator.** Vapi and Retell both allow attaching numbers from various providers. Italian number availability through Twilio is constrained; Telnyx has better coverage. This is simpler to set up but offers less control over CLI rotation.

The decision in Phase 1 is **Option A** for production use, with **Option B** as a fallback for testing and small-volume early customers.

### 9.2 CLI rotation strategy

Each organization is assigned a small pool of CLIs (default: 3–5 numbers, more for high-volume customers). The campaign engine rotates among them with a per-number rate limit (default: max 30 outbound calls/hour from the same CLI) to spread load and reduce spam-filter risk. Per-customer CLI ownership is a paid upgrade for organizations that want a "branded" caller ID.

The CLI pool itself is managed by a `phone_numbers` table:

| Column             | Type          | Notes                                   |
| ------------------ | ------------- | --------------------------------------- |
| `id`               | `uuid` PK     |                                         |
| `e164`             | `text` UNIQUE |                                         |
| `org_id`           | `uuid`        | Nullable; null = shared pool            |
| `provider`         | `text`        | `voiped` \| `twilio` \| `telnyx`        |
| `status`           | `text`        | `active` \| `cooling_down` \| `retired` |
| `last_used_at`     | `timestamptz` |                                         |
| `daily_call_count` | `int`         | Reset by daily cron                     |
| `spam_score`       | `numeric`     | Updated by external monitoring          |

A nightly job queries third-party spam-reputation services (Truecaller, Hiya, where APIs are available) and updates `spam_score`. Numbers crossing a threshold are auto-rotated into `cooling_down` for a configurable period.

### 9.3 Anti-spam operational practices

Beyond CLI rotation, the platform enforces several practices that protect deliverability:

Calls are spaced with random jitter (50–200ms) rather than emitted in bursts. Per-contact retry policy is conservative: maximum 3 attempts spread across at least 48 hours, with the second attempt at a different time-of-day from the first. Contacts that explicitly say "do not call" trigger immediate `register_opt_out` regardless of the broader campaign state. Total outbound volume per CLI is capped at numbers calibrated against operator tolerance (revisited quarterly based on observed answer-rate trends).

### 9.4 Inbound handling

Phase 1 handles inbound calls minimally: the CLI numbers are configured to play a brief Italian message stating that the number is used for outbound contact only, that the caller has been called by a specific dealership ("the dealership that contacted you can be reached at..."), and inviting opt-out via a press-1 IVR that registers the caller's number in the org-scoped `opt_out_registry`. This is mandatory for compliance and is intentionally out of scope for active customer interaction.

## 10. Campaign Execution Engine

### 10.1 Dispatch model

Campaigns are dispatched by an Inngest function chain rather than by a long-running worker process. This is a deliberate choice: it lets the platform run on Vercel's serverless model with no separate infrastructure to operate, and Inngest handles retries, concurrency, and step-level idempotency natively.

The dispatch chain has four functions:

**`campaign.launched` (fan-out planner).** Triggered once per campaign launch. Reads all eligible contacts from the campaign's contact list, applies pre-flight filters (RPO, opt-out, deduplication against recent calls), and emits one `campaign.dispatch-call` event per contact, batched in groups respecting concurrency.

**`campaign.dispatch-call` (per-contact dispatcher).** Per-contact handler with concurrency keyed on `org_id` to enforce the per-org concurrent-call limit. Step 1: check time window (Europe/Rome, 09:00–19:00 by default, but configurable per campaign within the legal 08:00–22:00 envelope). If outside window, sleep until window opens. Step 2: check available credit; if insufficient, mark the call `failed` with `error_code = insufficient_credit` and emit a low-balance alert. Step 3: insert the `calls` row in `pending`, then call `adapter.createCall`. Step 4: update `calls` row with provider call ID and `dialing` status.

**`call.completed` (post-call processor).** Triggered by webhook after the call ends. Steps: dedupe via `webhook_events`, fetch recording and transcript URLs, persist them, compute billable seconds, debit credit ledger, run outcome classification, emit downstream events (`appointment.booked`, `lead.qualified`, `opt_out.registered` as appropriate).

**`campaign.completed` (terminal state).** Emitted when no contacts remain pending. Releases any over-reserved credit, flips campaign status, and triggers the final report email.

### 10.2 Concurrency and rate limits

Multiple layers of limits stack on top of one another to protect both the platform and the carriers:

| Limit                                                                              | Default                 | Configurable per              |
| ---------------------------------------------------------------------------------- | ----------------------- | ----------------------------- |
| Concurrent calls per organization                                                  | 5                       | Org (paid upgrade for higher) |
| Concurrent calls platform-wide                                                     | 100                     | System (operations team)      |
| Calls per CLI per hour                                                             | 30                      | System                        |
| Calls per CLI per day                                                              | 200                     | System                        |
| Retries per contact per campaign                                                   | 3                       | Campaign                      |
| Minimum interval between attempts to same contact                                  | 48 hours                | Campaign                      |
| Minimum interval between calls to numbers in same call group (e.g. same household) | not enforced in Phase 1 | future                        |

These are enforced through Inngest's concurrency primitives (for org and platform limits), database-level checks at dispatch time (for per-CLI and per-contact limits), and a watchdog cron that catches drift.

### 10.3 Time-window enforcement

The 08:00–22:00 weekday window (with stricter per-campaign overrides) is enforced at dispatch, not at call time. The dispatcher converts the current time to Europe/Rome and checks against the campaign's window. If the call would fall outside the window, the Inngest step sleeps until the window opens. This keeps the legal contract simple: a call is never **placed** outside the window, even if it would only be a few seconds past. Calls that are in progress when the window closes are allowed to complete naturally; the agent does not abruptly hang up.

### 10.4 Cancellation and pausing

A campaign can be paused or cancelled from the dashboard at any time. Pausing flips the campaign status, which is checked by `campaign.dispatch-call` at the start of every per-contact step; in-flight Inngest steps complete normally but no new calls are dispatched. Cancellation additionally signals the orchestrator to terminate any in-progress calls (Vapi/Retell support call-cancellation APIs), and releases the over-reserved credit immediately.

## 11. Billing, Credits and Stripe Integration

### 11.1 Credit ledger model

The credit ledger is the authoritative record of available balance. Every monetary movement is an immutable row in `credit_ledger`. The current balance for an organization is the sum of `delta_cents` for all rows (or, for performance, a materialised running balance maintained by an after-insert trigger).

Five kinds of entries flow through the ledger:

**Topup** — positive entry, written when a Stripe payment succeeds. Reference is the `payments.id`. Idempotency is keyed on `(org_id, 'stripe_payment', stripe_payment_intent_id, 'topup')`.

**Reservation** — negative entry, written at campaign launch for the **maximum potential cost** of the campaign (estimated as `expected_calls × max_duration × max_per_minute_rate`). This prevents launching a campaign that would exceed available credit mid-flight.

**Release** — positive entry, written at campaign completion or cancellation, equal to `reservation – sum(actual charges)`. Returns the unused reserved credit to the available balance.

**Charge** — negative entry, written per call, equal to the actual call's cost in cents. Reference is the `calls.id`.

**Adjustment** — manual entries written by support actions (refunds for failed calls, courtesy credits, corrections). These are gated behind an admin-only Server Action that requires a written reason persisted in the audit log.

### 11.2 Stripe Checkout flow

The MVP uses Stripe Checkout (hosted) rather than Stripe Elements. This is a pragmatic choice that eliminates PCI scope, supports Italian payment methods (cards, SEPA Direct Debit, eventually Bancomat Pay) out of the box, generates fiscally-compliant invoices via Stripe Tax, and saves significant frontend development time.

Flow:

1. User clicks "Top up €299 (Starter)" in the dashboard.
2. Server Action creates a Stripe Checkout Session referencing the package's `stripe_price_id`, embeds `org_id` and `package_id` in `metadata`, and returns the session URL.
3. User completes payment on Stripe's hosted page.
4. Stripe redirects to the success page; in parallel Stripe sends `checkout.session.completed` webhook.
5. Webhook handler verifies signature, persists in `webhook_events` for idempotency, opens a transaction, inserts a `payments` row with status `succeeded`, inserts a `credit_ledger` topup entry, writes audit log, commits.
6. Success page polls (or uses a Realtime channel subscription) for the new ledger entry and shows confirmation.

### 11.3 Per-call billing

The price-per-minute paid by the dealer is determined by the **package they purchased**, not by the actual cost to the platform. The `credit_packages` table encodes the per-minute rate implied by each package (price ÷ included minutes). When a call completes, the charge is computed as:

```
billable_seconds = round_up_to(actual_duration_seconds, BILLING_GRANULARITY_SECONDS)
charge_cents = ceil(billable_seconds / 60 * package_per_minute_cents)
```

`BILLING_GRANULARITY_SECONDS` is configured at 6 seconds (matching common telecom billing conventions; revisited based on competitive pressure and customer feedback). Calls under a minimum duration (default 6 seconds — typical for immediate hang-ups or no-answer redirects) are billed at zero. The granularity, minimum, and rounding rules are documented in the customer-facing pricing page for transparency.

### 11.4 Low-balance and out-of-credit handling

Two thresholds are monitored continuously: a **soft threshold** (default: 30 minutes remaining) triggers an email to the org owner suggesting a top-up; a **hard threshold** (zero or insufficient for the current call) blocks new dispatches. The dashboard shows balance prominently and warns before launching a campaign whose estimated cost exceeds 80% of available credit.

Top-up auto-recharge (Stripe saved payment method, recharge when balance falls below X) is **not** in Phase 1 scope: prepaid-with-explicit-recharge is intentional brand positioning and matches the trust posture of the target customer.

### 11.5 Invoicing and tax

Stripe Tax is enabled for Italian VAT (22%) on the dealer's location. Stripe generates and emails the fiscal invoice automatically; PDF copies are stored for download in the dashboard. For non-Italian customers (out-of-scope in Phase 1 but designed for) the same mechanism applies via Stripe's reverse-charge handling.

## 12. Compliance Subsystem (GDPR, AI Act, RPO)

### 12.1 Compliance is a first-class subsystem

Compliance is not a layer of validators bolted onto requests. It is a domain in the codebase (`lib/compliance`) with its own services, its own audit trail, and its own dashboards. This positioning reflects both its importance to the business risk profile and the fact that requirements will evolve continuously over the product's life.

### 12.2 RPO (Registro Pubblico delle Opposizioni) integration

Italian law requires verification of every B2C number against the RPO before placing a marketing call. Operationally there are two patterns to satisfy this:

**Per-list bulk verification.** The dealer-uploaded contact list is submitted in batch to the RPO via the official integration channel; the response (cleared/blocked per number) is cached in `rpo_snapshots`. Blocked numbers are marked in `contacts.rpo_status = 'blocked'` and excluded from all dispatch decisions.

**Per-call live verification.** Some campaigns may have short runtime and time-sensitive contacts; for these a per-call check is acceptable. The `rpo_snapshots` cache is consulted first; if the entry is missing or older than 30 days, a live RPO lookup is performed inline.

Phase 1 implements per-list bulk verification at upload time; per-call live verification is deferred. The `rpo_snapshots` cache TTL of 30 days is enforced by a daily cron that invalidates stale entries.

The integration with the RPO is mediated through a registered intermediary (one of the certified service providers) rather than directly, to avoid the operational and certification burden in the early stage. The intermediary's API is wrapped in a `RpoClient` adapter so that swapping providers (or moving to direct integration later) is contained.

B2B contacts (calling another business rather than a consumer) are not subject to RPO. The `contacts` table is extended with a `contact_type` field (`b2c` | `b2b`) defaulted to `b2c`; the dealer asserts the type at upload time and is responsible for the legal accuracy of that assertion. This is documented in the DPA.

### 12.3 AI Act transparency

EU Regulation 2024/1689 mandates that natural persons interacting with an AI system are informed they are doing so, unless this is obvious from context (it is not, for a phone call). The platform enforces this in three independent layers:

1. **System prompt enforcement.** Every script template's system prompt includes an immutable preamble appended by the adapter that instructs the agent to disclose its AI nature in the very first utterance, in plain Italian, before saying anything else.
2. **First-message override.** The `firstMessage` parameter passed to the orchestrator is also derived from a template that always includes the disclosure. Even if a template author tampered with the system prompt, the first thing the contact hears is the disclosure.
3. **Post-call audit.** The transcript classifier verifies that the disclosure was actually said. Calls where the disclosure is not detected are flagged in a quality dashboard and trigger an investigation.

The default disclosure text (in Italian) is approximately: _"Buongiorno, sono [nome] un assistente vocale automatico per conto di [concessionario]. La chiamata sarà gestita da un sistema di intelligenza artificiale. Ha qualche minuto?"_. This is reviewed annually by external counsel.

### 12.4 GDPR data handling

The platform acts as a Processor under GDPR (Art. 28); the dealer is the Controller of the contacts they upload. A standard DPA is signed at organisation creation (electronic signature, timestamped) and stored as an artefact accessible from the settings page. Processing is governed by the following rules baked into the system:

**Lawful basis transparency.** Each `contacts` row carries a `consent_basis` field whose value the dealer must select at upload time (consent, legitimate interest, existing customer, etc.). The dashboard reports aggregate consent-basis breakdowns to support the dealer's own GDPR record-keeping.

**Right to erasure.** A "delete contact" action in the dashboard performs a soft delete on the `contacts` row, scrubs any associated transcripts and recordings (replaced with tombstones), and writes an audit log entry. A periodic hard-delete job removes the soft-deleted rows after a 30-day grace period. Erasure of an entire organization is a manual operation requiring two-person approval, executed via a documented runbook.

**Right of access.** The dashboard exposes a self-service export per organization that produces a ZIP containing all contacts, calls, transcripts and recordings, in machine-readable format. This satisfies portability obligations and avoids manual support burden.

**Data minimisation.** Calls store only what is needed: phone number, recording URL, transcript URL, classification metadata, billing metadata. Free-text notes captured by the AI are limited to operationally relevant fields (appointment time, callback preference); the recording and transcript exist for audit but are not data-mined for unrelated purposes.

**Retention.** Default retention is 12 months for recordings and transcripts, configurable per organization. The `retention.purge` cron deletes assets past retention. The retention policy in force at the time of each call is recorded with the call so that the rules can change going forward without retroactive ambiguity.

### 12.5 Opt-out propagation

When a contact says "do not call me again" during a conversation, the LLM invokes the `register_opt_out` tool. The handler writes to the `opt_out_registry` (org-scoped) and to the `contacts` row (`opt_out = true`). Future dispatches consult both stores: any presence in `opt_out_registry` for the org's `phone_e164` aborts the dispatch with no call placed. Opt-outs can also be registered manually by the dealer (CSV upload of a do-not-call list) and via the inbound IVR described in §9.4.

### 12.6 Audit trail completeness

The `audit_log` table is the system's compliance memory. Every event with legal or business significance is recorded: organization creation, member invitations and role changes, DPA acceptance, contact uploads (with row counts and validation results), campaign launches, opt-outs, data exports, manual credit adjustments. Audit log entries are append-only at the database level (revoked DELETE/UPDATE permissions on the table from the application role) and replicated to a separate retention bucket.

## 13. Reporting, Recordings and Notifications

### 13.1 Daily report email

Every evening at 20:00 Europe/Rome, a per-organization Inngest job aggregates the day's activity and sends a single summary email per active organization. The email content includes: per-campaign call counts, completion rates, qualified-lead counts, booked appointments (with names and times), credit consumed, and a link back to the dashboard for details. The email also lists any operational warnings (campaigns that hit insufficient credit, CLIs that were rate-limited, calls that the AI flagged for human review).

The report is a React Email template, rendered server-side, sent via Resend with one transactional message per organization. Recipients are configurable per role: by default the org owner; admins and operators can opt in.

### 13.2 Real-time notifications

For events the dealer needs to know about immediately, the platform supports two channels:

**Email** for: appointment booked (with details), high-confidence qualified lead (with transcript link), low credit balance crossed, campaign completed, weekly summary.

**Webhook out** for: customers with technical capability who want to push events into their own CRM. A `webhooks_outgoing` table holds per-org subscriptions (URL, secret, event types). Outbound webhooks are signed (HMAC SHA-256) and retried with exponential backoff up to 24 hours.

Slack and Teams integrations are deferred past Phase 1.

### 13.3 Recording and transcript access

Recordings are stored in Supabase Storage in a private bucket (`recordings/{org_id}/{call_id}.mp3`). Access is granted only via short-lived signed URLs (default 15-minute TTL) issued by a Server Action that checks the requester's org membership. Recordings are streamed by the dashboard's audio player; downloads are permitted but logged.

Transcripts are stored similarly (`transcripts/{org_id}/{call_id}.json`). The format is a list of `{speaker, text, start_time_ms, end_time_ms}` segments. The dashboard renders the transcript synchronised with audio playback (clicking a transcript segment jumps the player) — a substantial UX improvement that takes a few hours to build.

Both assets are subject to the retention policy in §12.4.

## 14. Security and Multi-Tenancy

### 14.1 Authentication

Supabase Auth provides email + magic link as the primary mechanism and TOTP as the optional second factor. Sessions are JWT-based with 1-hour access tokens and 30-day refresh tokens. There is no password authentication in Phase 1; the lower friction and lower support cost outweigh the unfamiliarity for some users (who quickly adapt).

For programmatic access (used by Zapier/Make integrations and by future API customers), each user can issue scoped Personal Access Tokens (PATs) from a settings page. PATs are bearer tokens, hashed at rest, scoped to a specific organization and a set of capabilities (`read:contacts`, `write:campaigns`, etc.). The middleware accepts PATs in addition to session cookies and applies the same org-scoping rules.

### 14.2 Authorization

A four-role model is implemented at the application layer:

| Role       | Capabilities                                                      |
| ---------- | ----------------------------------------------------------------- |
| `owner`    | Full control including billing, member management, deletion       |
| `admin`    | Full operational control; cannot transfer ownership or delete org |
| `operator` | Create and run campaigns, upload contacts, view all results       |
| `viewer`   | Read-only access to dashboards and reports                        |

Permission checks are encapsulated in a `requireCapability(orgId, userId, capability)` helper called at the entry point of every Server Action. Role-to-capability mapping is centralised in a single module so that future role granularity is a focused change.

### 14.3 Multi-tenant isolation

Three independent layers enforce tenant isolation:

**Database (RLS).** Every org-scoped table has the policy described in §7.3. Connections used by user-facing requests run with `app.current_org_id` set, ensuring even a buggy query cannot return cross-tenant data.

**Service layer.** Every service function takes `orgId` as the first argument and uses it as a query filter. Callers receive `orgId` from middleware-validated context, never from request bodies.

**Storage.** Supabase Storage buckets use path-based policies (`{org_id}/...`) and the storage RLS engine enforces that signed URLs are issued only to authorised requesters.

A cross-tenant data leak would require the simultaneous failure of all three layers — a property the security review process explicitly tests.

### 14.4 Secrets management

Production secrets live in Vercel's environment variable store and in Supabase Vault for database-managed secrets. Local development uses a `.env.local` file (gitignored) populated from a 1Password shared vault. There are no secrets in the repository.

Long-lived API keys (Twilio, Stripe, ElevenLabs, OpenAI, Vapi) are rotated quarterly and immediately on personnel changes. The rotation runbook is documented in the internal engineering wiki.

### 14.5 Threat-model highlights

The most material threats and their mitigations:

**Stolen dealer credentials → bulk contact exfiltration.** Magic-link auth + optional MFA + suspicious-login email alerts + downloads logged in `audit_log`. Bulk export rate-limited and sent via signed-link email rather than direct download for batches over a threshold.

**Webhook forgery (fake Stripe payment to credit an organization).** All webhook handlers verify provider signatures before any processing; verification failure is logged and returns 403.

**Prompt injection through contact metadata.** Variables from contact metadata that flow into the LLM system prompt are sanitised (length capped, control characters stripped, instructions like "ignore previous instructions" pattern-matched and either escaped or rejected). The system prompt template itself is never assembled from untrusted input directly.

**Rogue insider running unauthorised campaigns.** Audit log records every campaign launch with actor identity. Anomaly detection (campaigns launched outside business hours, against contact lists not previously associated with the user) triggers alerts to org owners.

**Bypass of credit check leading to free service.** Credit reservation is performed inside the same transaction as campaign creation; the `credit_ledger` schema enforces idempotency on the reservation entry. A nightly reconciliation job verifies that the sum of charges and reservations matches the ledger.

## 15. Observability and Quality Monitoring

### 15.1 Logging

Structured JSON logs from every Next.js function and Inngest function are shipped to Axiom (or Better Stack as alternative). Log lines carry standard fields: `org_id`, `user_id`, `request_id`, `campaign_id`, `call_id` where applicable, plus event-specific fields. Cost-controlled retention (30 days hot, 90 days cold) is sufficient for incident investigation; the audit log handles long-term compliance retention separately.

### 15.2 Errors

Sentry captures exceptions from server, client and Inngest contexts. Source maps are uploaded on every deploy. Error grouping uses Sentry's defaults augmented with custom fingerprints for known error families (Vapi adapter timeouts, Stripe webhook failures). On-call alerting routes critical errors to a dedicated channel.

### 15.3 Metrics

Metrics fall into three families with different consumers:

**Engineering metrics.** Latency (p50, p95, p99) of Server Actions, webhook handlers, and Inngest functions; error rates; queue depths in Inngest; database connection pool saturation. Consumed by the engineering team through Vercel Analytics and Axiom dashboards.

**Voice quality metrics.** Per-call: agent response latency p95, conversation length, barge-in count, classification confidence distribution, transfer-to-human rate. Aggregated daily and trended weekly to detect regression after voice/LLM/orchestrator updates.

**Business metrics.** Daily active organizations, campaigns launched, calls completed, qualified-lead rate, top-up conversion, MRR-equivalent (rolling 30-day usage projected), churn (30-day no-recharge rate). These feed an internal dashboard the founder reviews weekly.

### 15.4 Alerting

Alerts are tiered by severity:

**Critical (page immediately).** Stripe webhook handler failing for >5 minutes; database unreachable; Vapi/Retell adapter error rate >10% over 15 minutes; Italian PSTN connectivity loss.

**High (notify within an hour).** Daily report job failed; retention purge failed; specific organization out of credit during active campaign; CLI spam-score crossed threshold.

**Informational (digest).** Slow queries, unusual usage patterns, new error groups in Sentry, low confidence in outcome classification.

### 15.5 Quality monitoring of calls

A separate quality monitoring dashboard surfaces calls that warrant human review: low classification confidence, mismatch between tool-driven and inferred outcomes, transcripts where the AI disclosure could not be verified, abnormal duration (very long or very short), customer complaints. Each call flagged here feeds back into a tuning loop: the engineering team listens, annotates, and uses the annotations to adjust prompts or template logic.

A weekly "voice health" review (initially by the founder, later by a customer success collaborator) samples 30–50 calls across organizations and rates them on a structured rubric (naturalness, goal achievement, compliance, error recovery). Trends inform monthly prompt iterations and quarterly orchestrator/voice-model evaluations.

## 16. Deployment, Environments and DevOps

### 16.1 Environments

Three environments are maintained:

**Development.** Per-developer local environment (Next.js dev server + Supabase local stack via Docker + Stripe CLI for webhook forwarding + Vapi/Retell test accounts). Disposable.

**Staging.** A full deployed environment on Vercel with its own Supabase project, its own Stripe test mode, and its own Vapi/Retell test orchestrator using real (cheap) Italian numbers for end-to-end verification. Used by the founder and any collaborators for pre-release validation. Realistic but no real customer data.

**Production.** The customer-facing environment. Deployed automatically from the `main` branch after CI passes.

Preview environments are created automatically by Vercel for every pull request, sharing the staging Supabase database in a schema-per-PR pattern (or, if simpler, all sharing the staging database with PR-specific row tagging — this is revisited based on actual use).

### 16.2 CI/CD pipeline

GitHub Actions handles CI. The pipeline on every pull request runs:

1. Lint (ESLint + Prettier) and type check (TypeScript strict).
2. Unit tests (Vitest) for service layer, adapters and pure functions.
3. Integration tests (Vitest + a transactional Postgres harness) for service + DB combinations.
4. End-to-end smoke tests (Playwright) for the three critical flows: signup, top-up, launch a campaign.
5. Drizzle migration plan check (verify migrations apply to a fresh staging clone with no errors).
6. Build the Next.js production bundle.

Merging to `main` triggers Vercel's deploy. Database migrations run as a dedicated GitHub Actions job that targets production after the deploy succeeds, gated by a manual approval the first time each migration runs.

### 16.3 Feature flags

Statsig or PostHog Feature Flags (cheaper for early stage) is used for gradual rollout of new features and for kill-switches. Flags are evaluated server-side in Server Actions and Inngest functions; client-side flags are limited to UI variations.

Specific Phase 1 flags worth maintaining: voice provider (vapi vs retell), classification model version, recording retention period, low-balance thresholds, per-org concurrency overrides.

### 16.4 Backup and disaster recovery

Supabase provides daily Postgres backups with point-in-time recovery (7-day window on the free tier, 30-day on paid). Storage is replicated. The recovery-time objective (RTO) is 4 hours for full service restoration; the recovery-point objective (RPO) is 1 hour for transactional data and 24 hours for storage assets.

A quarterly DR drill restores a production snapshot to a separate Supabase project and verifies that the application boots against it. The drill is documented with time-to-restore and any issues encountered.

### 16.5 Operational runbooks

A `runbooks/` directory in the repository (markdown) documents the procedures for: rotating a leaked credential, replaying webhook events, manually adjusting credit, processing a GDPR erasure request, escalating a Twilio incident, recovering from a partial-region Vercel outage. Each runbook is dated; runbooks not exercised in 6 months are flagged for review.

## 17. Phase 2 — Migration to Proprietary Voice Stack

### 17.1 Why migrate

By month 6 the platform will have meaningful production data: actual unit cost per minute, observed call quality, customer feedback on agent performance, and evidence of where Vapi or Retell is hitting limits — whether economic, technical, or strategic. Three motivations are likely to converge into a "build it ourselves" decision:

**Margin recapture.** Vapi/Retell add a margin on top of the underlying LLM, TTS and telephony costs (typically €0.03–0.05 per minute). At Phase 1 volumes this is irrelevant; at 50 paying customers each consuming 1,000+ minutes/month, this represents €1,500–2,500/month of pure margin lift available for negligible recurring engineering cost.

**Strategic dependency.** Vapi and Retell are themselves early-stage companies whose pricing, quality and continued existence are not under our control. Owning the orchestrator removes this dependency entirely.

**Product depth.** Custom barge-in tuning for Italian, dealer-specific voice cloning at scale, low-level conversation analytics, A/B testing at the audio-frame level — none of these are exposed by managed orchestrators in the form needed.

The decision criterion at month 6 is concrete: if any two of the three motivations (margin recapture > €1,500/month, observed quality issues that the orchestrator vendor cannot fix in 30 days, customer demand for a feature requiring orchestrator control) are met, Phase 2 begins.

### 17.2 Target architecture

The Phase 2 voice stack replaces the single "voice orchestrator" box from §3 with a small set of services owned by the platform:

```
                        ┌────────────────────────────────────────┐
                        │     Application (Next.js + Inngest)    │
                        └──────────────────┬─────────────────────┘
                                           │ adapter.createCall
                                           ▼
                        ┌────────────────────────────────────────┐
                        │       Conversation Orchestrator        │
                        │   (Node/TypeScript long-running)       │
                        │  ─ Maintains call state machine        │
                        │  ─ Bridges audio streams               │
                        │  ─ Invokes tools, classifies outcomes  │
                        └─────┬─────────────┬─────────────┬──────┘
                              │             │             │
                              ▼             ▼             ▼
                        ┌──────────┐  ┌──────────┐  ┌──────────────┐
                        │  OpenAI  │  │ ElevenLabs│  │ Telephony    │
                        │ Realtime │  │ Streaming │  │ SIP Gateway  │
                        │   API    │  │   TTS     │  │ (Twilio Voice│
                        └──────────┘  └──────────┘  │  SDK + SBC)  │
                                                    └──────────────┘
```

The Conversation Orchestrator is a Node.js service running on Fly.io (or Railway) — chosen over Vercel because it requires long-running connections (WebSocket to OpenAI, persistent SIP session via the telephony SDK) that serverless does not accommodate. The orchestrator is stateless across calls but stateful within a single call: it holds open three streams simultaneously (audio in from PSTN, audio out to PSTN via TTS, the LLM realtime session) and choreographs them.

### 17.3 Components to build

**Conversation state machine.** A typed state machine modelling the call lifecycle: `dialing` → `connected` → `agent_speaking` ↔ `caller_speaking` → `tool_invoking` → `transferring` | `wrapping_up` → `terminated`. Implemented with XState or a hand-rolled enum-based reducer. State transitions emit events that are persisted for observability.

**Audio pipeline.** Bidirectional. Inbound: SIP/RTP from the SBC → demuxed → resampled → fed to OpenAI Realtime as PCM16 or Opus. Outbound: ElevenLabs streaming TTS → buffered (small ring buffer to enable interruption) → resampled → muxed back to RTP. Latency budgets are explicit at every stage, with target end-to-end (caller silence → agent speaking) of <800ms p95.

**VAD and barge-in.** Voice Activity Detection runs on the inbound audio (Silero VAD or the OpenAI Realtime API's built-in VAD). When the caller starts speaking while the agent is mid-sentence, the outbound TTS buffer is flushed and the LLM is informed of the interruption. Italian conversational patterns (frequent overlap, fast "sì... sì... sì... vada avanti") are handled by tuning VAD sensitivity and minimum-speech-duration thresholds based on production samples.

**Answering machine detection.** A specialised classifier in the first 2–3 seconds of the call that distinguishes a human "Pronto?" from a voicemail greeting. Open-source AMD models (Silero, or a custom lightweight model trained on Italian voicemail samples collected in Phase 1) are evaluated against Twilio's own AMD as a baseline. The decision drives whether to engage the conversation, leave a (human-recorded) message, or hang up.

**LLM session management.** OpenAI Realtime API sessions are created per call with the system prompt, voice configuration and tool definitions. Tool invocations are intercepted, executed (book_appointment, register_opt_out, etc.), results returned to the LLM. Token usage is tracked per call for unit-cost accounting.

**Streaming TTS.** ElevenLabs Streaming TTS receives text chunks from the LLM as they arrive (sentence-by-sentence boundary detection) and starts synthesising before the LLM has finished its response. This is the single biggest latency win versus naive synthesise-then-play. Voice IDs are managed through a dedicated catalogue table; voice cloning for premium customers uses ElevenLabs Professional Voice Cloning.

**Telephony bridge.** Twilio Voice SDK's media-streams capability provides the SIP/RTP bridge into the orchestrator. The bridge exposes a WebSocket per active call. An Italian SBC continues to handle CLI presentation.

### 17.4 Migration strategy

The migration is executed in three phases with explicit go/no-go gates:

**Stage A — Parallel run, off-traffic.** The new orchestrator is built and tested entirely against synthetic and internal traffic. No production customer is affected. Calls placed via the new orchestrator are tagged in `calls.provider = 'proprietary'` and analysed for quality regressions. Duration: 4–6 weeks.

**Stage B — Opt-in production traffic.** A feature flag enables the new orchestrator for one or two volunteer customers (typically the most engaged early adopters). Their campaigns run on the new stack; quality metrics are reviewed daily; rollback to Vapi/Retell is one flag flip. Duration: 4–6 weeks.

**Stage C — Default for new campaigns, gradual cutover.** New campaigns default to the new orchestrator. Existing campaigns continue on Vapi/Retell until completion. Once 95% of weekly traffic is on the new stack and quality KPIs are at parity or better, Vapi/Retell is moved to fallback role. Duration: 4–6 weeks.

Total migration timeline: 12–18 weeks. The three-stage gating ensures that a quality issue in the new stack never affects more customers than is being actively monitored.

### 17.5 Risks specific to Phase 2

**Latency.** The single-system-image of Vapi/Retell hides a lot of latency engineering. Reaching <800ms p95 in Italian, on Italian PSTN, is a non-trivial milestone. Mitigation: invest early in measurement infrastructure; treat latency as the primary quality metric during Stages A and B; be willing to extend the migration timeline rather than ship with regressions.

**Operational burden.** A long-running stateful service is more operationally complex than the serverless Phase 1 stack. Mitigation: deploy on a managed platform (Fly.io / Railway) that handles process supervision, health checks, and rolling deploys; keep the orchestrator narrow in scope (it does only call management; nothing else creeps in); maintain the Vapi/Retell adapter as a permanent fallback even after migration completes.

**Voice quality regression.** Custom-tuned voice + custom barge-in is not automatically better than Vapi's defaults. Mitigation: blind A/B comparison with structured rubrics during Stage A; clear quantitative gates before promoting.

**Cost overshoot of the build itself.** Engineering hours required for Phase 2 are estimated at 8–12 weeks of one engineer, which is the largest single investment of the year. Mitigation: scope is held strictly to parity-with-fallback for Stage A; new features (voice cloning, custom analytics) are deferred to post-migration sprints to avoid scope creep.

### 17.6 Cost projection at Phase 2 maturity

Approximate per-minute cost decomposition once the proprietary stack is the default (figures in EUR, illustrative, to be confirmed against actual vendor invoices):

| Component                        | Phase 1 (via Vapi) | Phase 2 (proprietary) |
| -------------------------------- | ------------------ | --------------------- |
| Telephony (Twilio + Italian SBC) | €0.04              | €0.04                 |
| LLM (OpenAI Realtime)            | €0.10              | €0.09                 |
| TTS (ElevenLabs)                 | €0.05              | €0.05                 |
| Orchestrator infrastructure      | included           | €0.005                |
| Orchestrator vendor margin       | €0.04              | —                     |
| **Total cost per minute**        | **€0.23**          | **€0.185**            |
| Margin lift per minute           | —                  | **€0.045**            |

At 50 customers averaging 1,200 minutes/month (60,000 minutes total), the margin lift is approximately €2,700/month — enough to cover the engineering cost of Phase 2 within 4–6 months, after which it accrues to the bottom line.

---

## Appendix A — Environment Variables

Required variables for production deployment, grouped by domain. Values not committed; managed in Vercel and 1Password.

**Application.**
`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_APP_ENV` (`development|staging|production`), `INTERNAL_WEBHOOK_SECRET`.

**Supabase.**
`SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

**Database (Drizzle direct).**
`DATABASE_URL` (transaction pooler), `DATABASE_DIRECT_URL` (for migrations).

**Stripe.**
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_TEST`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_SCALE`.

**Voice provider (Phase 1).**
`VOICE_PROVIDER` (`vapi|retell`), `VAPI_API_KEY`, `VAPI_WEBHOOK_SECRET`, `RETELL_API_KEY`, `RETELL_WEBHOOK_SECRET`.

**Telephony.**
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TELNYX_API_KEY` (fallback), `SBC_TRUNK_ID`, `SBC_AUTH_USER`, `SBC_AUTH_PASS`.

**LLM and TTS (used directly in Phase 2; via orchestrator in Phase 1).**
`OPENAI_API_KEY`, `ELEVENLABS_API_KEY`.

**Email.**
`RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_REPLY_TO`.

**Observability.**
`SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `AXIOM_TOKEN`, `AXIOM_DATASET`.

**Inngest.**
`INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`.

**Compliance.**
`RPO_PROVIDER_API_KEY`, `RPO_PROVIDER_ENDPOINT`.

---

## Appendix B — Third-Party Accounts Checklist

Accounts to provision before development begins, with notes on tier and expected onboarding friction.

| Service                               | Tier needed at start              | Onboarding notes                                           |
| ------------------------------------- | --------------------------------- | ---------------------------------------------------------- |
| Vercel                                | Pro (~€20/mo)                     | Instant                                                    |
| Supabase                              | Pro (~€25/mo)                     | Instant                                                    |
| GitHub                                | Free                              | Instant                                                    |
| Stripe                                | Standard                          | Italian business verification 2–5 business days            |
| Twilio                                | Pay-as-you-go                     | Italian number purchase + KYC documents 5–15 business days |
| Italian SBC (Voiped or Messagenet)    | Business plan (~€50/mo + per-min) | Contract + documentation 5–10 business days                |
| Vapi or Retell                        | Pay-as-you-go                     | Instant; production-tier requires sales conversation       |
| OpenAI                                | Pay-as-you-go                     | Instant; usage-tier increase via support                   |
| ElevenLabs                            | Creator or Pro (€22–€99/mo)       | Instant                                                    |
| Inngest                               | Free → Team (~€20/mo)             | Instant                                                    |
| Resend                                | Free → Pro (~€20/mo)              | Domain verification 1 day                                  |
| Sentry                                | Team (~€26/mo)                    | Instant                                                    |
| Axiom or Better Stack                 | Free → small paid                 | Instant                                                    |
| RPO intermediary (certified provider) | Per-call or subscription          | 5–15 business days; commercial conversation required       |
| 1Password Business                    | (~€8/user/mo)                     | Instant                                                    |

Total monthly fixed cost at start, before usage-based services: approximately €170–250.

---

## Appendix C — Glossary

**AI Act.** Regulation (EU) 2024/1689 on Artificial Intelligence. Mandates transparency for AI-driven interactions with natural persons.

**AMD.** Answering Machine Detection. Classifier that distinguishes a human voice from a voicemail greeting at call answer.

**CLI.** Calling Line Identification. The phone number presented as the caller's identifier on the recipient's device.

**CSI.** Customer Satisfaction Index. Surveys mandated by automotive OEMs on dealer post-sale service quality.

**DPA.** Data Processing Agreement. Mandatory contract between Controller and Processor under GDPR Art. 28.

**E.164.** International phone-number format (`+39...` for Italian numbers).

**GDPR.** Regulation (EU) 2016/679, the general European data protection regulation.

**LLM.** Large Language Model. The system that generates the agent's responses.

**MRR.** Monthly Recurring Revenue. For a prepaid model this is approximated by trailing 30-day usage.

**RLS.** Row Level Security. PostgreSQL feature that filters rows accessible to a query based on session settings.

**RPO.** Registro Pubblico delle Opposizioni. Italian public registry of phone numbers opted out of marketing calls.

**SBC.** Session Border Controller. A network element that mediates between SIP networks and handles tasks like CLI presentation, codec translation, and security.

**SIP.** Session Initiation Protocol. The signalling protocol underlying most VoIP systems.

**TTS.** Text-to-Speech. The component that synthesises audio from the LLM's text output.

**VAD.** Voice Activity Detection. Real-time classification of audio frames as speech or silence; essential for barge-in and turn-taking.

---

_End of document._

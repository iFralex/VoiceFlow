# Plan: Master Index

## Overview

This index maps the 14 implementation plans for the Voice AI Outbound platform onto five sequential waves. Inside a wave plans are independent and can be worked in parallel; between waves a strict ordering applies. Each plan corresponds to one git branch; merging a branch into `main` requires its plan's Definition of Done to be satisfied. When all 14 plans are merged the system is production-ready and only requires populating `.env` secrets and final deploy.

## Context

Each plan file follows a uniform structure: branch name, wave, dependencies, overview, validation commands, numbered tasks with checkbox steps. The technical specification at `/docs/technical_spec.md` is the source of truth referenced from every plan; section numbers (e.g. §7.2, §11.1) always refer to that document. Reading the spec is a prerequisite for executing any plan.

## Validation Commands

- `ls docs/plans/*.md | wc -l` (must return 15: index + 14 plans)
- `grep -L "## Validation Commands" docs/plans/*.md` (must return empty: every plan has its validation section)
- `grep -L "Mark completed" docs/plans/*.md` (must return only `00-INDEX.md`)

### Task 1: Confirm wave structure understood by team

- [ ] Read this index end to end
- [ ] Read the Wave map below and the dependency graph
- [ ] Read the technical spec at `docs/technical_spec.md` cover to cover at least once
- [ ] Confirm working agreement: one branch per plan, plan filename = branch name
- [ ] Confirm working agreement: a plan's tasks are checked off in order; out-of-order completion is allowed only with comment
- [ ] Confirm working agreement: at end of each task the developer commits with `task(<plan-id>): <task-name>`
- [ ] Confirm working agreement: PR title format is `feat(<plan-id>): <plan-name>`
- [ ] Mark completed

### Task 2: Wave map and dependency graph

The five waves and their plans:

**Wave 1 — Foundation (week 1, parallel)**
Three plans bootstrap the workspace, the database, and the design system. Nothing else can start before all three are merged.

| File                               | Branch                               | Description                                                                                        |
| ---------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `01-foundation-repo-setup.md`      | `feat/01-foundation-repo-setup`      | Monorepo scaffolding, Next.js app, Vercel project, CI base, lint/format/typecheck, env scaffolding |
| `02-foundation-supabase-schema.md` | `feat/02-foundation-supabase-schema` | Supabase project, full Drizzle schema (16 tables), RLS policies, seed data, migration tooling      |
| `03-foundation-design-system.md`   | `feat/03-foundation-design-system`   | Tailwind, shadcn/ui, layout shell, navigation, theme tokens, IT/EN i18n scaffolding                |

**Wave 2 — Core platform (weeks 2–3, parallel after Wave 1)**
Four plans deliver everything a user can do with the product before any call is placed: log in, top up credit, upload contacts, configure scripts.

| File                            | Branch                            | Description                                                                                            |
| ------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `04-auth-and-organizations.md`  | `feat/04-auth-and-organizations`  | Supabase Auth (magic link), middleware, org/membership/role model, RLS context, member invites         |
| `05-billing-stripe-credits.md`  | `feat/05-billing-stripe-credits`  | Stripe Checkout, webhook idempotency, credit ledger service, packages, low-balance alerts, invoicing   |
| `06-contacts-and-csv-import.md` | `feat/06-contacts-and-csv-import` | CSV uploader, async parsing job, E.164 normalisation, dedup, contact list management, Storage policies |
| `07-scripts-and-templates.md`   | `feat/07-scripts-and-templates`   | Five script templates, variable JSON schema, per-org script editor wizard, AI-disclosure preamble      |

**Wave 3 — Voice engine (weeks 4–6, parallel after Wave 2)**
Four plans turn the platform into an actual outbound calling system.

| File                            | Branch                            | Description                                                                                          |
| ------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `08-voice-adapter-vapi.md`      | `feat/08-voice-adapter-vapi`      | `VoiceProvider` interface, Vapi adapter, Retell stub, webhook handler, outcome classification        |
| `09-campaign-engine-inngest.md` | `feat/09-campaign-engine-inngest` | Inngest dispatch chain, time-window enforcement, concurrency limits, retries, pause/cancel           |
| `10-telephony-cli-pool.md`      | `feat/10-telephony-cli-pool`      | Italian SBC integration, CLI pool table, rotation logic, spam-score watchdog, inbound IVR            |
| `11-compliance-rpo-aiact.md`    | `feat/11-compliance-rpo-aiact`    | RPO intermediary client, opt-out registry, AI Act enforcement layers, audit log, GDPR export/erasure |

**Wave 4 — UX completion (week 7, parallel after Wave 3)**
Two plans refine the customer-facing experience.

| File                               | Branch                               | Description                                                                                     |
| ---------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `12-dashboard-and-reporting.md`    | `feat/12-dashboard-and-reporting`    | Dashboard KPIs, campaign live view, recordings/transcript player, daily report email            |
| `13-notifications-and-webhooks.md` | `feat/13-notifications-and-webhooks` | Transactional emails, outbound webhooks (signed), low-balance alerts, appointment notifications |

**Wave 5 — Production readiness (week 8, sequential close-out)**
One plan to seal the system.

| File                             | Branch                             | Description                                                                                            |
| -------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `14-observability-and-launch.md` | `feat/14-observability-and-launch` | Sentry, Axiom, alerting tiers, feature flags, backup/DR drill, runbooks, smoke tests, launch checklist |

```
                      ┌──────────────────────────────────────────────┐
                      │                  WAVE 1                      │
                      │  01-repo-setup   02-schema   03-design       │
                      └─────────────────────┬────────────────────────┘
                                            ▼
                      ┌──────────────────────────────────────────────┐
                      │                  WAVE 2                      │
                      │  04-auth   05-billing   06-contacts   07-scripts │
                      └─────────────────────┬────────────────────────┘
                                            ▼
                      ┌──────────────────────────────────────────────┐
                      │                  WAVE 3                      │
                      │  08-voice   09-campaign   10-telephony   11-compliance │
                      └─────────────────────┬────────────────────────┘
                                            ▼
                      ┌──────────────────────────────────────────────┐
                      │                  WAVE 4                      │
                      │      12-dashboard         13-notifications   │
                      └─────────────────────┬────────────────────────┘
                                            ▼
                      ┌──────────────────────────────────────────────┐
                      │                  WAVE 5                      │
                      │           14-observability-and-launch        │
                      └──────────────────────────────────────────────┘
```

- [ ] Mark completed

### Task 3: Total effort and team allocation

Estimated effort assuming a single experienced full-stack TypeScript engineer:

| Wave      | Plans  | Solo dev time  | 2-dev parallel time |
| --------- | ------ | -------------- | ------------------- |
| 1         | 3      | 5–7 days       | 3–4 days            |
| 2         | 4      | 8–12 days      | 5–7 days            |
| 3         | 4      | 12–18 days     | 7–10 days           |
| 4         | 2      | 4–6 days       | 3–4 days            |
| 5         | 1      | 3–5 days       | 3–5 days            |
| **Total** | **14** | **32–48 days** | **21–30 days**      |

This aligns with the Phase 1 timeline of weeks 1–13 in the business plan, leaving margin for the dealer pilot programme described in §3 of the technical spec.

- [ ] Confirm timeline and team allocation are acceptable for the project schedule
- [ ] Mark completed

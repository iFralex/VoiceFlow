# Plan: Foundation — Repo, Tooling, Vercel, CI

**Branch:** `feat/01-foundation-repo-setup`
**Wave:** 1
**Depends on:** none
**Estimated effort:** 2–3 days

## Overview

Bootstraps the entire engineering workspace: Next.js 15 App Router project with TypeScript strict, package management, lint and format, type checking, Vitest and Playwright runners, Drizzle config (without yet defining the schema, that lives in plan 02), Vercel project, GitHub Actions CI, and the environment-variable scaffolding for every third-party service used in Phase 1. After this plan merges, every other plan can clone the repo and run `pnpm dev` against a working empty app.

## Context

The technical spec specifies Next.js 15 + App Router + TypeScript strict + Tailwind 4 + Drizzle + Vitest + Playwright + Vercel + GitHub Actions (§4, §5.1, §16.1, §16.2). Appendix A enumerates every required environment variable; this plan creates the scaffolding (`.env.example`, validated loader) but does not populate real secrets. Single Next.js application — no microservices, no separate worker process.

## Validation Commands

- `pnpm install`
- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm exec playwright --version`

### Task 1: Initialise repository and package manager

- [x] Create new GitHub repository (private), default branch `main`, branch protection requiring CI green
- [x] Add `LICENSE` (proprietary), `.gitignore` (Node + Next.js + IDEs + macOS + `.env*` except `.env.example`), `.gitattributes` for line endings
- [x] Add `README.md` with one-paragraph project summary, link to `docs/technical_spec.md`, link to `docs/plans/00-INDEX.md`
- [x] Add `.nvmrc` pinning Node 20 LTS
- [x] Create `pnpm-workspace.yaml` (single-package layout, but workspace-ready for future expansion)
- [x] Add `package.json` at root with name `VoiceFlow`, scripts `dev`, `build`, `start`, `lint`, `format`, `format:check`, `typecheck`, `test`, `test:watch`, `test:e2e`, `db:generate`, `db:migrate`, `db:push`, `db:studio`, `db:seed`
- [x] Add `corepack` instructions in README; commit `packageManager` field at pnpm 9.x
- [x] Mark completed

### Task 2: Scaffold Next.js 15 App Router project

- [x] Run `pnpm create next-app@latest .` with TypeScript, App Router, Tailwind, src directory, import alias `@/*`
- [x] Replace generated boilerplate with empty `app/(marketing)/page.tsx` displaying just a placeholder title
- [x] Add `app/layout.tsx` with `lang="it"` and a minimal HTML shell
- [x] Add `app/not-found.tsx` and `app/error.tsx` with placeholder content
- [x] Verify `pnpm dev` boots on port 3000 and the placeholder page renders
- [x] Verify `pnpm build` and `pnpm start` succeed
- [x] Mark completed

### Task 3: TypeScript strict configuration

- [x] Update `tsconfig.json` with `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`, `"noImplicitOverride": true`, `"noFallthroughCasesInSwitch": true`
- [x] Add path aliases for `@/*` (src), `@/db/*`, `@/lib/*`, `@/components/*`, `@/services/*`, `@/inngest/*`, `@/voice/*`
- [x] Add `tsc --noEmit` as `pnpm typecheck` script
- [x] Verify `pnpm typecheck` returns clean
- [x] Mark completed

### Task 4: ESLint + Prettier

- [x] Install ESLint with `eslint-config-next`, `@typescript-eslint/eslint-plugin`, `eslint-plugin-import`, `eslint-plugin-unused-imports`
- [x] Configure `.eslintrc.cjs` with rules: no unused vars (warn), no explicit any (warn), import order, prefer const, eqeqeq, no console (allow `warn`/`error`), exhaustive-deps for hooks
- [x] Install Prettier with `prettier-plugin-tailwindcss`
- [x] Add `.prettierrc` (printWidth 100, singleQuote, trailingComma all, tabWidth 2)
- [x] Add `.editorconfig` matching Prettier
- [x] Add `pnpm lint` and `pnpm format` and `pnpm format:check` scripts
- [x] Run lint and format on the entire repo, fix any issues
- [x] Mark completed

### Task 5: Source folder structure

- [x] Create skeleton folders matching tech spec §5.1: `src/app/(marketing)`, `src/app/(auth)`, `src/app/(app)`, `src/app/api/webhooks`, `src/app/api/cron`, `src/app/api/uploads`, `src/components/ui`, `src/lib/supabase`, `src/lib/db`, `src/lib/services`, `src/lib/inngest`, `src/lib/voice`, `src/lib/compliance`, `src/lib/stripe`, `src/lib/email`, `src/lib/storage`, `src/lib/utils`, `src/lib/auth`
- [x] Add a `README.md` inside `src/lib/` describing the layered architecture (domain → adapters → entrypoints) per spec §6.1
- [x] Add placeholder `index.ts` re-export files where needed to keep TS happy
- [x] Mark completed

### Task 6: Environment variable scaffolding

- [ ] Create `src/lib/env.ts` with a Zod-validated env loader following this pattern:

```typescript
import { z } from 'zod';
const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_APP_ENV: z.enum(['development', 'staging', 'production']),
  DATABASE_URL: z.string().url(),
  DATABASE_DIRECT_URL: z.string().url(),
  SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().startsWith('sk_'),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_'),
  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM_ADDRESS: z.string().email(),
  SENTRY_DSN: z.string().url().optional(),
  AXIOM_TOKEN: z.string().optional(),
  AXIOM_DATASET: z.string().optional(),
  INNGEST_EVENT_KEY: z.string().min(1),
  INNGEST_SIGNING_KEY: z.string().min(1),
  VOICE_PROVIDER: z.enum(['vapi', 'retell']).default('vapi'),
  VAPI_API_KEY: z.string().min(1).optional(),
  VAPI_WEBHOOK_SECRET: z.string().min(1).optional(),
  RETELL_API_KEY: z.string().min(1).optional(),
  RETELL_WEBHOOK_SECRET: z.string().min(1).optional(),
  TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  TELNYX_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  ELEVENLABS_API_KEY: z.string().min(1).optional(),
  RPO_PROVIDER_API_KEY: z.string().min(1).optional(),
  RPO_PROVIDER_ENDPOINT: z.string().url().optional(),
  INTERNAL_WEBHOOK_SECRET: z.string().min(32),
});
export const env = Env.parse(process.env);
```

- [ ] Create `.env.example` enumerating every variable above with placeholder values and inline comments
- [ ] Create `.env.local.example` for developer-local overrides
- [ ] Wire `env.ts` into `next.config.ts` via `import "./src/lib/env"` so misconfigured deploys fail at build
- [ ] Document in README the required minimum subset for `pnpm dev` to boot vs the full set for production
- [ ] Mark completed

### Task 7: Vitest unit and integration test runner

- [ ] Install Vitest, `@vitest/ui`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`
- [ ] Create `vitest.config.ts` with two projects: `unit` (jsdom env, `src/**/*.test.ts(x)`) and `integration` (node env, `src/**/*.integration.test.ts`)
- [ ] Create `src/test/setup.ts` with `@testing-library/jest-dom/vitest` import
- [ ] Add a sample passing unit test in `src/lib/utils/format.test.ts` (e.g. a phone formatter stub) so CI has something to run
- [ ] Configure coverage with v8 provider, output `coverage/`
- [ ] Add `pnpm test`, `pnpm test:watch`, `pnpm test:coverage` scripts
- [ ] Mark completed

### Task 8: Playwright end-to-end runner

- [ ] Install Playwright with `pnpm dlx create-playwright@latest --quiet`
- [ ] Configure `playwright.config.ts` to start the dev server on port 3000, run on Chromium only by default, retain traces on failure
- [ ] Create `e2e/smoke.spec.ts` with a single test that asserts the marketing page renders the placeholder title
- [ ] Add `pnpm test:e2e` script
- [ ] Mark completed

### Task 9: Drizzle ORM tooling (schema files arrive in plan 02)

- [ ] Install `drizzle-orm`, `drizzle-kit`, `postgres` (postgres-js driver)
- [ ] Create `drizzle.config.ts` pointing to `src/lib/db/schema/*.ts` and `drizzle/migrations`
- [ ] Create empty `src/lib/db/schema/index.ts` (will be populated by plan 02)
- [ ] Create `src/lib/db/client.ts` exporting a Drizzle client factory bound to `DATABASE_URL`:

```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '@/lib/env';
import * as schema from './schema';
const queryClient = postgres(env.DATABASE_URL, { prepare: false });
export const db = drizzle(queryClient, { schema });
export type DB = typeof db;
```

- [ ] Add scripts `db:generate` (drizzle-kit generate), `db:migrate` (custom migrate runner), `db:push` (drizzle-kit push for dev), `db:studio` (drizzle-kit studio)
- [ ] Mark completed

### Task 10: GitHub Actions CI pipeline

- [ ] Create `.github/workflows/ci.yml` that runs on every PR and push to `main`:
  - matrix Node 20 only
  - cache pnpm store and `~/.cache/ms-playwright`
  - install dependencies with `--frozen-lockfile`
  - run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build` in sequence
  - upload coverage report as artifact
- [ ] Create separate workflow `.github/workflows/e2e.yml` running on PR and on a schedule (nightly), executing `pnpm test:e2e` against a Vercel preview URL via `vercel-deploy-action`
- [ ] Add status badge to `README.md`
- [ ] Add a CODEOWNERS file (founder for the moment)
- [ ] Mark completed

### Task 11: Vercel project setup

- [ ] Create Vercel project linked to the GitHub repo
- [ ] Configure production branch as `main`; enable Preview Deployments for all PRs
- [ ] Add `vercel.json` with build command, output directory, and the cron jobs needed for §6.3 (paths only; handlers come later):

```json
{
  "crons": [
    { "path": "/api/cron/daily-report", "schedule": "0 19 * * *" },
    { "path": "/api/cron/retention-purge", "schedule": "0 3 * * *" },
    { "path": "/api/cron/cli-watchdog", "schedule": "0 2 * * *" },
    { "path": "/api/cron/aggregate-campaigns", "schedule": "*/5 * * * *" }
  ]
}
```

- [ ] In Vercel UI add the placeholder env vars defined in `.env.example` (production), with values to be filled later by founder
- [ ] Verify the first deploy succeeds and the placeholder page is live at the Vercel-assigned URL
- [ ] Mark completed

### Task 12: Documentation skeleton

- [ ] Create `docs/` directory; move/create the `technical_spec.md` (already authored separately)
- [ ] Create `docs/plans/` directory and place the index + 14 plan files (this plan and siblings)
- [ ] Create `docs/runbooks/` empty directory (populated in plan 14)
- [ ] Create `docs/architecture-decisions/` directory with `0001-monolith-nextjs.md` capturing the choice to keep everything in a single Next.js app
- [ ] Add a `CONTRIBUTING.md` describing the branch-per-plan model and PR conventions
- [ ] Mark completed

### Task 13: Pre-commit and editor hooks

- [ ] Install `husky` and `lint-staged`
- [ ] Configure `lint-staged` to run `eslint --fix` and `prettier --write` on staged TS/TSX/MD files
- [ ] Configure `husky` `pre-commit` hook to run `lint-staged` and `pnpm typecheck`
- [ ] Configure `husky` `commit-msg` hook to enforce conventional commits via `commitlint`
- [ ] Add `commitlint.config.cjs` with the conventional config and an additional rule allowing `task(<plan-id>)` scopes
- [ ] Mark completed

### Task 14: Repo-level Definition of Done

- [ ] All validation commands above pass locally and in CI
- [ ] First Vercel deploy from `main` is live
- [ ] `.env.example` enumerates every variable from spec Appendix A
- [ ] `pnpm dev` works for a developer who clones the repo, fills `.env.local` with placeholder values, and runs `pnpm install && pnpm dev`
- [ ] PR template exists at `.github/PULL_REQUEST_TEMPLATE.md` referencing the plan-completion checklist
- [ ] Mark completed

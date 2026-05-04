# CLAUDE.md — AI Knowledge Base

## Key Commands

- `pnpm dev` — start Next.js dev server
- `pnpm build` — production build (requires `SKIP_ENV_VALIDATION=true` in CI)
- `pnpm typecheck` — TypeScript strict check
- `pnpm lint` — ESLint
- `pnpm test` — unit tests (vitest, jsdom)
- `pnpm test:integration` — integration tests (requires Docker on port 5433)
- `pnpm test:e2e` — Playwright end-to-end tests (requires running app on port 3000)
- `pnpm db:generate` — generate Drizzle migration from schema changes
- `pnpm db:migrate` — apply all migrations via `DATABASE_DIRECT_URL` (not pooler)
- `pnpm db:seed` — upsert seed data (script templates + credit packages)

## Database Access Pattern (CRITICAL)

Every org-scoped database query must be wrapped in `withOrgContext`:

```ts
import { withOrgContext } from '@/lib/db/context';

await withOrgContext(orgId, async (tx) => {
  return tx.select().from(contacts).where(eq(contacts.org_id, orgId));
});
```

Cross-org / system operations use `withSystemContext`:

```ts
import { withSystemContext } from '@/lib/db/context';

await withSystemContext(async (tx) => {
  // cron jobs, retention sweeps, RPO bulk checks
});
```

Inside `(app)/` Server Components and Server Actions, use `dbForRequest()` which auto-resolves the org from middleware headers:

```ts
import { dbForRequest } from '@/lib/db/client';

const { orgId, withOrgContext } = await dbForRequest();
await withOrgContext(async (tx) => {
  return tx.select().from(contacts).where(eq(contacts.org_id, orgId));
});
```

An ESLint `no-restricted-syntax` rule enforces this: importing `db` directly inside `src/app/(app)/**` or `src/actions/**` is a lint error.

Calling the bare `db` client directly bypasses Row Level Security. Never do this in request handlers.

## Audit Logging

`recordAudit` must always be called with the transactional `tx`, inside a `withOrgContext` or `withSystemContext` block:

```ts
import { recordAudit } from '@/lib/db/audit';

await withOrgContext(orgId, async (tx) => {
  await recordAudit(tx, { actorType: 'user', action: 'contact.created', ... });
});
```

## Integration Tests

Integration tests use `withTestDb` from `src/test/db.ts`. This runs each test inside a transaction that is always rolled back — the database is never mutated.

```ts
import { withTestDb } from '@/test/db'; // or src/test/db

await withTestDb(async (tx) => {
  // tx is a rolled-back transaction; use it like any drizzle tx
});
```

Requires Docker: `docker compose -f infra/test/docker-compose.yml up -d`
Default connection: `postgresql://postgres:postgres@localhost:5433/vox_auto_test`

## Environment Validation

`src/lib/env.ts` validates all environment variables via Zod on startup. Set `SKIP_ENV_VALIDATION=true` to bypass in CI builds and test runners that don't have real secrets.

Contact import limits (optional, validated in `env.ts`):
- `CONTACTS_MAX_ROWS_PER_UPLOAD` — max rows per single CSV upload (default: 100,000)
- `CONTACTS_MAX_ROWS_PER_ORG` — max total non-deleted contacts per org (default: 1,000,000)

## Migration Naming

Migration files live in `drizzle/migrations/` as `000N_<slug>.sql`. All files must have a corresponding entry in `drizzle/migrations/meta/_journal.json` or they will not be applied by `pnpm db:migrate`. Hand-authored migrations (RLS policies, triggers, storage policies, realtime publications) must be added to the journal manually.

## Connections

- `DATABASE_URL` — pgBouncer pooler (port 6543); used by the app at runtime
- `DATABASE_DIRECT_URL` — direct Postgres (port 5432); used by `pnpm db:migrate` only
- `TEST_DATABASE_URL` — Docker test database (port 5433); used by integration tests

## i18n Conventions

Every UI string must pass through `next-intl`. No inline strings in components.

**Client component:**
```tsx
'use client';
import { useTranslations } from 'next-intl';

export function MyComponent() {
  const t = useTranslations('campaigns');
  return <p>{t('new_campaign')}</p>;
}
```

**Server component:**
```tsx
import { t } from '@/i18n/server';

export default async function MyPage() {
  const translate = await t('campaigns');
  return <h1>{translate('title')}</h1>;
}
```

Add all new string keys to **both** `src/i18n/locales/it.json` and `src/i18n/locales/en.json`. The test setup mock in `src/test/setup.ts` must also be updated with new namespaces/keys so unit tests continue to pass. See `docs/i18n.md` for the full guide.

Locale is resolved from the `locale` cookie (set by `src/actions/locale.ts`) via `src/middleware.ts` — no URL prefixes.

## Server Action Result Convention

All Server Actions that can fail must return `ActionResult` from `@/lib/utils/action-toast`:

```ts
import type { ActionResult } from '@/lib/utils/action-toast';

export async function myAction(): Promise<ActionResult> {
  try {
    // ...
    return { ok: true };
  } catch (e) {
    return { ok: false, message: 'Messaggio di errore' };
  }
}
```

Client components surface results as toasts:

```ts
import { toastResult } from '@/lib/utils/action-toast';

const result = await myAction();
toastResult(result); // shows success or error toast
```

For destructive actions, wrap the trigger in `<ConfirmDialog>` from `@/components/ui/confirm-dialog`.

## Library Layer Architecture

`src/lib/` is a three-layer architecture (see `src/lib/README.md`):
- **Adapters** (`db/`, `supabase/`, `stripe/`, `email/`, `inngest/`, `voice/`, `storage/`, `compliance/`, `auth/`) — wrap external SDKs
- **Services** (`services/`) — orchestrate multiple adapters; never called by adapters
- **Utils** (`utils/`) — pure functions, no side effects, usable at any layer

Rules:
1. Route handlers and Server Actions import from adapters and services, never directly from external SDKs.
2. `utils/` has no side effects and no imports from adapters.

## Theme

Theme switching uses `next-themes`. The `ThemeProvider` is in `src/components/providers.tsx` with `defaultTheme="light"`. Use `useTheme()` in client components. Do not apply theme classes manually.

## Shared UI Primitives

**Status badges:** Use `<StatusBadge status={...} />` from `@/components/ui/status-badge` for all status displays. It maps domain enum values (`CampaignStatus`, `CallStatus`, `PaymentStatus`, `OptOutStatus`, `RpoStatus`) to design-system colours automatically via the `status` i18n namespace. Labels are translated; pass `label` prop to override.

**Empty states:** Use `<EmptyState>` from `@/components/ui/empty-state` for empty-list and zero-data states.

**Suspense fallbacks:** Use skeletons from `@/components/ui/page-skeleton`:
- `<KpiRowSkeleton>` — row of KPI cards
- `<ListPageSkeleton>` — toolbar + rows + pagination
- `<DetailPageSkeleton>` — page header + body cards

**Data tables:** Use `<DataTable>` from `@/components/data-table`. Pass `rowCount` + `onStateChange` for server-side pagination; omit both for client-side.

## Auth Context

In Server Components and Server Actions inside `(app)/`, use `getAuthContext` to read the middleware-injected identity headers:

```ts
import { getAuthContext, requireCapability } from '@/lib/auth/context';

const { userId, orgId, role } = await getAuthContext();
```

Gate privileged operations with `requireCapability` (throws a Forbidden error if the role lacks the capability):

```ts
await requireCapability('members.invite');
```

Capability → role mapping (`src/lib/auth/context.ts`): `owner` has all capabilities; `admin` has all except `org.manage`; `operator` has campaign/contact/script/billing-view; `viewer` has billing/campaigns/audit read-only.

Contact capabilities (plan 06):
- `contacts.upload` — create contact lists, upload CSVs, trigger imports, mark opt-out; granted to `operator`+
- `contacts.delete` — soft-delete contacts; granted to `admin`+ only (`operator` does NOT have this)

## Supabase Clients

Three client factories in `src/lib/supabase/`:
- `createServerSupabaseClient()` — async, reads session cookies; use in Server Components, Server Actions, Route Handlers
- `supabaseAdmin` — service-role singleton, bypasses RLS; use only in trusted server contexts (auth triggers, membership invite). Never expose to the browser.
- `getSupabaseBrowserClient()` — singleton browser client for Client Components needing client-side auth state

# CLAUDE.md — AI Knowledge Base

## Key Commands

- `pnpm dev` — start Next.js dev server
- `pnpm build` — production build (requires `SKIP_ENV_VALIDATION=true` in CI)
- `pnpm typecheck` — TypeScript strict check
- `pnpm lint` — ESLint
- `pnpm test` — unit tests (vitest, jsdom)
- `pnpm test:integration` — integration tests (requires Docker on port 5433)
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

## Migration Naming

Migration files live in `drizzle/migrations/` as `000N_<slug>.sql`. All files must have a corresponding entry in `drizzle/migrations/meta/_journal.json` or they will not be applied by `pnpm db:migrate`. Hand-authored migrations (RLS policies, triggers, storage policies, realtime publications) must be added to the journal manually.

## Connections

- `DATABASE_URL` — pgBouncer pooler (port 6543); used by the app at runtime
- `DATABASE_DIRECT_URL` — direct Postgres (port 5432); used by `pnpm db:migrate` only
- `TEST_DATABASE_URL` — Docker test database (port 5433); used by integration tests

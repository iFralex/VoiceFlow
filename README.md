# VoiceFlow

VoiceFlow is an AI-powered voice outreach platform that enables sales teams to automate and personalise outbound calling campaigns using intelligent voice agents — combining real-time speech synthesis, CRM-style contact management, and campaign analytics in a single Next.js 16 application.

## Documentation

- [Technical Specification](docs/technical_spec.md) — full architecture, data model, and integration details
- [Plan Index](docs/plans/00-INDEX.md) — all implementation plans and their status

## Getting Started

### Prerequisites

- Node.js 20 LTS (see `.nvmrc`)
- [pnpm](https://pnpm.io/) 9.x (enabled via Corepack)

### Setup with Corepack

```bash
corepack enable
corepack prepare pnpm@latest --activate
```

### Installation

```bash
pnpm install
```

### Environment Variables

Copy `.env.example` to `.env.local` and fill in the required values.

**Minimum required for `pnpm dev`:**

- `NODE_ENV`
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_APP_ENV`
- `DATABASE_URL`
- `DATABASE_DIRECT_URL`
- `SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `RESEND_API_KEY`
- `EMAIL_FROM_ADDRESS`
- `INNGEST_EVENT_KEY`
- `INNGEST_SIGNING_KEY`
- `INTERNAL_WEBHOOK_SECRET`

**Full production set:** see `.env.example` for all variables including Stripe, Resend, voice providers, and observability integrations.

### Development

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Available Scripts

| Script              | Description                      |
| ------------------- | -------------------------------- |
| `pnpm dev`          | Start development server         |
| `pnpm build`        | Build for production             |
| `pnpm start`        | Start production server          |
| `pnpm lint`         | Run ESLint                       |
| `pnpm format`       | Format code with Prettier        |
| `pnpm format:check` | Check formatting without writing |
| `pnpm typecheck`    | Run TypeScript compiler check    |
| `pnpm test`         | Run unit and integration tests   |
| `pnpm test:watch`   | Run tests in watch mode          |
| `pnpm test:coverage`| Run tests with coverage report   |
| `pnpm test:e2e`     | Run Playwright end-to-end tests  |
| `pnpm db:generate`  | Generate Drizzle migration files |
| `pnpm db:migrate`   | Run database migrations          |
| `pnpm db:push`      | Push schema changes (dev only)   |
| `pnpm db:studio`    | Open Drizzle Studio              |
| `pnpm db:seed`      | Seed the database                |
| `pnpm db:seed --bump <slug>` | Publish new template version without overwriting existing scripts |

## Visual Regression Tests

Visual regression baselines are stored in `e2e/__snapshots__/`. They capture screenshots of key pages (marketing landing, login, app shell) and CI fails when pixel drift exceeds 2%.

### Generating baselines for the first time

Run the Playwright tests with `--update-snapshots` against a running app:

```bash
# Start the dev server (or use the built app with pnpm start)
pnpm dev &

# In another terminal, generate baseline screenshots
PLAYWRIGHT_BROWSERS_PATH=.playwright-browsers \
  pnpm exec playwright test e2e/visual.spec.ts --project chromium --update-snapshots

# Commit the generated snapshot files
git add e2e/__snapshots__
git commit -m "test: commit visual regression baselines"
```

### Updating baselines when intentional changes happen

After a deliberate UI change (design system update, layout tweak, etc.):

1. Make your code changes and verify them visually in the browser.
2. Re-generate the affected snapshots:

   ```bash
   pnpm exec playwright test e2e/visual.spec.ts --project chromium --update-snapshots
   ```

3. Review the diff in `e2e/__snapshots__/` — the updated PNG files should reflect only the intended change.
4. Commit the new baseline files alongside the code change:

   ```bash
   git add e2e/__snapshots__
   git commit -m "test: update visual baselines after <description of change>"
   ```

> **Tip:** Run `pnpm exec playwright show-report` after a failure to open an interactive diff report showing the expected vs. actual screenshots.

## CI Status

![CI](https://github.com/iFralex/VoiceFlow/actions/workflows/ci.yml/badge.svg)

## License

Proprietary — see [LICENSE](LICENSE).

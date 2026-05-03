# VoiceFlow

VoiceFlow is an AI-powered voice outreach platform that enables sales teams to automate and personalise outbound calling campaigns using intelligent voice agents — combining real-time speech synthesis, CRM-style contact management, and campaign analytics in a single Next.js 15 application.

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
| `pnpm test:e2e`     | Run Playwright end-to-end tests  |
| `pnpm db:generate`  | Generate Drizzle migration files |
| `pnpm db:migrate`   | Run database migrations          |
| `pnpm db:push`      | Push schema changes (dev only)   |
| `pnpm db:studio`    | Open Drizzle Studio              |
| `pnpm db:seed`      | Seed the database                |

## CI Status

![CI](https://github.com/iFralex/VoiceFlow/actions/workflows/ci.yml/badge.svg)

## License

Proprietary — see [LICENSE](LICENSE).

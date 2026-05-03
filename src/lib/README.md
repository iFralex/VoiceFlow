# src/lib — Layered Architecture

This directory implements a three-layer architecture as described in the technical spec §6.1:

## Layers

### Domain (innermost)

Pure business logic with no framework dependencies. Models, validation rules, and
domain services live here. Nothing in this layer imports from Next.js, ORMs, or
third-party SDKs.

### Adapters (middle)

Translates between the domain and external systems. Each subdirectory is an adapter
for one external concern:

- `db/` — Drizzle ORM client and schema re-exports
- `supabase/` — Supabase auth and storage client
- `stripe/` — Stripe billing client and webhook helpers
- `email/` — Resend email client
- `storage/` — Object storage abstraction (Supabase Storage)
- `inngest/` — Inngest background job client
- `voice/` — Voice provider adapter (Vapi / Retell)
- `compliance/` — GDPR/retention helpers
- `auth/` — Session and user identity helpers (wraps Supabase auth)

### Entrypoints (outermost)

Next.js route handlers, Server Actions, and React components consume adapters.
They must never import domain logic that bypasses adapters.

## Rules

1. Domain modules must not import from adapter modules.
2. Adapter modules may import from domain modules and from each other only when
   the dependency is acyclic.
3. Entrypoints (app/ routes, Server Actions) import from adapters, never from
   external SDKs directly.
4. `utils/` contains pure utility functions shared across all layers (no side effects).
5. `services/` contains cross-cutting application services that orchestrate multiple adapters.

## Directory Map

```
src/lib/
  auth/         Auth session helpers
  compliance/   Data retention and GDPR utilities
  db/           Drizzle client and schema
  email/        Email sending via Resend
  inngest/      Background job client
  services/     Cross-cutting application services
  storage/      Object storage helpers
  stripe/       Billing and subscription helpers
  supabase/     Supabase client factory
  utils/        Pure utility functions
  voice/        Voice provider integration
```

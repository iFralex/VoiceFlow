# ADR 0001: Single Next.js Application (No Microservices)

**Date:** 2026-05-03
**Status:** Accepted
**Deciders:** Founding engineer

## Context

VoiceFlow is a Phase 1 MVP targeting a small dealer network (under 50 concurrent organisations). We need to choose between a microservices/distributed architecture and a monolithic Next.js application.

The technical specification (§2, §4) explicitly states the guiding principles:

- Simplicity over premature abstraction
- One deployment unit for Phase 1
- Fast iteration speed for a small team

## Decision

Keep all application logic — API routes, background jobs (Inngest), database access (Drizzle), server actions, and frontend UI — inside a single Next.js 16 App Router application deployed to Vercel.

No separate worker service, no message broker, no separate API gateway.

## Consequences

**Positive:**

- Single `pnpm dev` command boots the entire system locally
- Single Vercel project; no cross-service network overhead or auth in Phase 1
- One TypeScript codebase; no schema duplication across services
- Inngest handles background job concerns (retries, concurrency, fan-out) without a separate process
- Drastically simpler CI/CD pipeline and deployment surface

**Negative / Accepted trade-offs:**

- Vertical scaling only (Vercel serverless auto-scales horizontally per-function, but the code unit is monolithic)
- Any future extraction into separate services requires refactoring module boundaries — mitigated by enforcing the layered architecture in `src/lib/` (domain → adapters → entrypoints, as described in `src/lib/README.md`)
- A long-running CPU-bound job would compete with web traffic on the same runtime — mitigated by offloading to Inngest workers which run in isolated Vercel function invocations

## Alternatives Considered

- **Separate Node.js worker process:** Rejected — adds deployment and secret-management complexity for Phase 1 scale
- **Turborepo monorepo with separate packages:** Rejected — premature; `pnpm-workspace.yaml` is already workspace-ready for a future extraction if warranted by traffic

## References

- Technical spec §2 (guiding principles), §4 (technology stack), §5.1 (frontend architecture), §6 (backend architecture)
- `src/lib/README.md` (layered architecture description)

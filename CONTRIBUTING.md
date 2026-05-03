# Contributing to VoiceFlow

## Branch-per-Plan Model

Each implementation plan in `docs/plans/` corresponds to exactly one git branch. This keeps PRs focused and reviewable.

- Branch name format: `feat/<plan-id>-<plan-slug>` (e.g. `feat/01-foundation-repo-setup`)
- One branch per plan; do not combine work from multiple plans in a single branch
- Plans within the same wave are independent and may be worked in parallel

## Workflow

1. Read the plan file (`docs/plans/<N>-<slug>.md`) end to end before starting
2. Read the technical spec (`docs/technical_spec.md`) for relevant sections referenced by the plan
3. Create your branch from `main`:
   ```bash
   git checkout main && git pull
   git checkout -b feat/<plan-id>-<plan-slug>
   ```
4. Complete plan tasks in order (tasks may be skipped out of order only with a comment in the plan file)
5. After each task, commit using the conventional format:
   ```
   feat(<plan-id>): <task-name>
   ```
   Example: `feat(01): initialise repository and package manager`
6. When all tasks are complete and the plan's Definition of Done is satisfied, open a PR

## Commit Message Format

This repository uses [Conventional Commits](https://www.conventionalcommits.org/).

```
<type>(<scope>): <description>

[optional body]
```

Allowed types: `feat`, `fix`, `chore`, `refactor`, `test`, `docs`, `ci`, `perf`, `style`

Allowed scopes: any plan ID (e.g. `01`, `02`, ..., `14`), `deps`, `config`, or omitted for cross-cutting changes

Examples:

- `feat(04): add Supabase Auth magic-link flow`
- `fix(09): correct Inngest retry backoff calculation`
- `chore(deps): bump drizzle-orm to 0.46`
- `docs: update CONTRIBUTING.md`

## Pull Request Conventions

- PR title format: `feat(<plan-id>): <plan-name>` — e.g. `feat(01): foundation repo setup`
- PR description must use the PR template (`.github/PULL_REQUEST_TEMPLATE.md`)
- All CI checks must pass before merge
- At least one approval from a CODEOWNER is required (see `.github/CODEOWNERS`)
- Squash merge preferred; the squash commit title should match the PR title

## Code Style

- TypeScript strict mode is enforced — no `any`, no implicit types
- Run `pnpm lint && pnpm format && pnpm typecheck` before pushing
- Tests are required for new business logic (`src/**/*.test.ts`)
- Integration tests live in `src/**/*.integration.test.ts`
- E2E tests live in `e2e/`

## Validation Before Opening a PR

Every plan specifies a set of Validation Commands. Run them all and confirm they pass:

```bash
pnpm install
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

## Architecture

The layered architecture is described in `src/lib/README.md`. Respect the boundary between domain logic (`src/lib/`), framework entrypoints (`src/app/`), and infrastructure adapters (`src/lib/<service>/`).

Significant architecture decisions are recorded in `docs/architecture-decisions/`.

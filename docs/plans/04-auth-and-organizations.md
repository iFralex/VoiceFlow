# Plan: Auth and Organizations

**Branch:** `feat/04-auth-and-organizations`
**Wave:** 2
**Depends on:** 01, 02, 03
**Estimated effort:** 3–5 days

## Overview

Implements the entire authentication, authorization and multi-tenant model described in spec §5.3, §14.1, §14.2 and §14.3. After this plan merges, a real human can sign up via magic link, create an organization, invite teammates with roles, and the application enforces RLS and capability checks on every request. This is the foundation every other Wave 2+ plan relies on for org context.

## Context

Supabase Auth with magic link is the primary authentication. The application keeps its own user mirror table (per spec §7.2) extended with locale and full name. Roles (`owner`, `admin`, `operator`, `viewer`) live in `memberships` rather than Supabase's built-in roles to keep the model flexible. Multi-tenant isolation is enforced at three layers: middleware (org resolution), service layer (explicit `orgId`), and database (RLS GUC). Personal Access Tokens are introduced for future programmatic access (Zapier/Make integrations) per spec §14.1.

## Validation Commands

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test src/lib/auth src/lib/services/organizations src/lib/services/memberships`
- `pnpm test:integration src/lib/auth`
- `pnpm test:e2e e2e/auth.spec.ts e2e/org.spec.ts`

### Task 1: Supabase client wrappers

- [ ] Create `src/lib/supabase/server.ts` with `createServerSupabaseClient()` that reads cookies via `next/headers` and returns an authenticated server client; uses anon key plus session cookie
- [ ] Create `src/lib/supabase/admin.ts` exporting `supabaseAdmin` using service role key — for trusted server-only operations (user creation hooks, manual support actions)
- [ ] Create `src/lib/supabase/browser.ts` returning a singleton browser client for client components needing realtime subscriptions
- [ ] Mark completed

### Task 2: Auth pages — login and signup

- [ ] Create `src/app/(auth)/login/page.tsx` with a single email input, "Invia link di accesso" button → calls `signInWithOtp`
- [ ] Create `src/app/(auth)/signup/page.tsx` mirroring login but recording the signup intent (we treat magic link signin and signup identically; new users get a fresh `users` row via the auth trigger in Task 4)
- [ ] Create `src/app/(auth)/verify/page.tsx` informing the user the link has been sent
- [ ] Create `src/app/auth/callback/route.ts` handling the magic-link redirect: exchanges the code for a session, then redirects to `/dashboard` (or to `/onboarding` if no organization)
- [ ] All pages use the marketing-layout shell (no sidebar)
- [ ] Form validation with Zod and React Hook Form; localised error messages
- [ ] Mark completed

### Task 3: Auth Server Actions

- [ ] `signInWithMagicLink(email)`: validates email, calls Supabase OTP, returns `{ ok: true }` or `{ ok: false, message }`
- [ ] `signOut()`: clears Supabase session and the `active_org_id` cookie, redirects to `/`
- [ ] `requestEmailChange(newEmail)`: triggers Supabase change-email flow (used by settings page later)
- [ ] All actions log to `audit_log` with action `auth.signin_requested` etc., even on failure (with sanitised data)
- [ ] Mark completed

### Task 4: User mirror table population

- [ ] In Supabase, create a Postgres function and trigger on `auth.users` AFTER INSERT that inserts a row in `public.users` with the same id and email; default locale `it`, full name from metadata if present
- [ ] Commit the SQL in `drizzle/migrations/0005_user_mirror_trigger.sql`
- [ ] Test by creating a user via Supabase dashboard and confirming the row appears in `public.users`
- [ ] Mark completed

### Task 5: Organization service

- [ ] Create `src/lib/services/organizations.ts` exposing:

```typescript
export async function createOrganization(input: {
  ownerId: string;
  name: string;
  legalName?: string;
  vatNumber?: string;
}): Promise<Organization>;

export async function getOrganization(orgId: string): Promise<Organization | null>;

export async function listOrganizationsForUser(userId: string): Promise<Organization[]>;

export async function updateOrganization(
  orgId: string,
  patch: Partial<Organization>,
): Promise<Organization>;

export async function softDeleteOrganization(orgId: string, byUserId: string): Promise<void>;
```

- [ ] `createOrganization` runs in a transaction: insert org, insert membership with role `owner` and `accepted_at = now()`, insert audit log entry, return organization
- [ ] All read operations use `withSystemContext` only when listing across orgs (e.g. `listOrganizationsForUser`); single-org reads use `withOrgContext`
- [ ] Validate VAT number format if provided (Italian P.IVA: 11 digits with checksum)
- [ ] Mark completed

### Task 6: Membership service

- [ ] Create `src/lib/services/memberships.ts` exposing:

```typescript
export async function inviteMember(
  orgId: string,
  byUserId: string,
  input: {
    email: string;
    role: MemberRole;
  },
): Promise<Membership>;

export async function acceptInvite(membershipId: string, userId: string): Promise<void>;

export async function listMembers(orgId: string): Promise<Array<Membership & { user: User }>>;

export async function updateMemberRole(
  orgId: string,
  byUserId: string,
  membershipId: string,
  newRole: MemberRole,
): Promise<void>;

export async function removeMember(
  orgId: string,
  byUserId: string,
  membershipId: string,
): Promise<void>;
```

- [ ] Authorisation guards: only `owner` and `admin` can invite or change roles; only `owner` can change another `owner`; you cannot demote yourself if you are the sole owner
- [ ] Inviting an existing user attaches them via `user_id`; inviting a new email creates an `auth.users` row via admin API and links it; both cases set `accepted_at` only after the invitee logs in for the first time
- [ ] Send invite email via Resend (template stub; full email plan is 13)
- [ ] Mark completed

### Task 7: Middleware — session and org resolution

- [ ] Create `src/middleware.ts` running on `/(app)/:path*` and `/api/:path*` (excluding webhooks):
  - read Supabase auth cookies
  - if no session → redirect to `/login` for app routes; 401 JSON for API routes
  - read `active_org_id` cookie; if missing or invalid (user not a member or not accepted), pick the first valid org; if user has no org → redirect to `/onboarding`
  - set request headers `x-user-id`, `x-org-id`, `x-member-role` consumed downstream
- [ ] Skip middleware for static assets, marketing pages, auth pages, webhook endpoints (signature-verified separately)
- [ ] Mark completed

### Task 8: Auth context helpers (Server Components)

- [ ] Create `src/lib/auth/context.ts` with:

```typescript
export async function getAuthContext(): Promise<{
  userId: string;
  orgId: string;
  role: MemberRole;
}> {
  const h = await headers();
  return {
    userId: h.get('x-user-id')!,
    orgId: h.get('x-org-id')!,
    role: h.get('x-member-role') as MemberRole,
  };
}

export async function requireCapability(capability: Capability): Promise<void>;
```

- [ ] Define capability list: `org.manage`, `members.invite`, `members.update_role`, `billing.topup`, `billing.view`, `campaigns.launch`, `campaigns.view`, `contacts.upload`, `contacts.delete`, `scripts.edit`, `compliance.export`, `compliance.erase`, `audit.view`
- [ ] Map roles → capabilities in a single module:
  - `owner` → all capabilities
  - `admin` → all except `org.manage` (delete, transfer ownership)
  - `operator` → `campaigns.*`, `contacts.upload`, `scripts.edit`, `billing.view`
  - `viewer` → `*.view` capabilities only
- [ ] Add unit tests for every role × capability pair
- [ ] Mark completed

### Task 9: Onboarding flow

- [ ] Create `src/app/(app)/onboarding/page.tsx` shown when a user has no organization
- [ ] Form fields: organization name (required), legal name (optional), VAT number (optional, validated), country (defaulted IT, locked in Phase 1)
- [ ] On submit: call `createOrganization` Server Action, set `active_org_id` cookie, redirect to `/dashboard`
- [ ] Display the DPA acceptance checkbox (text linked to `/legal/dpa`); persist `dpa_accepted_at` in the audit log when ticked + submitted
- [ ] Mark completed

### Task 10: Members management page

- [ ] Create `src/app/(app)/settings/members/page.tsx` listing current members with role badges, invite-pending status, last login (from `auth.users.last_sign_in_at`)
- [ ] "Invita membro" dialog: email + role select; calls `inviteMember`
- [ ] Per-member dropdown: change role, remove
- [ ] Empty state and pending-invites list separated
- [ ] Mark completed

### Task 11: Organization settings page

- [ ] Create `src/app/(app)/settings/organization/page.tsx` with form to edit name, legal name, VAT number; locale not relevant here (per-user)
- [ ] Show creation date, member count, organization id (for support reference)
- [ ] "Elimina organizzazione" button (owner only) → confirmation dialog requiring the org name to be typed; on confirm calls `softDeleteOrganization`; documented as soft delete with full purge happening via runbook (plan 11)
- [ ] Mark completed

### Task 12: Org switcher Server Action

- [ ] Add `setActiveOrg(orgId)` Server Action: validates membership, writes `active_org_id` cookie, returns `{ ok }`
- [ ] Wire to the `<OrgSwitcher>` component built in plan 03 (which currently has a stub)
- [ ] Mark completed

### Task 13: Personal Access Tokens (programmatic access scaffolding)

- [ ] Add migration `0006_personal_access_tokens.sql` creating `personal_access_tokens`: `id`, `user_id`, `org_id`, `name`, `token_hash` (sha256), `prefix` (first 8 chars for display), `scopes` text array, `last_used_at`, `expires_at`, `revoked_at`, `created_at`
- [ ] Drizzle schema entry; add to barrel
- [ ] Service `src/lib/services/pat.ts` with `createPat`, `revokePat`, `listPats`, `verifyPat(rawToken)` (returns the bound user/org/scopes or null)
- [ ] Settings UI page `/settings/integrations` listing existing PATs with name, prefix, last used, scopes, "Revoca" button; "Crea token" dialog returns the raw token once with copy-to-clipboard
- [ ] Extend middleware to accept `Authorization: Bearer <pat>` for `/api/*` routes (in addition to session cookies); attach `userId` and `orgId` from the PAT, deny if scopes do not match
- [ ] Mark completed

### Task 14: Suspicious-login email alert (foundation)

- [ ] Listen to Supabase `auth` events via webhook (configured at the dashboard level) sending to `/api/webhooks/supabase-auth`
- [ ] Verify signature, dedupe via `webhook_events`
- [ ] On `signin` event from a new IP/user-agent combination (compared against last 30 days), enqueue an email alert (template stub; full email in plan 13)
- [ ] Record the IP/UA fingerprint in a new `auth_signins` table (id, user_id, ip, user_agent, signed_in_at)
- [ ] Mark completed

### Task 15: RLS context wiring in Server Components

- [ ] Update `src/lib/db/client.ts` to expose `dbForRequest()` that resolves the org from middleware headers and wraps every operation in `withOrgContext` automatically
- [ ] All page Server Components and Server Actions inside `(app)/` use `dbForRequest()` instead of the bare `db`
- [ ] Add ESLint rule (custom or comment-based) flagging direct `db.query.*` usage inside `(app)/` server code
- [ ] Mark completed

### Task 16: Integration tests for multi-tenant isolation

- [ ] Test scenarios in `src/lib/auth/multitenancy.integration.test.ts`:
  - User A in Org 1 cannot SELECT contacts of Org 2 even with raw SQL through the request-bound client
  - User A who is not a member cannot read Org 1
  - Service-role context can read across orgs (used by cron jobs)
  - PAT scoped to Org 1 cannot mutate Org 2 even if user has access to both
- [ ] Mark completed

### Task 17: E2E auth flow

- [ ] Playwright `e2e/auth.spec.ts`: sign up via magic link (using Supabase Inbucket-style local mail catcher), land on onboarding, create org, see dashboard
- [ ] Playwright `e2e/org.spec.ts`: invite member, accept invite as second user, switch active org, change role, remove member
- [ ] Mark completed

### Task 18: Definition of Done

- [ ] Magic-link signin works end to end
- [ ] User signing up with no org lands on onboarding; creating an org leads to dashboard
- [ ] Member invite + accept flow works including emails
- [ ] All four roles enforce capabilities correctly (unit + e2e tests green)
- [ ] Cross-org isolation tests pass
- [ ] Personal Access Tokens can be created, used, and revoked
- [ ] All actions write to `audit_log` (verified by integration tests)
- [ ] Mark completed

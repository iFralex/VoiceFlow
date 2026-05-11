# Runbook: Feature Flags

Feature flags are managed in [PostHog](https://eu.posthog.com) under the **VoiceFlow** project.

## Available Flags

| Key | Default | Purpose |
|-----|---------|---------|
| `voice.proprietary-stack` | off | Phase 2 canary — proprietary voice stack |
| `internal.test_call` | on (staging), off (prod) | Gates the test-call endpoint (plan 08) |
| `dashboard.cmd-k-search` | on | ⌘K global search widget; quick kill-switch |
| `compliance.aiact-monthly-audit` | on | Monthly AI Act compliance audit cron |
| `email.weekly-summary` | on | Weekly email digest; disable on Mondays if overrun |
| `internal.disclosure-failures-page` | off | Disclosure-failures admin page; off until QA mature |

## How to Flip a Flag

1. Log in to the PostHog dashboard at <https://eu.posthog.com>.
2. Navigate to **Feature Flags** in the left sidebar.
3. Find the flag by key (use the search box).
4. Toggle **Enabled / Disabled** or edit rollout percentage / release conditions.
5. Click **Save** — the change propagates to the server within ~30 s (one PostHog polling interval).

## Targeting Specific Organisations

Flags can be scoped to a subset of orgs via PostHog release conditions:

1. Edit the flag → **Release conditions**.
2. Add a condition: **property** `org_id` **is** `<orgId>`.
3. Set percentage to **100%** for that cohort.

The server-side call uses `orgId` as the PostHog distinct-id so org-level targeting works out of the box.

## Rollout Procedure for a New Flag

1. Add the flag key to `src/lib/feature-flags/flags.ts` (`FLAGS` object).
2. Open the PostHog dashboard and create the flag with the same key.
3. Set the default rollout to the desired percentage (start at 0% for risky features, 100% for safe defaults).
4. Deploy the code change.
5. Flip the flag in PostHog when ready.

## Rollback Procedure

1. In PostHog, disable the flag immediately (set to 0% or toggle off).
2. Propagation is ~30 s — no deployment required.
3. If the issue is in the flag-evaluation code itself, revert the relevant commit and redeploy.

## Removing a Flag

Once a flag is retired (feature fully launched or removed):

1. Delete the flag from the PostHog dashboard.
2. Remove its constant from `src/lib/feature-flags/flags.ts`.
3. Remove all `isFlagEnabled` / `useFlag` call-sites from the codebase.
4. Open a PR; the TypeScript compiler will surface any forgotten references.

## Environment Setup

Add the following to `.env.local` (and Vercel environment variables):

```
NEXT_PUBLIC_POSTHOG_KEY=phc_...        # Project API key from PostHog settings
NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com   # EU cloud endpoint
```

When `NEXT_PUBLIC_POSTHOG_KEY` is absent, all `isFlagEnabled` calls return their `defaultValue` and no network requests are made.

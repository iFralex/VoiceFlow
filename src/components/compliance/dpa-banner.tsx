import { headers } from 'next/headers';

import { getDpaStatus } from '@/lib/compliance/dpa';
import { logger } from '@/lib/observability/logger';

import { DpaBannerClient } from './dpa-banner-client';

/**
 * Server-rendered DPA acceptance banner shown in the app layout when the
 * active org's latest accepted DPA version differs from the current version
 * (or no acceptance row exists at all). Resolves the active org id from the
 * middleware-injected `x-org-id` header; renders nothing when:
 *
 *   - the request has no `x-org-id` (e.g. onboarding), or
 *   - the org's most recent acceptance matches `CURRENT_DPA_VERSION`.
 */
export async function DpaBanner() {
  const h = await headers();
  const orgId = h.get('x-org-id');
  if (!orgId) return null;

  // Degrade silently on a transient DB hiccup. The compliance gate at
  // `launchCampaign` still blocks campaign launches, so hiding the banner here
  // is a UX-only nudge — letting an exception propagate would otherwise crash
  // the entire app shell via the nearest error boundary.
  let status;
  try {
    status = await getDpaStatus(orgId);
  } catch (err) {
    void logger.error('[dpa-banner] failed to resolve status', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
  if (status.state === 'current') return null;

  return (
    <DpaBannerClient
      state={status.state}
      acceptedVersion={status.state === 'outdated' ? status.record.version : null}
      currentVersion={status.currentVersion}
    />
  );
}

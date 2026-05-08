import { headers } from 'next/headers';

import { getDpaStatus } from '@/lib/compliance/dpa';

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

  const status = await getDpaStatus(orgId);
  if (status.state === 'current') return null;

  return (
    <DpaBannerClient
      state={status.state}
      acceptedVersion={status.state === 'outdated' ? status.record.version : null}
      currentVersion={status.currentVersion}
    />
  );
}

import { cookies, headers } from 'next/headers';
import { Suspense, type ReactNode } from 'react';

import { SentryUserSync } from '@/components/app/sentry-user-sync';
import { Shell } from '@/components/app/shell';
import { DpaBanner } from '@/components/compliance/dpa-banner';
import { ListPageSkeleton } from '@/components/ui/page-skeleton';
import { Toaster } from '@/components/ui/sonner';
import { setSentryUser } from '@/lib/observability';
import { listOrganizationsForUser } from '@/lib/services/organizations';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const h = await headers();
  const userId = h.get('x-user-id');
  const orgId = h.get('x-org-id');
  const activeOrgId = (await cookies()).get('active_org_id')?.value ?? null;

  if (userId && orgId) {
    setSentryUser(userId, orgId);
  }

  const orgs = userId ? await listOrganizationsForUser(userId) : [];

  return (
    <>
      {userId && orgId && <SentryUserSync userId={userId} orgId={orgId} />}
      <Shell orgs={orgs} activeOrgId={activeOrgId}>
        <Suspense fallback={null}>
          <DpaBanner />
        </Suspense>
        <Suspense fallback={<ListPageSkeleton />}>{children}</Suspense>
      </Shell>
      <Toaster />
    </>
  );
}

import { cookies, headers } from 'next/headers';
import { Suspense, type ReactNode } from 'react';

import { Shell } from '@/components/app/shell';
import { ListPageSkeleton } from '@/components/ui/page-skeleton';
import { Toaster } from '@/components/ui/sonner';
import { listOrganizationsForUser } from '@/lib/services/organizations';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const h = await headers();
  const userId = h.get('x-user-id');
  const activeOrgId = (await cookies()).get('active_org_id')?.value ?? null;

  const orgs = userId ? await listOrganizationsForUser(userId) : [];

  return (
    <>
      <Shell orgs={orgs} activeOrgId={activeOrgId}>
        <Suspense fallback={<ListPageSkeleton />}>{children}</Suspense>
      </Shell>
      <Toaster />
    </>
  );
}

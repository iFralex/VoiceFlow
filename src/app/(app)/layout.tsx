import { Suspense, type ReactNode } from 'react';

import { Shell } from '@/components/app/shell';
import { ListPageSkeleton } from '@/components/ui/page-skeleton';
import { Toaster } from '@/components/ui/sonner';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Shell>
        <Suspense fallback={<ListPageSkeleton />}>{children}</Suspense>
      </Shell>
      <Toaster />
    </>
  );
}

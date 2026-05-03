import type { ReactNode } from 'react';

import { Shell } from '@/components/app/shell';
import { Toaster } from '@/components/ui/sonner';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Shell>{children}</Shell>
      <Toaster />
    </>
  );
}

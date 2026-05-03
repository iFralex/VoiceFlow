import type { ReactNode } from 'react';

import { MarketingFooter } from '@/components/marketing/footer';
import { MarketingNav } from '@/components/marketing/nav';

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingNav />
      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-6 py-12">{children}</div>
      </main>
      <MarketingFooter />
    </div>
  );
}

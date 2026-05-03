import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Icons } from '@/components/ui/icon';

export function MarketingNav() {
  return (
    <header
      data-testid="marketing-nav"
      className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 font-semibold" aria-label="VoiceFlow home">
          <Icons.Phone size={20} className="text-primary" />
          <span className="text-base">VoiceFlow</span>
        </Link>

        {/* CTA */}
        <nav aria-label="Navigazione marketing">
          <Button asChild size="sm">
            <Link href="/login">Accedi</Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}

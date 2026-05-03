'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Icons } from '@/components/ui/icon';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils/index';

interface TopBarProps {
  onMobileMenuClick: () => void;
  className?: string;
}

export function TopBar({ onMobileMenuClick, className }: TopBarProps) {
  return (
    <header
      data-testid="app-topbar"
      className={cn(
        'flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4',
        className,
      )}
    >
      {/* Mobile hamburger */}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 md:hidden"
        onClick={onMobileMenuClick}
        aria-label="Apri menu"
      >
        <Icons.Menu size={18} />
      </Button>

      {/* Page title / breadcrumbs slot */}
      <div className="flex flex-1 items-center gap-2">
        {/* Children can inject a page title via a context or portal in a future task */}
        <PageTitleSlot />
      </div>

      <div className="flex items-center gap-1">
        {/* Search command palette trigger — stub, wired in Task 9 */}
        <Button
          variant="ghost"
          size="sm"
          className="hidden h-8 gap-2 text-sm text-muted-foreground md:flex"
          aria-label="Apri ricerca (Cmd+K)"
        >
          <Icons.Search size={14} />
          <span>Cerca...</span>
          <kbd className="ml-1 hidden rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground md:inline">
            ⌘K
          </kbd>
        </Button>

        <Separator orientation="vertical" className="mx-1 h-5" />

        {/* Credit balance pill — stub, wired in Task 8 */}
        <CreditPillStub />

        {/* Notifications — stub */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label="Notifiche"
        >
          <Icons.Bell size={16} />
        </Button>

        {/* User menu — stub, wired in Task 10 */}
        <UserMenuStub />
      </div>
    </header>
  );
}

/** Slot for pages to inject their title/breadcrumbs — wired in Task 12 via context */
function PageTitleSlot() {
  return <span className="sr-only" aria-hidden />;
}

/** Stub credit pill — replaced by real component in Task 8 */
function CreditPillStub() {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 gap-1.5 rounded-full px-3 text-xs"
      aria-label="Saldo crediti"
    >
      <Icons.CreditCard size={13} />
      <span className="font-medium">— min</span>
    </Button>
  );
}

/** Stub user menu — replaced by real dropdown in Task 10 */
function UserMenuStub() {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 rounded-full"
      aria-label="Menu utente"
    >
      <Icons.UserCircle2 size={18} />
    </Button>
  );
}

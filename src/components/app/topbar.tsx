'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Icons } from '@/components/ui/icon';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils/index';

import { CommandPalette, useCommandPaletteShortcut } from './command-palette';
import { type CreditBalance, CreditPill, CreditPillSkeleton } from './credit-pill';
import { UserMenu, type UserInfo } from './user-menu';

interface TopBarProps {
  onMobileMenuClick: () => void;
  /** Credit balance passed from a server-rendered parent; undefined while loading */
  creditBalance?: CreditBalance;
  /** User info passed from a server-rendered parent; undefined while loading */
  user?: UserInfo;
  className?: string;
}

export function TopBar({ onMobileMenuClick, creditBalance, user, className }: TopBarProps) {
  const [cmdOpen, setCmdOpen] = React.useState(false);
  const t = useTranslations('common');
  useCommandPaletteShortcut(React.useCallback(() => setCmdOpen(true), []));

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
        aria-label={t('open_menu')}
      >
        <Icons.Menu size={18} />
      </Button>

      {/* Page title / breadcrumbs slot */}
      <div className="flex flex-1 items-center gap-2">
        {/* Children can inject a page title via a context or portal in a future task */}
        <PageTitleSlot />
      </div>

      <div className="flex items-center gap-1">
        {/* Command palette */}
        <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />

        {/* Search command palette trigger */}
        <Button
          variant="ghost"
          size="sm"
          className="hidden h-8 gap-2 text-sm text-muted-foreground md:flex"
          aria-label={t('search_label')}
          onClick={() => setCmdOpen(true)}
          data-testid="cmd-trigger"
        >
          <Icons.Search size={14} />
          <span>{t('search_placeholder')}</span>
          <kbd className="ml-1 hidden rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground md:inline">
            ⌘K
          </kbd>
        </Button>

        <Separator orientation="vertical" className="mx-1 h-5" />

        {/* Credit balance pill */}
        {creditBalance !== undefined ? (
          <CreditPill balance={creditBalance} />
        ) : (
          <CreditPillSkeleton />
        )}

        {/* Notifications — stub */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={t('notifications')}
        >
          <Icons.Bell size={16} />
        </Button>

        {/* User menu */}
        <UserMenu {...(user !== undefined ? { user } : {})} />
      </div>
    </header>
  );
}

/** Slot for pages to inject their title/breadcrumbs — wired in Task 12 via context */
function PageTitleSlot() {
  return <span className="sr-only" aria-hidden />;
}

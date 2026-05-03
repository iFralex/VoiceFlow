'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

import { PRIMARY_NAV_ITEMS } from './nav';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const t = useTranslations('common');
  const tNav = useTranslations('nav');

  function handleSelect(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('command_palette_title')}
      description={t('command_palette_description')}
    >
      <Command>
        <CommandInput placeholder={t('command_palette_placeholder')} />
        <CommandList>
          <CommandEmpty>{t('command_palette_no_results')}</CommandEmpty>
          <CommandGroup heading={t('command_palette_nav_group')}>
            {PRIMARY_NAV_ITEMS.map(({ href, labelKey, icon: Icon }) => (
              <CommandItem
                key={href}
                value={tNav(labelKey)}
                onSelect={() => handleSelect(href)}
                data-testid={`cmd-nav-${href.slice(1)}`}
              >
                <Icon />
                <span>{tNav(labelKey)}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

// ---------------------------------------------------------------------------
// Hook: registers the global cmd+K / ctrl+K shortcut
// Call in the component that owns the `open` state (TopBar).
// ---------------------------------------------------------------------------
export function useCommandPaletteShortcut(onOpen: () => void) {
  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpen();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onOpen]);
}

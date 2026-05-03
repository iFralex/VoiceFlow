'use client';

import { useRouter } from 'next/navigation';
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
import { Icons } from '@/components/ui/icon';

// ---------------------------------------------------------------------------
// Static navigation actions — Phase 1
// Full data-search comes in plan 12
// ---------------------------------------------------------------------------
const NAV_ACTIONS = [
  { href: '/dashboard', label: 'Dashboard', shortcut: undefined, Icon: Icons.LayoutDashboard },
  { href: '/campagne', label: 'Campagne', shortcut: undefined, Icon: Icons.Megaphone },
  { href: '/contatti', label: 'Contatti', shortcut: undefined, Icon: Icons.Users },
  { href: '/script', label: 'Script', shortcut: undefined, Icon: Icons.FileText },
  { href: '/credito', label: 'Credito', shortcut: undefined, Icon: Icons.CreditCard },
  { href: '/impostazioni', label: 'Impostazioni', shortcut: undefined, Icon: Icons.Settings },
] as const;

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();

  function handleSelect(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Ricerca rapida"
      description="Cerca azioni e naviga nell'applicazione"
    >
      <Command>
        <CommandInput placeholder="Cerca azioni..." />
        <CommandList>
          <CommandEmpty>Nessun risultato trovato.</CommandEmpty>
          <CommandGroup heading="Navigazione">
            {NAV_ACTIONS.map(({ href, label, Icon }) => (
              <CommandItem
                key={href}
                value={label}
                onSelect={() => handleSelect(href)}
                data-testid={`cmd-nav-${href.slice(1)}`}
              >
                <Icon />
                <span>{label}</span>
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

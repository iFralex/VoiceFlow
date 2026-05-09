'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { searchPaletteAction } from '@/actions/search';
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
import type { PaletteSearchResults } from '@/lib/services/search';

import { PRIMARY_NAV_ITEMS } from './nav';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface QuickAction {
  href: string;
  labelKey: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const QUICK_ACTIONS: QuickAction[] = [
  { href: '/campaigns/new', labelKey: 'create_campaign', icon: Icons.Plus },
  { href: '/contacts/upload', labelKey: 'upload_contacts', icon: Icons.Upload },
  { href: '/credit/topup', labelKey: 'topup_credit', icon: Icons.CreditCard },
  { href: '/settings', labelKey: 'goto_settings', icon: Icons.Settings },
];

const DEBOUNCE_MS = 200;

function formatContactLabel(c: PaletteSearchResults['contacts'][number]): string {
  const name = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  return name.length > 0 ? `${name} · ${c.phone}` : c.phone;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const t = useTranslations('common');
  const tNav = useTranslations('nav');

  const [query, setQuery] = React.useState('');
  const [debouncedQuery, setDebouncedQuery] = React.useState('');
  const [results, setResults] = React.useState<PaletteSearchResults | null>(null);

  // Reset query and results when the dialog closes so the next open starts fresh.
  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!next) {
        setQuery('');
        setDebouncedQuery('');
        setResults(null);
      }
      onOpenChange(next);
    },
    [onOpenChange],
  );

  // Debounce the query before firing the server action. setDebouncedQuery
  // runs inside the timer callback (asynchronous) — not synchronously in the
  // effect body — so it does not trigger cascading renders.
  React.useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  // Fire the server search whenever the debounced query changes. setResults
  // runs inside the Promise.then callback — also asynchronous.
  React.useEffect(() => {
    if (debouncedQuery.length === 0) return;
    let cancelled = false;
    void searchPaletteAction({ query: debouncedQuery }).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setResults(res.results);
      } else {
        setResults({ contacts: [], campaigns: [], scripts: [] });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  const handleSelect = React.useCallback(
    (href: string) => {
      handleOpenChange(false);
      router.push(href);
    },
    [handleOpenChange, router],
  );

  const showResults = debouncedQuery.length > 0 && results !== null;
  const hasContacts = showResults && results.contacts.length > 0;
  const hasCampaigns = showResults && results.campaigns.length > 0;
  const hasScripts = showResults && results.scripts.length > 0;

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t('command_palette_title')}
      description={t('command_palette_description')}
    >
      <Command>
        <CommandInput
          placeholder={t('command_palette_placeholder')}
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>{t('command_palette_no_results')}</CommandEmpty>

          <CommandGroup heading={t('command_palette_nav_group')}>
            {PRIMARY_NAV_ITEMS.map(({ href, labelKey, icon: Icon }) => (
              <CommandItem
                key={href}
                value={`nav:${tNav(labelKey)}`}
                onSelect={() => handleSelect(href)}
                data-testid={`cmd-nav-${href.slice(1)}`}
              >
                <Icon />
                <span>{tNav(labelKey)}</span>
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandGroup heading={t('command_palette_actions_group')}>
            {QUICK_ACTIONS.map(({ href, labelKey, icon: Icon }) => (
              <CommandItem
                key={href}
                value={`action:${t(`action_${labelKey}`)}`}
                onSelect={() => handleSelect(href)}
                data-testid={`cmd-action-${labelKey}`}
              >
                <Icon />
                <span>{t(`action_${labelKey}`)}</span>
              </CommandItem>
            ))}
          </CommandGroup>

          {hasContacts && (
            <CommandGroup heading={t('command_palette_contacts_group')}>
              {results.contacts.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`contact:${c.firstName ?? ''} ${c.lastName ?? ''} ${c.phone}`}
                  onSelect={() => handleSelect(`/contacts/lists/${c.contactListId}`)}
                  data-testid={`cmd-contact-${c.id}`}
                >
                  <Icons.Phone />
                  <span>{formatContactLabel(c)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {hasCampaigns && (
            <CommandGroup heading={t('command_palette_campaigns_group')}>
              {results.campaigns.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`campaign:${c.name}`}
                  onSelect={() => handleSelect(`/campaigns/${c.id}`)}
                  data-testid={`cmd-campaign-${c.id}`}
                >
                  <Icons.Megaphone />
                  <span>{c.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {hasScripts && (
            <CommandGroup heading={t('command_palette_scripts_group')}>
              {results.scripts.map((s) => (
                <CommandItem
                  key={s.id}
                  value={`script:${s.name}`}
                  onSelect={() => handleSelect(`/scripts/${s.id}`)}
                  data-testid={`cmd-script-${s.id}`}
                >
                  <Icons.FileText />
                  <span>{s.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
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

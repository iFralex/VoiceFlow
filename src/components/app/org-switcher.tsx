'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { switchOrg } from '@/actions/org';
import { Button } from '@/components/ui/button';
import { Icons } from '@/components/ui/icon';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils/index';

export type OrgSummary = { id: string; name: string };

interface OrgSwitcherProps {
  orgs: OrgSummary[];
  activeOrgId: string | null;
  collapsed?: boolean;
}

export function OrgSwitcher({ orgs, activeOrgId, collapsed = false }: OrgSwitcherProps) {
  const router = useRouter();
  const t = useTranslations('common');
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState<string | null>(null);

  const activeOrg = orgs.find((o) => o.id === activeOrgId) ?? orgs[0] ?? null;
  const displayName = activeOrg?.name ?? t('default_org_name');

  async function handleSwitch(orgId: string) {
    if (orgId === activeOrgId) {
      setOpen(false);
      return;
    }
    setPending(orgId);
    try {
      await switchOrg(orgId);
      setOpen(false);
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* Composing Tooltip + PopoverTrigger via asChild chain so the same
          button serves as both triggers. Tooltip content only renders in
          collapsed mode, where the label text is hidden. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              className={cn(
                'h-9 w-full justify-start gap-2 text-sm',
                collapsed && 'w-9 justify-center px-0',
              )}
              aria-label={t('org_switcher_label')}
              aria-expanded={open}
            >
              <Icons.Building2 size={16} className="shrink-0" />
              {!collapsed && (
                <>
                  <span className="flex-1 truncate text-muted-foreground">{displayName}</span>
                  <Icons.ChevronsUpDown size={14} className="shrink-0 text-muted-foreground" />
                </>
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        {collapsed && <TooltipContent side="right">{displayName}</TooltipContent>}
      </Tooltip>

      <PopoverContent
        side="right"
        align="end"
        sideOffset={8}
        className="w-56 p-1"
        data-testid="org-switcher-content"
      >
        <p className="px-2 py-1 text-xs font-medium text-muted-foreground">{t('organizations')}</p>
        <ul role="list">
          {orgs.map((org) => {
            const isActive = org.id === activeOrgId;
            const isLoading = org.id === pending;
            return (
              <li key={org.id}>
                <button
                  type="button"
                  onClick={() => handleSwitch(org.id)}
                  disabled={isLoading}
                  aria-current={isActive ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors',
                    isActive
                      ? 'bg-accent text-foreground font-medium'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  {isLoading ? (
                    <Icons.Loader2 size={14} className="shrink-0 animate-spin" />
                  ) : (
                    <Icons.Check
                      size={14}
                      className={cn('shrink-0', !isActive && 'invisible')}
                    />
                  )}
                  <span className="flex-1 truncate">{org.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <Separator className="my-1" />
        {/* Stub: full creation flow lives in plan 04 */}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Icons.Plus size={14} className="shrink-0" />
          <span>{t('create_new_org')}</span>
        </button>
      </PopoverContent>
    </Popover>
  );
}

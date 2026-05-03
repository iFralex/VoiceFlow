'use client';

import Link from 'next/link';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Icons } from '@/components/ui/icon';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils/index';
import { type MemberRole } from '@/types/index';

import { Nav } from './nav';
import { OrgSwitcher, type OrgSummary } from './org-switcher';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  role?: MemberRole;
  orgs?: OrgSummary[];
  activeOrgId?: string | null;
}

export function Sidebar({
  collapsed,
  onToggle,
  role = 'owner',
  orgs = [],
  activeOrgId = null,
}: SidebarProps) {
  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex h-full flex-col">
        {/* Logo + collapse toggle */}
        <div
          className={cn(
            'flex h-14 items-center border-b px-3',
            collapsed ? 'justify-center' : 'justify-between',
          )}
        >
          {!collapsed && (
            <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
              <Icons.Phone size={20} className="text-primary" />
              <span className="text-sm">VoiceFlow</span>
            </Link>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={onToggle}
                aria-label={collapsed ? 'Espandi barra laterale' : 'Comprimi barra laterale'}
              >
                <Icons.PanelLeft size={16} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {collapsed ? 'Espandi' : 'Comprimi'}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Primary navigation */}
        <nav className="flex-1 overflow-y-auto py-2" aria-label="Navigazione principale">
          <Nav collapsed={collapsed} role={role} />
        </nav>

        <Separator />

        {/* Org switcher */}
        <div className={cn('p-3', collapsed && 'flex justify-center')}>
          <OrgSwitcher orgs={orgs} activeOrgId={activeOrgId} collapsed={collapsed} />
        </div>
      </div>
    </TooltipProvider>
  );
}

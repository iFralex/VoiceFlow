'use client';

import Link from 'next/link';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Icons } from '@/components/ui/icon';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils/index';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
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

        {/* Primary navigation — populated in Task 6 */}
        <nav className="flex-1 overflow-y-auto py-2" aria-label="Navigazione principale">
          <SidebarNavStub collapsed={collapsed} />
        </nav>

        <Separator />

        {/* Org switcher — populated in Task 7 */}
        <div className={cn('p-3', collapsed && 'flex justify-center')}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                className={cn(
                  'h-9 w-full justify-start gap-2 text-sm',
                  collapsed && 'w-9 justify-center px-0',
                )}
                aria-label="Cambia organizzazione"
              >
                <Icons.Building2 size={16} className="shrink-0" />
                {!collapsed && <span className="truncate text-muted-foreground">Organizzazione</span>}
              </Button>
            </TooltipTrigger>
            {collapsed && <TooltipContent side="right">Organizzazione</TooltipContent>}
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}

/** Stub nav items — replaced by the real Nav component in Task 6 */
function SidebarNavStub({ collapsed }: { collapsed: boolean }) {
  const items = [
    { href: '/dashboard', label: 'Dashboard', icon: Icons.LayoutDashboard },
    { href: '/campagne', label: 'Campagne', icon: Icons.Megaphone },
    { href: '/contatti', label: 'Contatti', icon: Icons.Users },
    { href: '/script', label: 'Script', icon: Icons.FileText },
    { href: '/credito', label: 'Credito', icon: Icons.CreditCard },
    { href: '/impostazioni', label: 'Impostazioni', icon: Icons.Settings },
  ] as const;

  return (
    <TooltipProvider delayDuration={0}>
      <ul className="space-y-0.5 px-2">
        {items.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href={href}
                  className={cn(
                    'flex h-9 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground',
                    'hover:bg-accent hover:text-foreground transition-colors',
                    collapsed && 'w-9 justify-center px-0',
                  )}
                >
                  <Icon size={16} className="shrink-0" />
                  {!collapsed && <span>{label}</span>}
                </Link>
              </TooltipTrigger>
              {collapsed && <TooltipContent side="right">{label}</TooltipContent>}
            </Tooltip>
          </li>
        ))}
      </ul>
    </TooltipProvider>
  );
}

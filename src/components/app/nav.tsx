'use client';

import { type LucideProps } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { Icons } from '@/components/ui/icon';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils/index';
import { type MemberRole } from '@/types/index';

// ---------------------------------------------------------------------------
// NavItem shape
// The badge function is designed to be resolved server-side by a parent server
// component; the Nav client component accepts pre-resolved values via the
// badgeValues prop (see Phase 1 usage). Full async badge wiring comes in plan 12.
// ---------------------------------------------------------------------------
export type NavItem = {
  href: string;
  label: { it: string; en: string };
  icon: React.ComponentType<LucideProps>;
  badge?: () => Promise<string | null>;
  requireRole?: MemberRole[];
};

// ---------------------------------------------------------------------------
// Primary navigation items — spec §5.1
// ---------------------------------------------------------------------------
export const PRIMARY_NAV_ITEMS: NavItem[] = [
  {
    href: '/dashboard',
    label: { it: 'Dashboard', en: 'Dashboard' },
    icon: Icons.LayoutDashboard,
  },
  {
    href: '/campagne',
    label: { it: 'Campagne', en: 'Campaigns' },
    icon: Icons.Megaphone,
  },
  {
    href: '/contatti',
    label: { it: 'Contatti', en: 'Contacts' },
    icon: Icons.Users,
  },
  {
    href: '/script',
    label: { it: 'Script', en: 'Scripts' },
    icon: Icons.FileText,
  },
  {
    href: '/credito',
    label: { it: 'Credito', en: 'Credit' },
    icon: Icons.CreditCard,
    requireRole: ['owner', 'admin'],
  },
  {
    href: '/impostazioni',
    label: { it: 'Impostazioni', en: 'Settings' },
    icon: Icons.Settings,
    requireRole: ['owner', 'admin'],
  },
];

// ---------------------------------------------------------------------------
// Nav component
// ---------------------------------------------------------------------------
interface NavProps {
  items?: NavItem[];
  collapsed?: boolean;
  role?: MemberRole;
  locale?: 'it' | 'en';
  /** Pre-resolved badge values keyed by item href */
  badgeValues?: Record<string, string | null>;
}

export function Nav({
  items = PRIMARY_NAV_ITEMS,
  collapsed = false,
  role = 'owner',
  locale = 'it',
  badgeValues,
}: NavProps) {
  const pathname = usePathname();

  const visibleItems = items.filter((item) => {
    if (!item.requireRole) return true;
    return item.requireRole.includes(role);
  });

  return (
    <TooltipProvider delayDuration={0}>
      <ul className="space-y-0.5 px-2" role="list">
        {visibleItems.map((item) => {
          const label = item.label[locale];
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
          const badge = badgeValues?.[item.href];

          return (
            <li key={item.href}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href={item.href}
                    aria-label={collapsed ? label : undefined}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'flex h-9 items-center gap-2 rounded-md px-2 text-sm transition-colors',
                      isActive
                        ? 'bg-accent text-foreground font-medium'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      collapsed && 'w-9 justify-center px-0',
                    )}
                  >
                    <item.icon size={16} className="shrink-0" />
                    {!collapsed && (
                      <>
                        <span className="flex-1 truncate">{label}</span>
                        {badge != null && (
                          <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium leading-none text-primary-foreground">
                            {badge}
                          </span>
                        )}
                      </>
                    )}
                  </Link>
                </TooltipTrigger>
                {collapsed && <TooltipContent side="right">{label}</TooltipContent>}
              </Tooltip>
            </li>
          );
        })}
      </ul>
    </TooltipProvider>
  );
}

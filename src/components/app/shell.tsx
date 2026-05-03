'use client';

import * as React from 'react';

import { Sheet, SheetContent } from '@/components/ui/sheet';
import { cn } from '@/lib/utils/index';

import { type CreditBalance } from './credit-pill';
import { type OrgSummary } from './org-switcher';
import { Sidebar } from './sidebar';
import { TopBar } from './topbar';

const SIDEBAR_STORAGE_KEY = 'app-sidebar-collapsed';

// ---------------------------------------------------------------------------
// useSyncExternalStore wiring for localStorage-backed sidebar state
// This avoids calling setState inside useEffect (react-hooks/set-state-in-effect)
// and handles SSR hydration cleanly via the server snapshot.
// ---------------------------------------------------------------------------
function subscribe(callback: () => void) {
  window.addEventListener('storage', callback);
  return () => window.removeEventListener('storage', callback);
}

function getSidebarSnapshot(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function getSidebarServerSnapshot(): boolean {
  return false; // always start expanded on server
}

interface ShellProps {
  children: React.ReactNode;
  orgs?: OrgSummary[];
  activeOrgId?: string | null;
  /** Credit balance passed down from a server-rendered parent via Suspense */
  creditBalance?: CreditBalance;
}

export function Shell({ children, orgs = [], activeOrgId = null, creditBalance }: ShellProps) {
  const collapsed = React.useSyncExternalStore(
    subscribe,
    getSidebarSnapshot,
    getSidebarServerSnapshot,
  );
  const [mobileOpen, setMobileOpen] = React.useState(false);

  function handleToggle() {
    const next = !collapsed;
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      // Dispatch a storage event so other tabs and useSyncExternalStore pick up the change
      window.dispatchEvent(new StorageEvent('storage', { key: SIDEBAR_STORAGE_KEY, newValue: String(next) }));
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
      <aside
        data-testid="app-sidebar"
        data-collapsed={collapsed}
        className={cn(
          'hidden shrink-0 flex-col border-r bg-background transition-[width] duration-200 md:flex',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <Sidebar collapsed={collapsed} onToggle={handleToggle} orgs={orgs} activeOrgId={activeOrgId} />
      </aside>

      {/* ── Mobile: sidebar inside a Sheet ──────────────────────────────── */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="w-60 p-0"
          aria-label="Menu di navigazione"
        >
          <Sidebar collapsed={false} onToggle={() => setMobileOpen(false)} orgs={orgs} activeOrgId={activeOrgId} />
        </SheetContent>
      </Sheet>

      {/* ── Main column (top bar + content) ─────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          onMobileMenuClick={() => setMobileOpen(true)}
          {...(creditBalance !== undefined ? { creditBalance } : {})}
        />

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</div>
        </main>
      </div>
    </div>
  );
}

# Plan: Foundation — Design System and Layout Shell

**Branch:** `feat/03-foundation-design-system`
**Wave:** 1
**Depends on:** none (parallel with 01 and 02; only consumes the Next.js scaffold from 01)
**Estimated effort:** 2–3 days

## Overview
Sets up the design system per spec §5.5: Tailwind 4, shadcn/ui primitives, the application shell (sidebar, top bar, content area), navigation, theme tokens, dark mode (optional), iconography, and Italian-first internationalisation. After this plan merges, every subsequent plan can place new pages inside the `(app)/` group and they automatically inherit the shell.

## Context
The product is a B2B operational tool for Italian car dealerships, not a consumer product. The visual language is restrained and dense (spec §5.5): clear status indicators, monospaced fonts for technical fields, no decorative animation. Italian as the default UI language, English available as a toggle for the founder's own use and for future market expansion. shadcn/ui chosen so the team owns the component code rather than depending on a versioned library.

## Validation Commands
- `pnpm typecheck`
- `pnpm lint`
- `pnpm build`
- `pnpm test src/components`
- `pnpm test:e2e e2e/shell.spec.ts`
- `pnpm exec playwright test --project chromium e2e/visual.spec.ts`

### Task 1: Tailwind 4 configuration
- [ ] Confirm Tailwind 4 already wired by Next.js scaffold (plan 01)
- [ ] Update `src/app/globals.css` with Tailwind v4 `@import "tailwindcss";` and design tokens defined as CSS variables in `:root`:
```css
:root {
  --background: 0 0% 100%;
  --foreground: 222 47% 11%;
  --primary: 222 47% 11%;
  --primary-foreground: 210 40% 98%;
  --secondary: 210 40% 96%;
  --muted: 210 40% 96%;
  --muted-foreground: 215 16% 47%;
  --accent: 210 40% 96%;
  --destructive: 0 84% 60%;
  --border: 214 32% 91%;
  --input: 214 32% 91%;
  --ring: 222 47% 11%;
  --radius: 0.5rem;
  /* Status colours */
  --status-success: 142 71% 45%;
  --status-warning: 38 92% 50%;
  --status-danger: 0 84% 60%;
  --status-info: 217 91% 60%;
  --status-neutral: 215 16% 47%;
}
```
- [ ] Add monospace font stack utility for technical fields: `font-mono-tabular` with `font-feature-settings: "tnum"`
- [ ] Configure typography scale appropriate for dense data UIs (smaller defaults than Tailwind's defaults)
- [ ] Mark completed

### Task 2: Fonts
- [ ] Self-host Inter (UI) and JetBrains Mono (technical fields) via `next/font/google` for performance and privacy
- [ ] Apply font variables in `app/layout.tsx`
- [ ] Verify CLS is zero on initial render
- [ ] Mark completed

### Task 3: shadcn/ui setup
- [ ] Run `pnpm dlx shadcn@latest init` choosing CSS variables and the `new-york` style
- [ ] Install the primitives that will be used across the product:
  - button, input, label, textarea, select, checkbox, radio-group, switch
  - card, dialog, drawer, sheet, popover, tooltip
  - dropdown-menu, command, navigation-menu
  - alert, alert-dialog, toast (sonner), badge, separator
  - table, tabs, accordion, scroll-area, skeleton
  - form (React Hook Form integration), avatar, calendar (date picker)
- [ ] Configure `components.json` with import alias `@/components/ui`
- [ ] Verify each primitive renders in a test page at `app/(marketing)/_kitchen-sink/page.tsx` (gated by env, not in production nav)
- [ ] Mark completed

### Task 4: Iconography
- [ ] Install `lucide-react` for icons (already a shadcn dependency)
- [ ] Create `src/components/ui/icon.tsx` thin wrapper exporting commonly-used icons with consistent stroke and size defaults
- [ ] Forbid raw SVG imports in lint config in favour of going through this wrapper
- [ ] Mark completed

### Task 5: Application shell — `(app)` layout
- [ ] Create `src/app/(app)/layout.tsx` with three regions:
  - left sidebar (collapsible, 240px expanded, 64px collapsed): logo, primary navigation, current org switcher at bottom
  - top bar (h-14): page title slot, breadcrumbs, search command palette trigger, credit balance pill, notifications bell, user menu
  - main content area: `<main>` with max-width and consistent padding
- [ ] Implement collapsed/expanded state in `localStorage` with `useState` hydration guard
- [ ] Mobile breakpoint: sidebar becomes a drawer triggered from a hamburger menu
- [ ] Mark completed

### Task 6: Navigation primitives
- [ ] Define navigation item shape:
```typescript
type NavItem = {
  href: string;
  label: { it: string; en: string };
  icon: LucideIcon;
  badge?: () => Promise<string | null>; // server-side dynamic badge (e.g. running campaigns count)
  requireRole?: MemberRole[];
};
```
- [ ] Author `src/components/app/nav.tsx` reading `pathname` to highlight active item
- [ ] Configure primary nav items per spec §5.1: Dashboard, Campagne, Contatti, Script, Credito, Impostazioni
- [ ] Render nothing for items the active member's role cannot access
- [ ] Mark completed

### Task 7: Organization switcher
- [ ] Create `src/components/app/org-switcher.tsx` rendering a popover listing all orgs the user belongs to (data passed from server component)
- [ ] Active org indicated; clicking another org sets `active_org_id` cookie via Server Action then `router.refresh()`
- [ ] "Crea nuova organizzazione" CTA at the bottom of the popover (handler stub; full creation flow lives in plan 04)
- [ ] Mark completed

### Task 8: Top bar — credit balance pill
- [ ] Create `src/components/app/credit-pill.tsx` displaying remaining minutes (data fetched from a server-rendered parent and passed down)
- [ ] Status colours: green ≥60 min, amber 10–59 min, red <10 min
- [ ] Click opens a popover with current balance breakdown and "Ricarica" button → `/credit/topup`
- [ ] In Phase 1 the data flows via a `<Suspense>` and short revalidation; full Realtime subscription is added in plan 12
- [ ] Mark completed

### Task 9: Top bar — search command palette stub
- [ ] Add cmd+K command palette using `cmdk` (already a shadcn dep)
- [ ] In Phase 1 it lists static actions (go to dashboard, go to campaigns, etc.); search results across data come in plan 12
- [ ] Mark completed

### Task 10: User menu
- [ ] Avatar dropdown with: full name, email, "Profilo", "Impostazioni", "Lingua" submenu (it/en), "Tema" submenu (light/dark/system), "Esci"
- [ ] Theme switching via `next-themes`; default is `light`
- [ ] Locale switching writes to a `locale` cookie; full i18n wiring in Task 12
- [ ] Mark completed

### Task 11: Marketing-area layout
- [ ] Create `src/app/(marketing)/layout.tsx` with a separate, simpler shell (top nav with logo, "Accedi" CTA; footer with legal links)
- [ ] Style aligned with the app but lighter — centred content, hero typography
- [ ] Marketing pages use a different max-width and density than the app
- [ ] Mark completed

### Task 12: i18n scaffolding
- [ ] Install `next-intl`
- [ ] Configure `src/i18n/locales/it.json` and `src/i18n/locales/en.json` with namespaces: `common`, `nav`, `auth`, `campaigns`, `contacts`, `credit`, `settings`, `compliance`
- [ ] Wire `next-intl` middleware that resolves locale from cookie → falls back to `it`
- [ ] Provide a `t()` server helper and a `useTranslations()` client hook
- [ ] Translate the navigation labels, top-bar elements, and the marketing layout chrome as the seed
- [ ] Document in `docs/i18n.md` how to add new keys (every UI string passes through translations; no inline strings outside JSX)
- [ ] Mark completed

### Task 13: Date and number formatting helpers
- [ ] Create `src/lib/utils/format.ts` with helpers using `Intl.DateTimeFormat` and `Intl.NumberFormat` bound to the current locale and Europe/Rome timezone
- [ ] `formatCurrency(cents, locale)` formats integer cents as €X.XX
- [ ] `formatPhone(e164)` formats E.164 to a readable Italian format
- [ ] `formatDuration(seconds)` returns "1m 23s"
- [ ] `formatRelativeTime(date)` ("2 ore fa")
- [ ] Add unit tests covering Italian and English locales for each helper
- [ ] Mark completed

### Task 14: Status indicators and data tables
- [ ] Create `src/components/ui/status-badge.tsx` mapping status enums to colour and label (campaign status, call status, payment status, opt-out, RPO status)
- [ ] Create `src/components/data-table/` (uses TanStack Table v8 + shadcn table primitive) with: column visibility, sorting, pagination, server-side filtering hooks
- [ ] Provide a "Loading", "Empty", and "Error" placeholder state in the table component
- [ ] Mark completed

### Task 15: Toaster and confirmations
- [ ] Add Sonner toaster at the root of `(app)/layout.tsx`
- [ ] Convention: Server Actions return `{ ok: true } | { ok: false, message }`; client components surface success/error toasts
- [ ] For destructive actions add `<ConfirmDialog>` wrapper requiring explicit confirmation (member removal, contact deletion, campaign cancellation)
- [ ] Mark completed

### Task 16: Empty and skeleton states
- [ ] Author shared empty-state component with illustration slot, title, description, primary action
- [ ] Author skeleton variants for: data tables, KPI cards, list pages, detail pages
- [ ] Use these as default Suspense fallbacks
- [ ] Mark completed

### Task 17: Marketing landing skeleton
- [ ] Replace placeholder marketing page with a simple landing: hero ("Voice AI Outbound per Concessionari Auto"), three value props (riattivazione lead, conferma appuntamenti, post-vendita), pricing teaser linking to full pricing page, footer legal links
- [ ] All copy from i18n; Italian primary
- [ ] No actual lead capture form yet (could be added later or left as placeholder)
- [ ] Mark completed

### Task 18: Visual regression test baseline
- [ ] Add Playwright visual regression test in `e2e/visual.spec.ts` capturing screenshots of: marketing landing, login page placeholder, app shell empty state
- [ ] Commit the baseline screenshots; CI fails on visual drift exceeding threshold
- [ ] Document in README how to update baselines when intentional changes happen
- [ ] Mark completed

### Task 19: Definition of Done
- [ ] All 16 shadcn primitives render without console errors
- [ ] App shell renders correctly at desktop, tablet and mobile breakpoints
- [ ] Italian and English locales both render the navigation and marketing copy
- [ ] Theme switcher works (light/dark/system)
- [ ] Format helpers covered by unit tests
- [ ] Visual regression baseline committed
- [ ] Mark completed

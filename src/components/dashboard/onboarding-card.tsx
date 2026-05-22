'use client';

import { ArrowRight, ListChecks, Megaphone, Users } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/index';

type StepKey = 'contacts' | 'script' | 'campaign';

const STEPS: { key: StepKey; href: string; icon: typeof Users }[] = [
  { key: 'contacts', href: '/contacts/upload', icon: Users },
  { key: 'script', href: '/scripts', icon: ListChecks },
  { key: 'campaign', href: '/campaigns/new', icon: Megaphone },
];

export function DashboardOnboardingCard({ className }: { className?: string }) {
  const t = useTranslations('dashboard');

  return (
    <section
      data-slot="dashboard-onboarding"
      aria-label={t('onboarding_title')}
      className={cn(
        'bg-card ring-foreground/10 flex flex-col gap-6 rounded-xl p-6 ring-1',
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">{t('onboarding_title')}</h2>
        <p className="text-muted-foreground text-sm">{t('onboarding_description')}</p>
      </div>

      <ol className="grid gap-4 md:grid-cols-3">
        {STEPS.map(({ key, href, icon: Icon }, index) => {
          const titleKey = `onboarding_step_${key}_title` as Parameters<typeof t>[0];
          const descKey = `onboarding_step_${key}_desc` as Parameters<typeof t>[0];
          const ctaKey = `onboarding_step_${key}_cta` as Parameters<typeof t>[0];
          return (
            <li
              key={key}
              data-slot="dashboard-onboarding-step"
              className="border-border/60 bg-background/40 flex flex-col gap-3 rounded-lg border p-4"
            >
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="bg-primary/10 text-primary flex size-8 items-center justify-center rounded-full text-sm font-semibold"
                >
                  {index + 1}
                </span>
                <Icon aria-hidden className="text-muted-foreground size-4" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-foreground text-sm font-semibold">{t(titleKey)}</p>
                <p className="text-muted-foreground text-sm">{t(descKey)}</p>
              </div>
              <Button asChild variant="outline" size="sm" className="mt-auto w-fit">
                <Link href={href}>
                  {t(ctaKey)}
                  <ArrowRight className="ml-1 size-3.5" aria-hidden />
                </Link>
              </Button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

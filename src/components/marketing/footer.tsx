'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

const CURRENT_YEAR = new Date().getFullYear();

export function MarketingFooter() {
  const t = useTranslations('common');

  const legalLinks = [
    { href: '/privacy', labelKey: 'marketing_privacy' },
    { href: '/termini', labelKey: 'marketing_terms' },
    { href: '/cookie', labelKey: 'marketing_cookies' },
  ] as const;

  return (
    <footer
      data-testid="marketing-footer"
      className="border-t bg-background"
    >
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 py-8 md:flex-row md:justify-between">
        {/* Copyright */}
        <p className="text-sm text-muted-foreground">
          {t('marketing_copyright', { year: CURRENT_YEAR })}
        </p>

        {/* Legal links */}
        <nav aria-label={t('marketing_legal_nav_label')} className="flex flex-wrap justify-center gap-4 md:justify-end">
          {legalLinks.map(({ href, labelKey }) => (
            <Link
              key={href}
              href={href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t(labelKey)}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}

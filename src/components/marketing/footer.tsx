'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

const CURRENT_YEAR = new Date().getFullYear();
const STATUS_PAGE_URL = process.env.NEXT_PUBLIC_STATUS_PAGE_URL;

export function MarketingFooter() {
  const t = useTranslations('common');

  const legalLinks = [
    { href: '/legal/privacy', labelKey: 'marketing_privacy' },
    { href: '/legal/terms', labelKey: 'marketing_terms' },
    { href: '/legal/cookie', labelKey: 'marketing_cookies' },
    { href: '/legal/dpa', labelKey: 'marketing_dpa' },
  ] as const;

  return (
    <footer data-testid="marketing-footer" className="bg-background border-t">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 py-8 md:flex-row md:justify-between">
        {/* Copyright */}
        <p className="text-muted-foreground text-sm">
          {t('marketing_copyright', { year: CURRENT_YEAR })}
        </p>

        {/* Legal + status links */}
        <nav
          aria-label={t('marketing_legal_nav_label')}
          className="flex flex-wrap justify-center gap-4 md:justify-end"
        >
          {legalLinks.map(({ href, labelKey }) => (
            <Link
              key={href}
              href={href}
              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              {t(labelKey)}
            </Link>
          ))}
          {STATUS_PAGE_URL && (
            <a
              href={STATUS_PAGE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
              data-testid="footer-status-link"
            >
              {t('marketing_status')}
            </a>
          )}
        </nav>
      </div>
    </footer>
  );
}

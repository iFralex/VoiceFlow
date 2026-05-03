import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { Button } from '@/components/ui/button';

type SearchParamsRecord = Record<string, string | string[] | undefined>;

interface VerifyPageProps {
  searchParams: Promise<SearchParamsRecord>;
}

export default async function VerifyPage({ searchParams }: VerifyPageProps) {
  const params = await searchParams;
  const email = typeof params['email'] === 'string' ? params['email'] : undefined;
  const t = await getTranslations('auth');

  return (
    <div className="w-full max-w-sm space-y-6 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-8 w-8 text-primary"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
          />
        </svg>
      </div>

      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t('verify_title')}</h1>
        <p className="text-sm text-muted-foreground">
          {email
            ? t('verify_description', { email })
            : t('verify_description_generic')}
        </p>
      </div>

      <Button variant="outline" asChild>
        <Link href="/login">{t('back_to_login')}</Link>
      </Button>
    </div>
  );
}

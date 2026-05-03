'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Icons } from '@/components/ui/icon';

const VALUE_PROPS = [
  { key: 'vp1', icon: 'Users' },
  { key: 'vp2', icon: 'Calendar' },
  { key: 'vp3', icon: 'HeartHandshake' },
] as const;

function ValuePropIcon({ name }: { name: (typeof VALUE_PROPS)[number]['icon'] }) {
  if (name === 'Users') return <Icons.Users size={28} className="text-primary" />;
  if (name === 'Calendar') return <Icons.Calendar size={28} className="text-primary" />;
  return <Icons.Phone size={28} className="text-primary" />;
}

export default function MarketingPage() {
  const t = useTranslations('landing');

  return (
    <>
      {/* Hero */}
      <section
        data-testid="landing-hero"
        className="py-20 text-center"
      >
        <h1 className="text-4xl font-bold leading-tight tracking-tight text-foreground sm:text-5xl lg:text-6xl">
          {t('hero_title')}
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
          {t('hero_subtitle')}
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/registrati">{t('hero_cta_primary')}</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/come-funziona">{t('hero_cta_secondary')}</Link>
          </Button>
        </div>
      </section>

      {/* Value propositions */}
      <section
        data-testid="landing-value-props"
        className="py-16"
      >
        <h2 className="mb-12 text-center text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {t('value_props_title')}
        </h2>
        <div className="grid gap-8 sm:grid-cols-3">
          {VALUE_PROPS.map(({ key, icon }) => (
            <article
              key={key}
              data-testid={`value-prop-${key}`}
              className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm"
            >
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-md bg-muted">
                <ValuePropIcon name={icon} />
              </div>
              <h3 className="mb-2 text-lg font-semibold">
                {t(`${key}_title` as 'vp1_title' | 'vp2_title' | 'vp3_title')}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t(`${key}_description` as 'vp1_description' | 'vp2_description' | 'vp3_description')}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* Pricing teaser */}
      <section
        data-testid="landing-pricing"
        className="py-16 text-center"
      >
        <div className="rounded-xl border bg-muted/40 px-8 py-12">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {t('pricing_title')}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            {t('pricing_description')}
          </p>
          <Button asChild size="lg" className="mt-8" variant="outline">
            <Link href={t('pricing_href')}>{t('pricing_cta')}</Link>
          </Button>
        </div>
      </section>
    </>
  );
}

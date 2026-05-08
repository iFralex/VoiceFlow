import type { Metadata } from 'next';

import { t as serverT } from '@/i18n/server';

import { LegalDocument } from '../_components/legal-document';

const SECTION_KEYS = [
  ['cookie_section_what_title', 'cookie_section_what_body'],
  ['cookie_section_types_title', 'cookie_section_types_body'],
  ['cookie_section_consent_title', 'cookie_section_consent_body'],
  ['cookie_section_management_title', 'cookie_section_management_body'],
] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT('legal');
  return {
    title: t('cookie_title'),
    description: t('cookie_subtitle'),
  };
}

export default async function CookiePolicyPage() {
  const t = await serverT('legal');
  return (
    <LegalDocument
      testId="legal-cookie"
      title={t('cookie_title')}
      subtitle={t('cookie_subtitle')}
      draftNotice={t('draft_notice')}
      lastUpdatedLabel={t('last_updated_label')}
      effectiveDate={t('effective_date_value')}
      backToHome={t('back_to_home')}
      sections={SECTION_KEYS.map(([titleKey, bodyKey]) => ({
        title: t(titleKey),
        body: t(bodyKey),
      }))}
    />
  );
}

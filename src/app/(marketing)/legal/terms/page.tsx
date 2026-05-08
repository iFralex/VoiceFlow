import type { Metadata } from 'next';

import { t as serverT } from '@/i18n/server';

import { LegalDocument } from '../_components/legal-document';

const SECTION_KEYS = [
  ['terms_section_acceptance_title', 'terms_section_acceptance_body'],
  ['terms_section_service_title', 'terms_section_service_body'],
  ['terms_section_account_title', 'terms_section_account_body'],
  ['terms_section_acceptable_use_title', 'terms_section_acceptable_use_body'],
  ['terms_section_billing_title', 'terms_section_billing_body'],
  ['terms_section_liability_title', 'terms_section_liability_body'],
  ['terms_section_termination_title', 'terms_section_termination_body'],
  ['terms_section_law_title', 'terms_section_law_body'],
] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT('legal');
  return {
    title: t('terms_title'),
    description: t('terms_subtitle'),
  };
}

export default async function TermsPage() {
  const t = await serverT('legal');
  return (
    <LegalDocument
      testId="legal-terms"
      title={t('terms_title')}
      subtitle={t('terms_subtitle')}
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

import type { Metadata } from 'next';

import { t as serverT } from '@/i18n/server';

import { LegalDocument } from '../_components/legal-document';

const SECTION_KEYS = [
  ['privacy_section_controller_title', 'privacy_section_controller_body'],
  ['privacy_section_data_collected_title', 'privacy_section_data_collected_body'],
  ['privacy_section_purposes_title', 'privacy_section_purposes_body'],
  ['privacy_section_legal_basis_title', 'privacy_section_legal_basis_body'],
  ['privacy_section_retention_title', 'privacy_section_retention_body'],
  ['privacy_section_rights_title', 'privacy_section_rights_body'],
  ['privacy_section_processors_title', 'privacy_section_processors_body'],
  ['privacy_section_transfers_title', 'privacy_section_transfers_body'],
  ['privacy_section_contact_title', 'privacy_section_contact_body'],
] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT('legal');
  return {
    title: t('privacy_title'),
    description: t('privacy_subtitle'),
  };
}

export default async function PrivacyPolicyPage() {
  const t = await serverT('legal');
  return (
    <LegalDocument
      testId="legal-privacy"
      title={t('privacy_title')}
      subtitle={t('privacy_subtitle')}
      draftNotice={t('draft_notice')}
      lastUpdatedLabel={t('last_updated_label')}
      effectiveDate={t('effective_date_value')}
      backToHome={t('back_to_home')}
      meta={[{ label: t('controller_label'), value: t('controller_value') }]}
      sections={SECTION_KEYS.map(([titleKey, bodyKey]) => ({
        title: t(titleKey),
        body: t(bodyKey),
      }))}
    />
  );
}

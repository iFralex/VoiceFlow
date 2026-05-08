import type { Metadata } from 'next';

import { t as serverT } from '@/i18n/server';
import { CURRENT_DPA_VERSION } from '@/lib/compliance/dpa';

import { LegalDocument } from '../_components/legal-document';

const SECTION_KEYS = [
  ['dpa_section_parties_title', 'dpa_section_parties_body'],
  ['dpa_section_subject_title', 'dpa_section_subject_body'],
  ['dpa_section_data_categories_title', 'dpa_section_data_categories_body'],
  ['dpa_section_obligations_title', 'dpa_section_obligations_body'],
  ['dpa_section_subprocessors_title', 'dpa_section_subprocessors_body'],
  ['dpa_section_security_title', 'dpa_section_security_body'],
  ['dpa_section_breach_title', 'dpa_section_breach_body'],
  ['dpa_section_termination_title', 'dpa_section_termination_body'],
] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT('legal');
  return {
    title: t('dpa_title'),
    description: t('dpa_subtitle'),
  };
}

export default async function DpaPage() {
  const t = await serverT('legal');
  return (
    <LegalDocument
      testId="legal-dpa"
      title={t('dpa_title')}
      subtitle={t('dpa_subtitle')}
      draftNotice={t('draft_notice')}
      lastUpdatedLabel={t('last_updated_label')}
      effectiveDate={t('effective_date_value')}
      backToHome={t('back_to_home')}
      meta={[{ label: t('dpa_version_label'), value: CURRENT_DPA_VERSION }]}
      sections={SECTION_KEYS.map(([titleKey, bodyKey]) => ({
        title: t(titleKey),
        body: t(bodyKey),
      }))}
    />
  );
}

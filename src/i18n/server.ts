/**
 * Server-side i18n helpers.
 *
 * Usage in async Server Components and Server Actions:
 *
 *   import { t } from '@/i18n/server';
 *   const translate = await t('nav');
 *   translate('campaigns'); // → "Campagne" (or "Campaigns" in EN)
 *
 * The `t` alias matches the convention used across the codebase; it resolves
 * to next-intl's `getTranslations`, which reads the locale from the request
 * context established by `src/i18n/request.ts`.
 */
export { getTranslations as t, getTranslations } from 'next-intl/server';

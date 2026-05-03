import './src/lib/env';
import type { NextConfig } from 'next';

// next-intl plugin is not used here — locale is resolved directly from cookies
// in the root layout and passed via NextIntlClientProvider. The
// src/i18n/request.ts config remains available for server-component
// getTranslations() usage once the SWC native binding is in place.
const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;

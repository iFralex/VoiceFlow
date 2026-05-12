import path from 'path';

import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';

import './src/lib/env';

// next-intl plugin (createNextIntlPlugin) requires @swc/core native bindings
// which are not available for linux-arm64-musl. Instead, we wire the request
// config via webpack and Turbopack module aliases — this achieves the same
// effect: `next-intl/config` resolves to our getRequestConfig file so that
// server-side useTranslations and getTranslations work during SSR.
const requestConfigPath = path.resolve('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      'next-intl/config': requestConfigPath,
    };
    return config;
  },
  turbopack: {
    // Turbopack resolveAlias requires a path relative to the project root
    resolveAlias: {
      'next-intl/config': './src/i18n/request.ts',
    },
  },
};

export default withSentryConfig(nextConfig, {
  ...(process.env.SENTRY_ORG && { org: process.env.SENTRY_ORG }),
  ...(process.env.SENTRY_PROJECT && { project: process.env.SENTRY_PROJECT }),
  ...(process.env.SENTRY_AUTH_TOKEN && { authToken: process.env.SENTRY_AUTH_TOKEN }),
  silent: !process.env.CI,
  widenClientFileUpload: true,
  sourcemaps: {
    filesToDeleteAfterUpload: ['.next/static/**/*.map'],
  },
  disableLogger: true,
  automaticVercelMonitors: true,
});

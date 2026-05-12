import * as Sentry from '@sentry/nextjs';

/**
 * Sets Sentry user context from the auth context.
 * Attaches userId and orgId but explicitly omits email to comply with §15.2 PII rules.
 */
export function setSentryUser(userId: string, orgId: string): void {
  Sentry.setUser({ id: userId, orgId });
}

export function clearSentryUser(): void {
  Sentry.setUser(null);
}

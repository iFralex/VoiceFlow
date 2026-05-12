// Canonical list of feature flag keys used across the platform.
// Keeping them in one place prevents typos and aids discoverability.

export const FLAGS = {
  // Phase 2 canary: proprietary voice stack (default off)
  VOICE_PROPRIETARY_STACK: 'voice.proprietary-stack',
  // Gates the test-call endpoint (plan 08); default on for staging only
  INTERNAL_TEST_CALL: 'internal.test_call',
  // Global ⌘K search widget quick kill-switch (default on)
  DASHBOARD_CMD_K_SEARCH: 'dashboard.cmd-k-search',
  // Monthly AI Act compliance audit cron (default on)
  COMPLIANCE_AIACT_MONTHLY_AUDIT: 'compliance.aiact-monthly-audit',
  // Weekly email summary (default on; disable on Mondays if overrun)
  EMAIL_WEEKLY_SUMMARY: 'email.weekly-summary',
  // Disclosure-failures admin page; off in production until QA mature
  INTERNAL_DISCLOSURE_FAILURES_PAGE: 'internal.disclosure-failures-page',
} as const;

export type FlagKey = (typeof FLAGS)[keyof typeof FLAGS];

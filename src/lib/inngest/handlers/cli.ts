/**
 * Inngest event type definitions for the CLI pool watchdog (plan 10 task 7).
 *
 * The watchdog cron emits one of these events per status transition; the
 * actual handler that notifies the founder (Slack / email) is wired up in
 * plan 13. Until then the events are still emitted so the audit trail is
 * captured by Inngest's event log.
 */

export const CLI_COOLING_DOWN_EVENT = 'cli/cooling-down' as const;
export const CLI_RETIRED_EVENT = 'cli/retired' as const;
/**
 * Plan 10 task 15: emitted by the weekly SBC trunk smoke test
 * (`/api/cron/sbc-smoke-test`) whenever the test fails — either no candidate
 * CLI, the Vapi createCall threw, the call timed out without ending, or the
 * end-state assertions did not hold (duration ≤ 2s, or `endedReason` was not
 * `hangup`/`silence-timeout`). Plan 13's notification handler routes this to
 * the founder so a degraded SBC trunk is surfaced before customer dispatches
 * tip the consecutive-failure counter and force the Twilio fallback.
 */
export const SBC_SMOKE_TEST_FAILED_EVENT = 'sbc/smoke-test-failed' as const;

export interface CliCoolingDownData {
  phoneNumberId: string;
  e164: string;
  spamScore: number;
  pickupRate: number;
  voicemailRate: number;
  complaintRate: number;
  /** ISO 8601 timestamp when the CLI may be reactivated (cooldown end). */
  resumeAt: string;
  /** Number of cooldowns in the past 30 days, including this one. */
  cooldownsInWindow: number;
}

export interface CliRetiredData {
  phoneNumberId: string;
  e164: string;
  /** Number of cooldowns in the past 30 days that triggered retirement. */
  cooldownsInWindow: number;
}

export interface SbcSmokeTestFailedData {
  /** Reason classifier — kept narrow so the notifier can format alerts cleanly. */
  reason:
    | 'no_candidate_cli'
    | 'create_call_failed'
    | 'timeout_waiting_for_end'
    | 'unexpected_ended_reason'
    | 'duration_too_short'
    | 'no_test_number_configured';
  /** Free-text detail for the alert body (provider error message, last status, etc.). */
  detail: string;
  /** The CLI the smoke test attempted to use, when one was selected. */
  phoneNumberId?: string;
  e164?: string;
  /** Vapi call id, when createCall succeeded. */
  providerCallId?: string;
  /** Observed duration in seconds, when the call did end. */
  durationSeconds?: number;
  /** Observed Vapi `endedReason`, when the call did end. */
  endedReason?: string;
}

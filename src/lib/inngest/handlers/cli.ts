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

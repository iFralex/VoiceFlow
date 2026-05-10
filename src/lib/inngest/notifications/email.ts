/**
 * Inngest event consumers: email notification triggers.
 *
 * Each handler is a plain async function designed to be called inside
 * `step.run(...)` when the Inngest SDK is fully wired up (gives automatic
 * retry with 5 attempts and exponential backoff). Until then the functions
 * run sequentially as plain async helpers callable from tests or route handlers.
 *
 * Event → handler mapping:
 *   appointment/booked      → appointmentBookedEmailHandler
 *   call/qualified-lead     → qualifiedLeadEmailHandler
 *   credit/low-balance      → lowBalanceEmailHandler
 *   campaign/completed      → campaignCompletedEmailHandler
 *   auth/suspicious-login   → suspiciousLoginEmailHandler
 */

import {
  sendAppointmentBookedEmail,
  sendCampaignCompletedEmail,
  sendLowBalanceEmail,
  sendQualifiedLeadEmail,
  sendSuspiciousLoginEmail,
} from '@/lib/email/dispatcher';

import type { CampaignCompletedData } from '../campaigns/events';
import type { CreditLowBalanceData } from '../handlers/credit';
import type { AppointmentBookedData, CallQualifiedLeadData } from '../voice/events';
import type { AuthSuspiciousLoginData } from './events';

/** Handles `appointment/booked` — sends appointment confirmation email. */
export async function appointmentBookedEmailHandler(
  data: AppointmentBookedData,
): Promise<void> {
  await sendAppointmentBookedEmail({ orgId: data.orgId, appointmentId: data.appointmentId });
}

/** Handles `call/qualified-lead` — sends qualified lead notification email. */
export async function qualifiedLeadEmailHandler(data: CallQualifiedLeadData): Promise<void> {
  await sendQualifiedLeadEmail({ orgId: data.orgId, callId: data.callId });
}

/** Handles `credit/low-balance` — sends low-credit alert (at most once per 24 h per org). */
export async function lowBalanceEmailHandler(data: CreditLowBalanceData): Promise<void> {
  await sendLowBalanceEmail({ orgId: data.orgId });
}

/** Handles `campaign/completed` — sends campaign summary email. */
export async function campaignCompletedEmailHandler(
  data: CampaignCompletedData,
): Promise<void> {
  await sendCampaignCompletedEmail({ orgId: data.orgId, campaignId: data.campaignId });
}

/** Handles `auth/suspicious-login` — sends suspicious login alert email. */
export async function suspiciousLoginEmailHandler(
  data: AuthSuspiciousLoginData,
): Promise<void> {
  await sendSuspiciousLoginEmail({ userId: data.userId, signinId: data.signinId });
}

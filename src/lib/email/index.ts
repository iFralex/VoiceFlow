/**
 * Transactional email adapter (plan 11 task 9).
 *
 * Thin wrapper over Resend's HTTP API (`POST /emails`) so callers don't pull
 * the Resend SDK and tests can stub a single `sendEmail` function. When
 * `RESEND_API_KEY` is missing (e.g. SKIP_ENV_VALIDATION builds, local dev
 * without secrets) we log and no-op instead of throwing — the calling action
 * still succeeds because the user receives the URL inline as well.
 *
 * Plan 13 will introduce templated transactional emails (welcome, magic
 * link, suspicious-login, dealer notifications). This module exposes the
 * primitive they will build on.
 */

import { env } from '@/lib/env';

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export async function sendEmail(params: SendEmailParams): Promise<void> {
  const apiKey = env.RESEND_API_KEY;
  const fromAddress = env.EMAIL_FROM_ADDRESS;
  if (!apiKey || !fromAddress) {
    console.warn(
      `[email] sendEmail skipped — RESEND_API_KEY or EMAIL_FROM_ADDRESS missing (to=${params.to}, subject="${params.subject}")`,
    );
    return;
  }

  const replyTo = params.replyTo ?? env.EMAIL_REPLY_TO;

  const body: Record<string, unknown> = {
    from: fromAddress,
    to: params.to,
    subject: params.subject,
    html: params.html,
  };
  if (params.text) body['text'] = params.text;
  if (replyTo) body['reply_to'] = replyTo;

  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Resend send failed: ${response.status} ${response.statusText} ${text}`);
  }
}

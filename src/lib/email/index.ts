import type { ReactElement } from 'react';

import { db } from '@/lib/db/client';
import { emailLog } from '@/lib/db/schema/email_log';
import { env } from '@/lib/env';
import { logger } from '@/lib/observability/logger';

import { getResendClient } from './client';

export interface SendEmailParams {
  to: string;
  subject: string;
  html?: string;
  react?: ReactElement;
  text?: string;
  replyTo?: string;
  tags?: { name: string; value: string }[];
}

export async function sendEmail(params: SendEmailParams): Promise<void> {
  const apiKey = env.RESEND_API_KEY;
  const fromAddress = env.EMAIL_FROM_ADDRESS;
  if (!apiKey || !fromAddress) {
    void logger.warn('[email] sendEmail skipped — RESEND_API_KEY or EMAIL_FROM_ADDRESS missing', {
      to: params.to,
      subject: params.subject,
    });
    return;
  }

  const replyTo = params.replyTo ?? env.EMAIL_REPLY_TO;
  const client = getResendClient();

  const base = {
    from: fromAddress,
    to: params.to,
    subject: params.subject,
    ...(params.text !== undefined && { text: params.text }),
    ...(replyTo && { reply_to: replyTo }),
    ...(params.tags && { tags: params.tags }),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: any = params.react
    ? { ...base, react: params.react }
    : { ...base, html: params.html ?? '' };

  const { data, error } = await client.emails.send(payload);

  void db
    .insert(emailLog)
    .values({
      to_address: params.to,
      subject: params.subject,
      resend_id: data?.id ?? null,
      tags: params.tags ?? null,
      error: error ? error.message : null,
    })
    .catch((e: unknown) => void logger.error('[email] email_log insert failed', { error: e instanceof Error ? e.message : String(e) }));

  if (error) {
    throw new Error(`Resend send failed: ${error.message}`);
  }
}

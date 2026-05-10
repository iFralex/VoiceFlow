import { Resend } from 'resend';

import { env } from '@/lib/env';

let _client: Resend | null = null;

export function getResendClient(): Resend {
  if (!_client) {
    _client = new Resend(env.RESEND_API_KEY);
  }
  return _client;
}

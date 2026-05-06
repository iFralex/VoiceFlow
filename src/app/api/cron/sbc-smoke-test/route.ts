/**
 * SBC trunk smoke test cron — plan 10 task 15.
 *
 * Runs weekly on Sundays at 03:00 Europe/Rome (registered in `vercel.json`,
 * see the same cron-as-UTC convention used by the other CLI crons). On
 * failure, `runSbcSmokeTest` emits an `sbc/smoke-test-failed` Inngest event
 * for plan 13's notification handler — this route surfaces the same result
 * via the response so a human-triggered curl gets immediate feedback.
 *
 * Authenticates via the same `Authorization: Bearer ${CRON_SECRET}` header
 * as the other CLI crons (timing-safe compare).
 */

import { timingSafeEqual } from 'crypto';

import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { runSbcSmokeTest } from '@/lib/services/sbc_smoke_test';

function authorize(request: Request): boolean {
  const secret = env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  const expected = `Bearer ${secret}`;
  if (!auth || auth.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(auth), Buffer.from(expected));
}

export async function GET(request: Request): Promise<Response> {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await runSbcSmokeTest();
  // Failed smoke tests still return 200 so the Vercel cron isn't flagged
  // as broken — the Inngest event drives founder alerting. The body carries
  // `ok: false` and the failure classifier so curl-style invocations and
  // the audit log can distinguish success from failure.
  return NextResponse.json(result);
}

export const dynamic = 'force-dynamic';

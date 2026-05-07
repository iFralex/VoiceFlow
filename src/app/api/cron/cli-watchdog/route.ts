/**
 * CLI watchdog cron — plan 10 task 7.
 *
 * Runs daily at 02:00 Europe/Rome (registered in `vercel.json`). Re-scores
 * every active CLI in the pool from the last 24 hours of dispatched calls,
 * cools down spammy CLIs for 7 days, retires CLIs that cool down >2 times in
 * 30 days, and reactivates cooled-down CLIs whose 7-day window has expired.
 *
 * Authenticates via the same `Authorization: Bearer ${CRON_SECRET}` header
 * pattern as `cli-daily-reset` (timing-safe compare).
 */

import { timingSafeEqual } from 'crypto';

import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { runWatchdog } from '@/lib/services/cli_watchdog';
import { clearStaleSbcUnhealthyFlag } from '@/lib/services/system_flags';

function authorize(request: Request): boolean {
  const secret = env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!auth) return false;
  // Byte-length check (not string length) — multibyte UTF-8 headers can match
  // string length while differing in byte length, making timingSafeEqual throw.
  const authBuf = Buffer.from(auth);
  const expectedBuf = Buffer.from(`Bearer ${secret}`);
  if (authBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(authBuf, expectedBuf);
}

export async function GET(request: Request): Promise<Response> {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await runWatchdog();

  // Garbage-collect a stale `sbc_unhealthy` flag whose 30-minute auto-clear
  // window elapsed without a successful SBC dispatch (e.g. all dispatches
  // routed via Twilio fallback). Plan 10 task 13.
  let sbcFlagCleared = false;
  try {
    sbcFlagCleared = await clearStaleSbcUnhealthyFlag();
  } catch (err) {
    console.error('[cli-watchdog] Failed to clear stale SBC flag', err);
  }

  return NextResponse.json({ ok: true, sbcFlagCleared, ...result });
}

export const dynamic = 'force-dynamic';

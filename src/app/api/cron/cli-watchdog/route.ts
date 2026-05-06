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

  const result = await runWatchdog();
  return NextResponse.json({ ok: true, ...result });
}

export const dynamic = 'force-dynamic';

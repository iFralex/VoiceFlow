import { timingSafeEqual } from 'crypto';

import { ne } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { withSystemContext } from '@/lib/db/context';
import { phoneNumbers } from '@/lib/db/schema';
import { env } from '@/lib/env';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function authorize(request: Request): boolean {
  const secret = env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!auth) return false;
  // Compare on byte length, not string length: a multibyte UTF-8 header value
  // can match `expected.length` (string length) while differing in byte length,
  // which makes `timingSafeEqual` throw and the route return 500 instead of a
  // clean 401.
  const authBuf = Buffer.from(auth);
  const expectedBuf = Buffer.from(`Bearer ${secret}`);
  if (authBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(authBuf, expectedBuf);
}

// ---------------------------------------------------------------------------
// Reset routine
// ---------------------------------------------------------------------------

export interface DailyResetResult {
  reset: number;
}

/**
 * Resets `phone_numbers.daily_call_count` to 0 for every row whose count is
 * non-zero. The watchdog (plan 10 task 7) keeps `cooling_down` and `retired`
 * rows out of the picker via status filtering, but their daily counter still
 * gets reset here so that if a row is later reactivated to `active` it starts
 * a clean day.
 *
 * Returns the number of rows actually updated. Rows already at 0 are skipped
 * via the `ne` predicate, so the cron is cheap to run on a quiet pool.
 */
export async function resetDailyCallCounts(): Promise<DailyResetResult> {
  const updated = await withSystemContext((tx) =>
    tx
      .update(phoneNumbers)
      .set({ daily_call_count: 0 })
      .where(ne(phoneNumbers.daily_call_count, 0))
      .returning({ id: phoneNumbers.id }),
  );

  return { reset: updated.length };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<Response> {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await resetDailyCallCounts();
  return NextResponse.json({ ok: true, ...result });
}

// Disable static caching — this must always run fresh
export const dynamic = 'force-dynamic';

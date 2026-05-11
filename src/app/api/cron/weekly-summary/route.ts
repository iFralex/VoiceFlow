import { timingSafeEqual } from 'crypto';

import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { FLAGS, isFlagEnabled, shutdownPostHog } from '@/lib/feature-flags';
import { runWeeklySummary } from '@/lib/services/weekly-summary';

function authorize(request: Request): boolean {
  const secret = env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!auth) return false;
  const authBuf = Buffer.from(auth);
  const expectedBuf = Buffer.from(`Bearer ${secret}`);
  if (authBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(authBuf, expectedBuf);
}

export async function GET(request: Request): Promise<Response> {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const enabled = await isFlagEnabled('system', FLAGS.EMAIL_WEEKLY_SUMMARY, true);
  if (!enabled) {
    await shutdownPostHog();
    return NextResponse.json({ ok: true, skipped: 'flag_disabled' });
  }

  try {
    const result = await runWeeklySummary();
    return NextResponse.json({
      ok: true,
      range: {
        start: result.range.start.toISOString(),
        end: result.range.end.toISOString(),
      },
      orgsConsidered: result.orgsConsidered,
      orgsProcessed: result.orgsProcessed,
      orgsSkipped: result.orgsSkipped,
      orgsFailed: result.orgsFailed,
      emailsSent: result.emailsSent,
    });
  } finally {
    await shutdownPostHog();
  }
}

export const dynamic = 'force-dynamic';

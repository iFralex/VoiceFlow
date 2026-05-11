/**
 * Daily logical backup cron — plan 14 task 7.
 *
 * Runs at 03:30 Europe/Rome (02:30 UTC) every night. Delegates all work to
 * `runDatabaseBackup` which exports NDJSON, encrypts with AES-256-GCM, and
 * uploads the result to Backblaze B2. When backup credentials are not
 * configured the service returns `ok: false` with `error: backup_not_configured`
 * and this handler still returns 200 so the Vercel cron isn't flagged unhealthy.
 *
 * Authentication: `Authorization: Bearer ${CRON_SECRET}` (timing-safe compare).
 */

import { timingSafeEqual } from 'crypto';

import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { runDatabaseBackup } from '@/lib/services/backup';

function authorize(request: Request): boolean {
  const auth = request.headers.get('authorization');
  if (!auth) return false;
  const authBuf = Buffer.from(auth);
  const expectedBuf = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  if (authBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(authBuf, expectedBuf);
}

export async function GET(request: Request): Promise<Response> {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await runDatabaseBackup();
  return NextResponse.json(result);
}

export const dynamic = 'force-dynamic';

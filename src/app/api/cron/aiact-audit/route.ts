/**
 * Monthly AI Act conformance audit cron — plan 11 task 7.
 *
 * Runs on the 1st of each month at 06:00 (registered in `vercel.json`). Samples
 * up to 500 outbound calls created in the trailing 31 days, verifies each of
 * the three AI Act transparency layers (preamble in system prompt, disclosure
 * phrase in first message, disclosure phrase in transcript first 30 seconds),
 * and persists the result to `audit_log` with action
 * `compliance.aiact_audit_completed`. Plan 14's founder dashboard reads those
 * rows to surface the conformance numbers.
 *
 * Authenticates via the same `Authorization: Bearer ${CRON_SECRET}` header as
 * the other crons, with a byte-length-aware timing-safe compare.
 */

import { timingSafeEqual } from 'crypto';

import { NextResponse } from 'next/server';

import {
  type AiActAuditResult,
  runAiActConformanceAudit,
} from '@/lib/compliance/aiact/audit';
import { recordAudit } from '@/lib/db/audit';
import { withSystemContext } from '@/lib/db/context';
import { env } from '@/lib/env';
import { FLAGS, isFlagEnabled, shutdownPostHog } from '@/lib/feature-flags';

const DEFAULT_WINDOW_DAYS = 31;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function authorize(request: Request): boolean {
  const secret = env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!auth) return false;
  const authBuf = Buffer.from(auth);
  const expectedBuf = Buffer.from(`Bearer ${secret}`);
  if (authBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(authBuf, expectedBuf);
}

// ---------------------------------------------------------------------------
// Audit routine
// ---------------------------------------------------------------------------

export interface AiActAuditCronResult extends AiActAuditResult {
  ok: true;
}

export async function runAiActAuditCron(now: Date = new Date()): Promise<AiActAuditResult> {
  const windowEnd = now;
  const windowStart = new Date(
    windowEnd.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );

  const result = await runAiActConformanceAudit({ windowStart, windowEnd });

  await withSystemContext(async (tx) => {
    await recordAudit(tx, {
      actorType: 'system',
      action: 'compliance.aiact_audit_completed',
      subjectType: 'aiact',
      subjectId: 'monthly',
      metadata: {
        totalSampled: result.totalSampled,
        layer1Passed: result.layer1Passed,
        layer2Passed: result.layer2Passed,
        layer3Passed: result.layer3Passed,
        layer3NotApplicable: result.layer3NotApplicable,
        windowStart: result.windowStart,
        windowEnd: result.windowEnd,
        samples: result.samples,
      },
    });
  });

  return result;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<Response> {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const enabled = await isFlagEnabled('system', FLAGS.COMPLIANCE_AIACT_MONTHLY_AUDIT, true);
  if (!enabled) {
    await shutdownPostHog();
    return NextResponse.json({ ok: true, skipped: 'flag_disabled' });
  }

  try {
    const result = await runAiActAuditCron();
    return NextResponse.json({ ok: true, ...result });
  } finally {
    await shutdownPostHog();
  }
}

export const dynamic = 'force-dynamic';

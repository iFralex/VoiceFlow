import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { withSystemContext } from '@/lib/db/context';
import { getResendClient } from '@/lib/email/client';
import { env } from '@/lib/env';
import { stripe } from '@/lib/stripe/client';

interface CheckResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

async function checkDb(): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    await withSystemContext(async (tx) => {
      await tx.execute(sql`SELECT 1`);
    });
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function checkStripe(): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    await stripe.balance.retrieve();
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function checkVapi(): Promise<CheckResult> {
  if (!env.VAPI_API_KEY) return { ok: true }; // not configured — skip
  const t0 = Date.now();
  try {
    const res = await fetch('https://api.vapi.ai/assistant', {
      method: 'GET',
      headers: { Authorization: `Bearer ${env.VAPI_API_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok && res.status >= 500) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function checkResend(): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const client = getResendClient();
    await client.domains.list();
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET(): Promise<Response> {
  const [db, stripeCheck, vapi, resend] = await Promise.all([
    checkDb(),
    checkStripe(),
    checkVapi(),
    checkResend(),
  ]);

  const checks = { db, stripe: stripeCheck, vapi, resend };
  const allOk = Object.values(checks).every((c) => c.ok);

  return NextResponse.json(
    { status: allOk ? 'ok' : 'degraded', ts: new Date().toISOString(), checks },
    { status: allOk ? 200 : 503 },
  );
}

export const dynamic = 'force-dynamic';

import { and, eq, gte, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getAuthContext, hasCapability } from '@/lib/auth/context';
import { withOrgContext, withSystemContext } from '@/lib/db/context';
import { calls, campaigns, contactLists, contacts, scripts } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { dispatchCall } from '@/lib/services/calls';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TEST_CALLS_PER_DAY = 10;

// Italian E.164: +39 followed by 6–11 digits
// Covers mobile (+393XXXXXXXXX) and landline (+390XXXXXXXXX) formats.
const ITALIAN_E164_RE = /^\+39\d{6,11}$/;

// ---------------------------------------------------------------------------
// Body schema
// ---------------------------------------------------------------------------

const BodySchema = z.object({
  scriptId: z.string().uuid(),
  toNumber: z
    .string()
    .regex(ITALIAN_E164_RE, 'Must be a valid Italian E.164 phone number (e.g. +393331234567)'),
  voiceIdOverride: z.string().min(1).optional(),
});

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * POST /api/internal/test-call
 *
 * Dispatches a one-off test call for a script directly to the caller's phone.
 * Gated by the `org.manage` capability (owner-only).
 * Hard rate limit: 10 test calls per org per calendar day.
 *
 * Body: { scriptId: string; toNumber: string; voiceIdOverride?: string }
 * Returns: { callId: string }
 *
 * Security note: the provided phone number is validated as Italian E.164.
 * Full member phone-number verification (ensuring the number belongs to an org
 * member) requires user phone profiles which are not yet stored (plan 09+).
 * The primary security controls are the capability gate (owner-only) and the
 * rate limit (10/day per org).
 */
export async function POST(request: Request): Promise<Response> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  let orgId: string;
  let userId: string;
  let role: string;
  try {
    const ctx = await getAuthContext();
    orgId = ctx.orgId;
    userId = ctx.userId;
    role = ctx.role;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!hasCapability(role as Parameters<typeof hasCapability>[0], 'org.manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── Body parse ────────────────────────────────────────────────────────────
  let rawBody: unknown;
  try {
    rawBody = JSON.parse(await request.text());
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { scriptId, toNumber, voiceIdOverride } = parsed.data;

  // ── Rate limit ────────────────────────────────────────────────────────────
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [countRow] = await withOrgContext(orgId, (tx) =>
    tx
      .select({ n: sql<number>`cast(count(*) as int)` })
      .from(calls)
      .where(
        and(
          eq(calls.org_id, orgId),
          gte(calls.created_at, todayStart),
          sql`(${calls.metadata}->>'test_call')::text = 'true'`,
        ),
      ),
  );

  if ((countRow?.n ?? 0) >= MAX_TEST_CALLS_PER_DAY) {
    return NextResponse.json(
      { error: 'test_call_rate_limit_exceeded', limit: MAX_TEST_CALLS_PER_DAY },
      { status: 429 },
    );
  }

  // ── Verify script belongs to this org ────────────────────────────────────
  const [scriptRow] = await withOrgContext(orgId, (tx) =>
    tx
      .select({ id: scripts.id })
      .from(scripts)
      .where(and(eq(scripts.id, scriptId), eq(scripts.org_id, orgId)))
      .limit(1),
  );

  if (!scriptRow) {
    return NextResponse.json({ error: 'Script not found' }, { status: 404 });
  }

  // ── Create synthetic test records ─────────────────────────────────────────
  // The calls table requires campaign_id and contact_id FK columns. We create
  // ephemeral records to satisfy those constraints. These records are tagged
  // so they can be identified and cleaned up separately if needed.
  const now = new Date().toISOString();

  const callId = await withOrgContext(orgId, async (tx) => {
    // 1. Ephemeral contact list
    const [list] = await tx
      .insert(contactLists)
      .values({
        org_id: orgId,
        name: `__test_call__ ${now}`,
        source: 'api',
        import_status: 'completed',
        total_count: 1,
        valid_count: 1,
      })
      .returning({ id: contactLists.id });

    // 2. Ephemeral contact with the target phone number
    const [contact] = await tx
      .insert(contacts)
      .values({
        org_id: orgId,
        contact_list_id: list!.id,
        phone_e164: toNumber,
        consent_basis: 'legitimate_interest',
        contact_type: 'b2c',
      })
      .returning({ id: contacts.id });

    // 3. Ephemeral campaign tied to the requested script
    const [campaign] = await tx
      .insert(campaigns)
      .values({
        org_id: orgId,
        script_id: scriptId,
        contact_list_id: list!.id,
        name: `__test_call__ ${now}`,
        status: 'running',
      })
      .returning({ id: campaigns.id });

    // 4. Pending call record — metadata marks it as a test call and stores
    //    the optional voice override so dispatchCall can apply it.
    const [call] = await tx
      .insert(calls)
      .values({
        org_id: orgId,
        campaign_id: campaign!.id,
        contact_id: contact!.id,
        provider: (env.VOICE_PROVIDER ?? 'vapi') as 'vapi' | 'retell',
        status: 'pending',
        metadata: {
          test_call: true,
          initiated_by: userId,
          voice_id_override: voiceIdOverride ?? null,
        },
      })
      .returning({ id: calls.id });

    return call!.id;
  });

  // ── Dispatch the call ─────────────────────────────────────────────────────
  // Runs outside the transaction so a long-running provider HTTP call does not
  // hold the DB connection open.
  try {
    await dispatchCall(orgId, callId);
  } catch (err) {
    // Mark the call as failed in a best-effort manner
    await withSystemContext((tx) =>
      tx
        .update(calls)
        .set({
          status: 'failed',
          error_code: err instanceof Error ? err.message : 'dispatch_failed',
        })
        .where(eq(calls.id, callId)),
    );

    const message = err instanceof Error ? err.message : 'dispatch_failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ callId });
}

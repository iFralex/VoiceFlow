import { createHmac, timingSafeEqual } from 'crypto';

import { and, eq, gte } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { recordAudit } from '@/lib/db/audit';
import { withSystemContext } from '@/lib/db/context';
import { authSignins, webhookEvents } from '@/lib/db/schema';
import { env } from '@/lib/env';

// ---------------------------------------------------------------------------
// Payload schema
// ---------------------------------------------------------------------------

/**
 * Flexible schema that covers both Supabase Auth Hook payloads and Database
 * Webhook payloads triggered by changes to auth.sessions.
 */
const supabaseAuthEventSchema = z.object({
  /** Stable event ID for deduplication (optional — generated from type+user+ts when absent). */
  event_id: z.string().optional(),
  /** Event type string: "SIGNED_IN", "LOGIN", "SIGNUP", "TOKEN_REFRESHED", etc. */
  type: z.string(),
  /** User object (Auth Hook format). */
  user: z
    .object({
      id: z.string().uuid(),
      email: z.string().email().optional(),
    })
    .optional(),
  /** Direct user_id (Database Webhook format). */
  user_id: z.string().uuid().optional(),
  /** Client IP address included by some Supabase hook configurations. */
  ip_address: z.string().optional(),
  /** Client user-agent included by some Supabase hook configurations. */
  user_agent: z.string().optional(),
});

type SupabaseAuthEvent = z.infer<typeof supabaseAuthEventSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Verifies HMAC-SHA256 signature using timing-safe comparison. */
function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  try {
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

/** Returns true when the event type represents a user sign-in. */
function isSigninEvent(type: string): boolean {
  const lower = type.toLowerCase();
  return (
    lower === 'signed_in' ||
    lower === 'login' ||
    lower === 'signup' ||
    lower === 'token_refreshed' ||
    lower.includes('sign_in')
  );
}

/**
 * Stub: enqueues a suspicious-login email alert.
 * Full implementation deferred to plan 13 (Resend integration).
 */
async function enqueueSuspiciousLoginAlert(
  userId: string,
  ip: string,
  userAgent: string,
): Promise<void> {
  // TODO(plan-13): Send suspicious-login email via Resend template
  // Payload for the future job: { userId, ip, userAgent, detectedAt: new Date() }
  // For now this is intentionally a no-op stub — the audit entry written inside
  // the DB transaction is the durable record.
  void userId;
  void ip;
  void userAgent;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();

  // Verify HMAC-SHA256 signature when provided.
  // The header is sent by Supabase or the internal test harness.
  const signature = request.headers.get('x-supabase-signature');
  if (signature !== null) {
    if (!verifySignature(rawBody, signature, env.INTERNAL_WEBHOOK_SECRET)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  }

  // Parse the JSON payload.
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = supabaseAuthEventSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const event: SupabaseAuthEvent = parsed.data;
  const userId = event.user?.id ?? event.user_id;

  if (!userId) {
    // No user context — acknowledge and skip processing.
    return NextResponse.json({ ok: true });
  }

  // Generate a stable event ID for deduplication.
  const eventId = event.event_id ?? `${event.type}:${userId}:${Date.now()}`;

  // Insert into webhook_events for deduplication.
  // onConflictDoNothing returns empty array when the row already exists.
  const inserted = await withSystemContext(async (tx) =>
    tx
      .insert(webhookEvents)
      .values({
        provider: 'supabase_auth',
        provider_event_id: eventId,
        event_type: event.type,
        payload: payload as Record<string, unknown>,
      })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id }),
  );

  if (inserted.length === 0) {
    // Already processed — acknowledge and skip.
    return NextResponse.json({ ok: true });
  }

  if (!isSigninEvent(event.type)) {
    return NextResponse.json({ ok: true });
  }

  // Extract IP and user-agent from payload or request headers.
  const ip =
    event.ip_address ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    '0.0.0.0';
  const userAgent = event.user_agent ?? request.headers.get('user-agent') ?? '';

  // Check for new IP+UA fingerprint and record the signin.
  let isNewFingerprint = false;

  await withSystemContext(async (tx) => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [existing] = await tx
      .select({ id: authSignins.id })
      .from(authSignins)
      .where(
        and(
          eq(authSignins.user_id, userId),
          eq(authSignins.ip, ip),
          eq(authSignins.user_agent, userAgent),
          gte(authSignins.signed_in_at, thirtyDaysAgo),
        ),
      )
      .limit(1);

    isNewFingerprint = !existing;

    // Always record the fingerprint.
    await tx.insert(authSignins).values({ user_id: userId, ip, user_agent: userAgent });

    if (isNewFingerprint) {
      await recordAudit(tx, {
        actorType: 'webhook',
        actorUserId: userId,
        action: 'auth.new_device_signin',
        subjectType: 'user',
        subjectId: userId,
        metadata: { ip, user_agent: userAgent },
      });
    }
  });

  if (isNewFingerprint) {
    await enqueueSuspiciousLoginAlert(userId, ip, userAgent);
  }

  return NextResponse.json({ ok: true });
}

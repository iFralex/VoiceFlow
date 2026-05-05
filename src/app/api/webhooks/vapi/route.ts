import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { withOrgContext, withSystemContext } from '@/lib/db/context';
import { calls, webhookEvents } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { recordCallEnded, recordCallStarted, recordToolInvocation } from '@/lib/services/calls';

// ---------------------------------------------------------------------------
// Vapi payload types (minimal — only fields we consume)
// ---------------------------------------------------------------------------

interface VapiCallObject {
  id: string;
  metadata?: {
    callId?: string;
    orgId?: string;
    campaignId?: string;
    contactId?: string;
  };
  endedReason?: string;
  /** Call duration in seconds, provided on call-end events */
  duration?: number;
  recordingUrl?: string;
  artifact?: {
    recordingUrl?: string;
  };
}

interface VapiFunctionCall {
  name: string;
  parameters?: unknown;
}

interface VapiMessage {
  type: string;
  call?: VapiCallObject;
  functionCall?: VapiFunctionCall;
  status?: string;
}

interface VapiWebhookPayload {
  message?: VapiMessage;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a stable, content-addressable provider event ID for idempotent deduplication.
 * - call-start / call-end: one per call
 * - function-call: one per tool name per call
 * - status-update: one per status value per call
 */
function buildProviderEventId(providerCallId: string, eventType: string, extra?: string): string {
  const parts = [providerCallId, eventType];
  if (extra) parts.push(extra);
  return parts.join(':');
}

/**
 * Maps a Vapi `status-update` status value to our call status enum.
 * Returns null when the status has no meaningful mapping (no DB write needed).
 */
function mapVapiStatusToCallStatus(
  vapiStatus: string,
): 'dialing' | 'in_progress' | null {
  switch (vapiStatus.toLowerCase()) {
    case 'queued':
    case 'ringing':
      return 'dialing';
    case 'in-progress':
      return 'in_progress';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();

  // Verify shared secret. Vapi sends the configured serverUrlSecret as x-vapi-secret.
  const incomingSecret = request.headers.get('x-vapi-secret');
  if (!env.VAPI_WEBHOOK_SECRET || incomingSecret !== env.VAPI_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: VapiWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as VapiWebhookPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const msg = payload.message;
  if (!msg) {
    // Acknowledge unrecognised payload shapes without processing
    return NextResponse.json({ ok: true });
  }

  const eventType = msg.type;
  const providerCallId = msg.call?.id ?? 'unknown';
  const callId = msg.call?.metadata?.callId ?? null;

  const providerEventId = buildProviderEventId(
    providerCallId,
    eventType,
    eventType === 'function-call' ? (msg.functionCall?.name ?? undefined) : undefined,
  );

  // Persist event for observability and deduplication.
  // onConflictDoNothing returns [] if the event was already received.
  const [inserted] = await withSystemContext(async (tx) =>
    tx
      .insert(webhookEvents)
      .values({
        provider: 'vapi',
        provider_event_id: providerEventId,
        event_type: eventType,
        payload: payload as unknown as Record<string, unknown>,
      })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id }),
  );

  if (!inserted) {
    // Already processed — acknowledge without re-running handlers
    return NextResponse.json({ ok: true });
  }

  let processingError: string | null = null;

  try {
    switch (eventType) {
      // ── call started ──────────────────────────────────────────────────────
      case 'call-start':
      case 'call.started':
        if (callId) {
          await recordCallStarted(callId, providerCallId);
        }
        break;

      // ── call ended ────────────────────────────────────────────────────────
      case 'call-end':
      case 'call.ended': {
        if (callId && msg.call) {
          const callObj = msg.call;
          const recordingUrl = callObj.artifact?.recordingUrl ?? callObj.recordingUrl;
          await recordCallEnded(callId, {
            durationSeconds: callObj.duration ?? 0,
            endedReason: callObj.endedReason ?? 'completed',
            ...(recordingUrl !== undefined && { recordingUrl }),
          });
        }
        break;
      }

      // ── tool / function call ──────────────────────────────────────────────
      case 'function-call': {
        if (callId && msg.functionCall) {
          await recordToolInvocation(callId, msg.functionCall.name, msg.functionCall.parameters ?? null);
        }
        break;
      }

      // ── partial transcript ────────────────────────────────────────────────
      case 'transcript':
      case 'transcript.partial':
        // Ignored — final transcript is fetched after call-end via fetchTranscript
        break;

      // ── status update ─────────────────────────────────────────────────────
      case 'status-update': {
        if (callId && msg.status) {
          const mappedStatus = mapVapiStatusToCallStatus(msg.status);
          if (mappedStatus === 'in_progress') {
            // Reuse the idempotent recordCallStarted handler for the in_progress transition
            await recordCallStarted(callId, providerCallId);
          } else if (mappedStatus === 'dialing') {
            // Call is still ringing/queued — look up org_id and update status
            const [row] = await withSystemContext((tx) =>
              tx
                .select({ org_id: calls.org_id })
                .from(calls)
                .where(eq(calls.id, callId))
                .limit(1),
            );
            if (row) {
              await withOrgContext(row.org_id, async (tx) => {
                await tx
                  .update(calls)
                  .set({ status: 'dialing' })
                  .where(eq(calls.id, callId));
              });
            }
          }
          // Other statuses: no-op (terminal statuses handled by call-end)
        }
        break;
      }

      default:
        // Unknown event type — payload persisted for visibility; no handler needed
        break;
    }

    // Mark the event as successfully processed
    await withSystemContext(async (tx) => {
      await tx
        .update(webhookEvents)
        .set({ processed_at: new Date() })
        .where(
          and(
            eq(webhookEvents.provider, 'vapi'),
            eq(webhookEvents.provider_event_id, providerEventId),
          ),
        );
    });
  } catch (err) {
    processingError = err instanceof Error ? err.message : 'Unknown processing error';

    // Signature was valid so return 200 — avoid Vapi retries on business-logic failures.
    // The error is recorded for later investigation.
    await withSystemContext(async (tx) => {
      await tx
        .update(webhookEvents)
        .set({ error: processingError })
        .where(
          and(
            eq(webhookEvents.provider, 'vapi'),
            eq(webhookEvents.provider_event_id, providerEventId),
          ),
        );
    });
  }

  return NextResponse.json({ ok: true });
}

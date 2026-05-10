/**
 * Inngest handler: webhook-deliver
 *
 * Delivers a signed webhook payload to a subscriber's URL and persists the
 * delivery attempt. On failure, schedules retries with exponential backoff
 * (1m, 5m, 15m, 1h, 6h, 24h — 6 attempts max). After 6 consecutive failures
 * the webhook is deactivated and the org owner receives an email notification.
 *
 * Envelope format:
 *   {
 *     id: string (UUID),
 *     event: string,
 *     occurred_at: ISO 8601,
 *     org_id: string,
 *     data: Record<string, unknown>,
 *   }
 *
 * HMAC-SHA256 signature sent in `x-vox-signature: sha256=<hex>` header.
 */

import crypto from 'node:crypto';

import { and, eq, isNotNull, sql } from 'drizzle-orm';

import { withSystemContext } from '@/lib/db/context';
import { memberships, organizations, users, webhookDeliveries, webhooksOutgoing } from '@/lib/db/schema';
import { sendEmail } from '@/lib/email';
import { sendInngestEvent } from '@/lib/inngest/client';

// ─── Constants ────────────────────────────────────────────────────────────────

const DELIVERY_TIMEOUT_MS = 10_000;
const MAX_FAILURES = 6;

/** Delays between retry attempts in milliseconds (index = attempt - 1). */
const BACKOFF_DELAYS_MS = [
  1 * 60 * 1000,       // attempt 1 fails → wait 1m
  5 * 60 * 1000,       // attempt 2 fails → wait 5m
  15 * 60 * 1000,      // attempt 3 fails → wait 15m
  60 * 60 * 1000,      // attempt 4 fails → wait 1h
  6 * 60 * 60 * 1000,  // attempt 5 fails → wait 6h
  24 * 60 * 60 * 1000, // attempt 6 fails → wait 24h (should not reach; deactivated at 6)
];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WebhookDeliverData {
  webhookId: string;
  eventType: string;
  payload: Record<string, unknown>;
  /** 1-indexed delivery attempt number; defaults to 1. */
  attempt?: number;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

/**
 * Handles the `webhook/deliver` event.
 *
 * Designed to be called inside `step.run(...)` when the Inngest SDK is fully
 * wired up. Until then it is a plain async helper callable from tests or directly.
 */
export async function webhookDeliverHandler(data: WebhookDeliverData): Promise<void> {
  const attempt = data.attempt ?? 1;

  const webhook = await withSystemContext((tx) =>
    tx
      .select()
      .from(webhooksOutgoing)
      .where(eq(webhooksOutgoing.id, data.webhookId))
      .limit(1)
      .then((rows) => rows[0]),
  );

  if (!webhook) return; // webhook deleted — nothing to deliver
  if (!webhook.active) return; // already deactivated — stop processing

  // Build canonical envelope — id is deterministic so retries carry the same value,
  // allowing receivers to deduplicate on it.
  const envelope = {
    id: `${data.webhookId}:${data.eventType}:${attempt}`,
    event: data.eventType,
    occurred_at: new Date().toISOString(),
    org_id: webhook.org_id,
    data: data.payload,
  };
  const body = JSON.stringify(envelope);
  const signature = crypto.createHmac('sha256', webhook.secret).update(body).digest('hex');

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-vox-event': data.eventType,
    'x-vox-event-id': envelope.id,
    'x-vox-signature': `sha256=${signature}`,
    'x-vox-timestamp': Math.floor(Date.now() / 1000).toString(),
  };

  // Attempt HTTP delivery
  let statusCode: number | null = null;
  let deliveryError: string | null = null;
  let succeeded = false;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      statusCode = response.status;
      succeeded = response.ok;
      if (!response.ok) {
        deliveryError = `HTTP ${response.status} ${response.statusText}`;
      }
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    deliveryError = isAbort
      ? `Request timed out after ${DELIVERY_TIMEOUT_MS / 1000}s`
      : err instanceof Error
        ? err.message
        : 'Unknown error';
  }

  // Persist delivery attempt regardless of outcome
  await withSystemContext((tx) =>
    tx.insert(webhookDeliveries).values({
      webhook_id: data.webhookId,
      event_type: data.eventType,
      payload: data.payload,
      status_code: statusCode,
      attempt,
      delivered_at: new Date(),
      ...(deliveryError ? { error: deliveryError } : {}),
    }),
  );

  if (succeeded) {
    await withSystemContext((tx) =>
      tx
        .update(webhooksOutgoing)
        .set({ failure_count: 0, last_delivery_at: new Date() })
        .where(eq(webhooksOutgoing.id, data.webhookId)),
    );
    return;
  }

  // Delivery failed — atomically increment failure count and read the new value.
  const [updated] = await withSystemContext((tx) =>
    tx
      .update(webhooksOutgoing)
      .set({ failure_count: sql`${webhooksOutgoing.failure_count} + 1`, last_failure_at: new Date() })
      .where(eq(webhooksOutgoing.id, data.webhookId))
      .returning({ failureCount: webhooksOutgoing.failure_count }),
  );
  const newFailureCount = updated?.failureCount ?? MAX_FAILURES;

  if (newFailureCount >= MAX_FAILURES) {
    await withSystemContext((tx) =>
      tx
        .update(webhooksOutgoing)
        .set({ active: false })
        .where(eq(webhooksOutgoing.id, data.webhookId)),
    );
    await notifyWebhookDisabled(webhook.org_id, webhook.url);
    return;
  }

  // Schedule next retry with exponential backoff
  const delayMs = BACKOFF_DELAYS_MS[attempt - 1] ?? BACKOFF_DELAYS_MS[BACKOFF_DELAYS_MS.length - 1]!;
  const nextAttempt = attempt + 1;

  await sendInngestEvent({
    name: 'webhook/deliver',
    data: {
      webhookId: data.webhookId,
      eventType: data.eventType,
      payload: data.payload,
      attempt: nextAttempt,
    } satisfies WebhookDeliverData,
    ts: Date.now() + delayMs,
    id: `webhook-deliver-${data.webhookId}-attempt-${nextAttempt}`,
  });
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function notifyWebhookDisabled(orgId: string, webhookUrl: string): Promise<void> {
  const owners = await withSystemContext((tx) =>
    tx
      .select({
        email: users.email,
        fullName: users.full_name,
        locale: users.locale,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.user_id))
      .innerJoin(organizations, eq(organizations.id, memberships.org_id))
      .where(
        and(
          eq(memberships.org_id, orgId),
          eq(memberships.role, 'owner'),
          isNotNull(memberships.accepted_at),
        ),
      ),
  );

  const safeUrl = escapeHtml(webhookUrl);

  for (const owner of owners) {
    const locale = owner.locale === 'en' ? 'en' : 'it';

    const { subject, html, text } =
      locale === 'en'
        ? {
            subject: `Webhook deactivated — ${webhookUrl}`,
            html: `<p>Your webhook at <strong>${safeUrl}</strong> has been automatically deactivated after ${MAX_FAILURES} consecutive delivery failures.</p><p>Please check your endpoint and re-enable the webhook from the <a href="/settings/integrations">integrations settings page</a>.</p>`,
            text: `Your webhook at ${webhookUrl} has been automatically deactivated after ${MAX_FAILURES} consecutive delivery failures. Please check your endpoint and re-enable the webhook from the integrations settings page.`,
          }
        : {
            subject: `Webhook disabilitato — ${webhookUrl}`,
            html: `<p>Il tuo webhook <strong>${safeUrl}</strong> è stato disabilitato automaticamente dopo ${MAX_FAILURES} tentativi di consegna falliti consecutivi.</p><p>Verifica il tuo endpoint e riattiva il webhook dalla <a href="/settings/integrations">pagina delle impostazioni di integrazione</a>.</p>`,
            text: `Il tuo webhook ${webhookUrl} è stato disabilitato automaticamente dopo ${MAX_FAILURES} tentativi di consegna falliti consecutivi. Verifica il tuo endpoint e riattiva il webhook dalla pagina delle impostazioni di integrazione.`,
          };

    await sendEmail({
      to: owner.email,
      subject,
      html,
      text,
      tags: [
        { name: 'template', value: 'webhook-disabled' },
        { name: 'org_id', value: orgId },
      ],
    });
  }
}

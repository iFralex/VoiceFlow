'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthContext, requireCapability } from '@/lib/auth/context';
import type { WebhookDelivery, WebhookOutgoing } from '@/lib/db/schema';
import {
  ALLOWED_EVENT_TYPES,
  createWebhook,
  deleteWebhook,
  listDeliveries,
  replayDelivery,
  rotateSecret,
} from '@/lib/services/webhooks_outgoing';
import type { ActionResult } from '@/lib/utils/action-toast';

function isPrivateOrLoopbackUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    if (hostname === 'localhost' || hostname === '0.0.0.0') return true;
    // IPv6 loopback, link-local (fe80::/10), and unique-local (fc00::/7) ranges.
    // URL.hostname returns bracketed IPv6 literals, e.g. "[::1]".
    if (hostname === '[::1]' || hostname === '[0:0:0:0:0:0:0:1]') return true;
    if (/^\[fe80:/i.test(hostname) || /^\[fc/i.test(hostname) || /^\[fd/i.test(hostname)) return true;
    // IPv4-mapped IPv6 addresses (::ffff:0:0/96) can reach IPv4 private ranges.
    if (/^\[::ffff:/i.test(hostname)) return true;
    const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
    if (ipv4) {
      const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
      return (
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168)
      );
    }
    return false;
  } catch {
    return false;
  }
}

const createWebhookSchema = z.object({
  url: z
    .string()
    .url('url_invalid')
    .refine((u) => u.startsWith('https://'), 'url_must_be_https')
    .refine((u) => !isPrivateOrLoopbackUrl(u), 'url_must_be_public'),
  eventTypes: z.array(z.enum(ALLOWED_EVENT_TYPES)).min(1, 'event_types_required'),
});

const webhookIdSchema = z.object({
  webhookId: z.string().uuid(),
});

const deliveryIdSchema = z.object({
  deliveryId: z.string().uuid(),
});

const listDeliveriesSchema = z.object({
  webhookId: z.string().uuid(),
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

export async function createWebhookAction(input: {
  url: string;
  eventTypes: string[];
}): Promise<ActionResult & { secretRevealed?: string; webhook?: WebhookOutgoing }> {
  const parsed = createWebhookSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: issue?.message ?? 'validation_error' };
  }

  await requireCapability('webhooks.manage');
  const { userId, orgId } = await getAuthContext();

  try {
    const result = await createWebhook(orgId, userId, {
      url: parsed.data.url,
      eventTypes: parsed.data.eventTypes,
    });
    revalidatePath('/settings/integrations');
    return { ok: true, secretRevealed: result.secretRevealed, webhook: result.webhook };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'error_generic';
    return { ok: false, message };
  }
}

export async function deleteWebhookAction(input: { webhookId: string }): Promise<ActionResult> {
  const parsed = webhookIdSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: issue?.message ?? 'validation_error' };
  }

  await requireCapability('webhooks.manage');
  const { userId, orgId } = await getAuthContext();

  try {
    await deleteWebhook(orgId, userId, parsed.data.webhookId);
    revalidatePath('/settings/integrations');
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'error_generic';
    return { ok: false, message };
  }
}

export async function rotateSecretAction(input: {
  webhookId: string;
}): Promise<ActionResult & { secretRevealed?: string }> {
  const parsed = webhookIdSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: issue?.message ?? 'validation_error' };
  }

  await requireCapability('webhooks.manage');
  const { userId, orgId } = await getAuthContext();

  try {
    const result = await rotateSecret(orgId, userId, parsed.data.webhookId);
    revalidatePath('/settings/integrations');
    return { ok: true, secretRevealed: result.secretRevealed };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'error_generic';
    return { ok: false, message };
  }
}

export async function listDeliveriesAction(input: {
  webhookId: string;
  limit?: number;
  cursor?: string;
}): Promise<
  ActionResult & {
    items?: Array<Omit<WebhookDelivery, 'delivered_at'> & { delivered_at: string | null }>;
    nextCursor?: string;
  }
> {
  const parsed = listDeliveriesSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: issue?.message ?? 'validation_error' };
  }

  await requireCapability('webhooks.manage');
  const { orgId } = await getAuthContext();

  try {
    const pageArg: { limit: number; cursor?: string } = { limit: parsed.data.limit };
    if (parsed.data.cursor) pageArg.cursor = parsed.data.cursor;

    const result = await listDeliveries(orgId, parsed.data.webhookId, pageArg);
    const out: ActionResult & {
      items?: Array<Omit<WebhookDelivery, 'delivered_at'> & { delivered_at: string | null }>;
      nextCursor?: string;
    } = {
      ok: true,
      items: result.items.map((d) => ({
        ...d,
        delivered_at: d.delivered_at?.toISOString() ?? null,
      })),
    };
    if (result.nextCursor) out.nextCursor = result.nextCursor;
    return out;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'error_generic';
    return { ok: false, message };
  }
}

export async function replayDeliveryAction(input: { deliveryId: string }): Promise<ActionResult> {
  const parsed = deliveryIdSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: issue?.message ?? 'validation_error' };
  }

  await requireCapability('webhooks.manage');
  const { userId, orgId } = await getAuthContext();

  try {
    await replayDelivery(orgId, userId, parsed.data.deliveryId);
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'error_generic';
    return { ok: false, message };
  }
}

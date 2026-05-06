'use server';

import { z } from 'zod';

import { getAuthContext, requireCapability } from '@/lib/auth/context';
import {
  cancelCampaign as cancelCampaignService,
  createCampaign as createCampaignService,
  duplicateCampaign as duplicateCampaignService,
  launchCampaign as launchCampaignService,
  pauseCampaign as pauseCampaignService,
  resumeCampaign as resumeCampaignService,
} from '@/lib/services/campaigns';
import type { ActionResult } from '@/lib/utils/action-toast';

// ─── Error message mapping ─────────────────────────────────────────────────────

/**
 * Maps service-layer error codes to i18n keys under the `campaigns` namespace.
 * The client uses these keys with `t()` to display localised toast messages.
 */
const ERROR_MAP: Record<string, string> = {
  no_eligible_contacts: 'error_no_eligible',
  insufficient_credit: 'error_no_credit',
  no_billing_rate: 'error_no_billing_rate',
  campaign_not_found: 'error_not_found',
  campaign_not_launchable: 'error_not_launchable',
  campaign_not_running: 'error_not_running',
  campaign_not_paused: 'error_not_paused',
  campaign_already_terminal: 'error_already_terminal',
};

function mapErrorMessage(e: unknown): string {
  if (e instanceof Error) {
    return ERROR_MAP[e.message] ?? e.message;
  }
  return 'error';
}

// ─── Create (+ optionally launch) ─────────────────────────────────────────────

const createCampaignSchema = z
  .object({
    name: z.string().min(1, 'Nome obbligatorio').max(200, 'Nome troppo lungo'),
    scriptId: z.string().uuid(),
    contactListId: z.string().uuid(),
    /** ISO 8601 string (from datetime-local input, converted via new Date().toISOString()) */
    scheduledStart: z.string().optional(),
    concurrencyLimit: z.number().int().min(1).max(20).optional(),
    timeWindowStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    timeWindowEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    /** When true, call launchCampaign immediately after creating. */
    launch: z.boolean().default(false),
  })
  .refine(
    (v) => {
      // Both omitted, or only one present (the other defaults server-side) → OK
      if (!v.timeWindowStart || !v.timeWindowEnd) return true;
      return v.timeWindowStart < v.timeWindowEnd;
    },
    {
      message: 'time_window_invalid',
      path: ['timeWindowEnd'],
    },
  );

/**
 * Creates a campaign (draft or scheduled), and optionally launches it immediately.
 *
 * Returns `{ ok: true, campaignId }` on success.
 * Returns `{ ok: false, message }` on validation error or service error.
 *
 * Requires `campaigns.launch` capability.
 */
export async function createCampaignAction(
  input: z.infer<typeof createCampaignSchema>,
): Promise<ActionResult & { campaignId?: string }> {
  const parsed = createCampaignSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'validation_error' };
  }

  try {
    const { orgId, userId } = await getAuthContext();
    await requireCapability('campaigns.launch');

    const {
      name,
      scriptId,
      contactListId,
      scheduledStart,
      concurrencyLimit,
      timeWindowStart,
      timeWindowEnd,
      launch,
    } = parsed.data;

    const campaign = await createCampaignService(orgId, userId, {
      name,
      scriptId,
      contactListId,
      ...(scheduledStart ? { scheduledStart: new Date(scheduledStart) } : {}),
      ...(concurrencyLimit !== undefined ? { concurrencyLimit } : {}),
      ...(timeWindowStart !== undefined ? { timeWindowStart } : {}),
      ...(timeWindowEnd !== undefined ? { timeWindowEnd } : {}),
    });

    if (launch) {
      await launchCampaignService(orgId, userId, campaign.id);
    }

    return { ok: true, campaignId: campaign.id };
  } catch (e) {
    return { ok: false, message: mapErrorMessage(e) };
  }
}

// ─── Pause ─────────────────────────────────────────────────────────────────────

const campaignIdSchema = z.object({ campaignId: z.string().uuid() });

export async function pauseCampaignAction(
  input: z.infer<typeof campaignIdSchema>,
): Promise<ActionResult> {
  const parsed = campaignIdSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'validation_error' };
  }
  try {
    const { orgId, userId } = await getAuthContext();
    await requireCapability('campaigns.launch');
    await pauseCampaignService(orgId, userId, parsed.data.campaignId);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: mapErrorMessage(e) };
  }
}

// ─── Resume ────────────────────────────────────────────────────────────────────

export async function resumeCampaignAction(
  input: z.infer<typeof campaignIdSchema>,
): Promise<ActionResult> {
  const parsed = campaignIdSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'validation_error' };
  }
  try {
    const { orgId, userId } = await getAuthContext();
    await requireCapability('campaigns.launch');
    await resumeCampaignService(orgId, userId, parsed.data.campaignId);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: mapErrorMessage(e) };
  }
}

// ─── Cancel ────────────────────────────────────────────────────────────────────

export async function cancelCampaignAction(
  input: z.infer<typeof campaignIdSchema>,
): Promise<ActionResult> {
  const parsed = campaignIdSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'validation_error' };
  }
  try {
    const { orgId, userId } = await getAuthContext();
    await requireCapability('campaigns.launch');
    await cancelCampaignService(orgId, userId, parsed.data.campaignId);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: mapErrorMessage(e) };
  }
}

// ─── Duplicate ─────────────────────────────────────────────────────────────────

export async function duplicateCampaignAction(
  input: z.infer<typeof campaignIdSchema>,
): Promise<ActionResult & { campaignId?: string }> {
  const parsed = campaignIdSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'validation_error' };
  }
  try {
    const { orgId, userId } = await getAuthContext();
    await requireCapability('campaigns.launch');
    const copy = await duplicateCampaignService(orgId, userId, parsed.data.campaignId);
    return { ok: true, campaignId: copy.id };
  } catch (e) {
    return { ok: false, message: mapErrorMessage(e) };
  }
}

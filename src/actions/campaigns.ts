'use server';

import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { getAuthContext, requireCapability } from '@/lib/auth/context';
import { recordAudit } from '@/lib/db/audit';
import { withOrgContext } from '@/lib/db/context';
import {
  CAMPAIGN_EXPORT_REQUESTED_EVENT,
  type CampaignExportFilters,
  type CampaignExportRequestedData,
} from '@/lib/inngest/campaigns/events';
import { sendInngestEvent } from '@/lib/inngest/client';
import { logger } from '@/lib/observability/logger';
import {
  campaignResultsToCsv,
  collectCampaignResultsForExport,
  type CampaignCallOutcome,
  type CampaignResultsExportFilters,
} from '@/lib/services/campaign-results';
import {
  cancelCampaign as cancelCampaignService,
  createCampaign as createCampaignService,
  duplicateCampaign as duplicateCampaignService,
  launchCampaign as launchCampaignService,
  pauseCampaign as pauseCampaignService,
  resumeCampaign as resumeCampaignService,
} from '@/lib/services/campaigns';
import { CSV_UPLOADS_BUCKET } from '@/lib/storage/signed';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { ActionResult } from '@/lib/utils/action-toast';

const EXPORT_INLINE_LIMIT = 5_000;
const EXPORT_SIGNED_URL_TTL_SECONDS = 3_600;

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
  dpa_outdated: 'error_dpa_outdated',
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

// ─── Export results CSV ───────────────────────────────────────────────────────

const OUTCOME_VALUES: readonly CampaignCallOutcome[] = [
  'interested',
  'not_interested',
  'appointment_booked',
  'wrong_number',
  'callback_requested',
  'voicemail_left',
  'voicemail_no_message',
  'do_not_call',
] as const;

const exportResultsSchema = z.object({
  campaignId: z.string().uuid(),
  outcomes: z.array(z.enum(OUTCOME_VALUES as unknown as [string, ...string[]])).optional(),
  durationMinSeconds: z.number().int().min(0).optional(),
  durationMaxSeconds: z.number().int().min(0).optional(),
  /** ISO 8601 datetime */
  startedAfter: z.string().datetime().optional(),
  /** ISO 8601 datetime */
  startedBefore: z.string().datetime().optional(),
  /** When non-empty, restrict export to these specific call ids. */
  callIds: z.array(z.string().uuid()).max(5_000).optional(),
});

/**
 * Exports campaign call results matching the given filters to a CSV file in
 * Supabase Storage and returns a 1-hour signed download URL.
 *
 * For ≤ 5,000 matching rows the export runs synchronously and returns
 *   `{ ok: true, url, exportId, rowCount }`.
 * For > 5,000 matching rows the export is deferred to an Inngest function and
 * returns `{ ok: true, deferred: true, exportId }` — the worker emails the
 * requester when the file is ready (wired up in plan 13).
 *
 * Every invocation records an audit log entry under `campaign.export_*`.
 */
export async function exportCampaignResults(
  input: z.infer<typeof exportResultsSchema>,
): Promise<
  ActionResult & {
    url?: string;
    deferred?: boolean;
    exportId?: string;
    rowCount?: number;
  }
> {
  const parsed = exportResultsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'validation_error' };
  }

  try {
    const { orgId, userId } = await getAuthContext();
    await requireCapability('campaigns.view');

    const { campaignId } = parsed.data;
    const exportId = randomUUID();

    const filters: CampaignResultsExportFilters = {};
    if (parsed.data.outcomes && parsed.data.outcomes.length > 0) {
      filters.outcomes = parsed.data.outcomes as CampaignCallOutcome[];
    }
    if (parsed.data.durationMinSeconds !== undefined) {
      filters.durationMinSeconds = parsed.data.durationMinSeconds;
    }
    if (parsed.data.durationMaxSeconds !== undefined) {
      filters.durationMaxSeconds = parsed.data.durationMaxSeconds;
    }
    if (parsed.data.startedAfter) {
      filters.startedAfter = new Date(parsed.data.startedAfter);
    }
    if (parsed.data.startedBefore) {
      filters.startedBefore = new Date(parsed.data.startedBefore);
    }
    if (parsed.data.callIds && parsed.data.callIds.length > 0) {
      filters.callIds = parsed.data.callIds;
    }

    // Probe: fetch up to inline limit + read total. If total > limit we defer.
    const { rows, total } = await collectCampaignResultsForExport(
      orgId,
      campaignId,
      filters,
      EXPORT_INLINE_LIMIT,
    );

    const eventFilters: CampaignExportFilters = {};
    if (filters.outcomes) eventFilters.outcomes = filters.outcomes;
    if (filters.durationMinSeconds !== undefined) {
      eventFilters.durationMinSeconds = filters.durationMinSeconds;
    }
    if (filters.durationMaxSeconds !== undefined) {
      eventFilters.durationMaxSeconds = filters.durationMaxSeconds;
    }
    if (filters.startedAfter) {
      eventFilters.startedAfter = filters.startedAfter.toISOString();
    }
    if (filters.startedBefore) {
      eventFilters.startedBefore = filters.startedBefore.toISOString();
    }
    if (filters.callIds) eventFilters.callIds = filters.callIds;

    if (total > EXPORT_INLINE_LIMIT) {
      const eventData: CampaignExportRequestedData = {
        orgId,
        campaignId,
        exportId,
        requestedByUserId: userId,
        filters: eventFilters,
      };

      await sendInngestEvent({
        name: CAMPAIGN_EXPORT_REQUESTED_EVENT,
        data: eventData,
        id: `campaign-export-${exportId}`,
      });

      await withOrgContext(orgId, async (tx) => {
        await recordAudit(tx, {
          orgId,
          actorUserId: userId,
          actorType: 'user',
          action: 'campaign.export_requested',
          subjectType: 'campaign',
          subjectId: campaignId,
          metadata: { exportId, total, filters: eventFilters, deferred: true },
        });
      });

      return { ok: true, deferred: true, exportId };
    }

    // Inline export: serialise, upload, sign.
    const csv = campaignResultsToCsv(rows);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const path = `${orgId}/exports/campaign-${campaignId}-${timestamp}.csv`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from(CSV_UPLOADS_BUCKET)
      .upload(path, csv, { contentType: 'text/csv', upsert: true });

    if (uploadError) {
      void logger.error('[exportCampaignResults] upload failed', { error: uploadError.message });
      return { ok: false, message: 'export_upload_failed' };
    }

    const { data: signData, error: signError } = await supabaseAdmin.storage
      .from(CSV_UPLOADS_BUCKET)
      .createSignedUrl(path, EXPORT_SIGNED_URL_TTL_SECONDS);

    if (signError ?? !signData?.signedUrl) {
      return { ok: false, message: 'export_sign_failed' };
    }

    await withOrgContext(orgId, async (tx) => {
      await recordAudit(tx, {
        orgId,
        actorUserId: userId,
        actorType: 'user',
        action: 'campaign.export_completed',
        subjectType: 'campaign',
        subjectId: campaignId,
        metadata: { exportId, rowCount: rows.length, storagePath: path, filters: eventFilters },
      });
    });

    return { ok: true, url: signData.signedUrl, exportId, rowCount: rows.length };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'export_failed' };
  }
}

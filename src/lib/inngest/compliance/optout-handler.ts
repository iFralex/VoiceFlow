/**
 * Inngest handler: compliance.opt-out-registered → campaign propagation
 *
 * Triggered by `compliance/opt-out-registered` events emitted by the unified
 * opt-out service (`src/lib/services/optout.ts`). The opt-out service has
 * already updated the registry, flagged matching `contacts` rows, and written
 * the audit entry by the time this fires; this handler's sole responsibility
 * is to propagate the opt-out across active campaigns by aborting any calls to
 * the contact that are still pending or in flight.
 *
 * Steps:
 *  1. Resolve every contact in the org with the opted-out phone number.
 *  2. Select calls for those contact ids whose status is still
 *     `pending`, `dialing`, or `in_progress`.
 *  3. For `dialing` / `in_progress` calls, request cancellation at the voice
 *     provider (best-effort — provider failures must not block DB updates).
 *  4. Flip the call row to `failed / opted_out` and write a `call.skipped`
 *     audit entry. The status filter on the UPDATE makes this idempotent —
 *     a call that has already reached a terminal state is left alone.
 *  5. Emit one `campaign/contact-opted-out` event per affected campaign so the
 *     campaign engine can recompute remaining counts; for each affected
 *     campaign, also re-check whether finalisation now applies.
 *
 * Idempotency: re-delivery of the same opt-out event is safe — step 2 only
 * returns calls still in non-terminal states, step 4's status filter prevents
 * overwriting terminal rows, and the per-campaign finalisation check is itself
 * idempotent on terminal status. Provider `cancelCall` is also idempotent
 * (404 → already gone is treated as success in both adapters).
 */

import { and, eq, inArray } from 'drizzle-orm';

import { recordAudit } from '@/lib/db/audit';
import { withOrgContext } from '@/lib/db/context';
import { calls, contacts } from '@/lib/db/schema';
import { logger } from '@/lib/observability/logger';
import type { ComplianceOptOutRegisteredData } from '@/lib/services/optout';
import { getVoiceProviderByName } from '@/lib/voice/factory';

import { checkAndFinaliseCampaignCompletion } from '../campaigns/completed';
import { sendInngestEvents } from '../client';
import type { InngestEventPayload } from '../client';
import type { CampaignContactOptedOutData } from './events';
import { CAMPAIGN_CONTACT_OPTED_OUT_EVENT } from './events';

interface CandidateCall {
  id: string;
  campaign_id: string | null;
  contact_id: string | null;
  status: 'pending' | 'dialing' | 'in_progress';
  provider: 'vapi' | 'retell' | 'proprietary';
  provider_call_id: string | null;
}

/**
 * Best-effort provider cancellation. Logs and swallows errors so a downstream
 * provider outage cannot prevent us from flipping the row to a terminal state
 * locally. Without the swallow, a stuck `dialing` row could keep blocking the
 * concurrency gate forever after an opt-out.
 */
async function cancelAtProvider(call: CandidateCall): Promise<void> {
  if (!call.provider_call_id) return;
  try {
    const provider = getVoiceProviderByName(call.provider);
    await provider.cancelCall(call.provider_call_id);
  } catch (e) {
    console.warn(
      `[opt-out-propagation] provider cancelCall failed for call ${call.id}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
}

/**
 * Handler for `compliance/opt-out-registered`.
 *
 * Aborts any pending or in-flight calls for the opted-out contact across every
 * active campaign in the org and emits one `campaign/contact-opted-out` event
 * per affected campaign for the campaign engine to recompute remaining.
 */
export async function complianceOptOutRegisteredHandler(
  data: ComplianceOptOutRegisteredData,
): Promise<void> {
  const { orgId, phoneE164, source } = data;

  // 1. Find every contact in the org with this phone number — usually exactly
  //    one (unique on (org_id, phone_e164) where deleted_at IS NULL) but a
  //    soft-deleted twin can also have lingering call rows.
  const contactRows = await withOrgContext(orgId, (tx) =>
    tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.org_id, orgId), eq(contacts.phone_e164, phoneE164))),
  );

  if (contactRows.length === 0) return;

  const contactIds = contactRows.map((r) => r.id);

  // 2. Select all in-flight calls for those contacts. We need provider /
  //    provider_call_id so we can request cancellation before flipping status
  //    locally. The status filter is the canonical idempotency guard.
  const candidateCalls = (await withOrgContext(orgId, (tx) =>
    tx
      .select({
        id: calls.id,
        campaign_id: calls.campaign_id,
        contact_id: calls.contact_id,
        status: calls.status,
        provider: calls.provider,
        provider_call_id: calls.provider_call_id,
      })
      .from(calls)
      .where(
        and(
          eq(calls.org_id, orgId),
          inArray(calls.contact_id, contactIds),
          inArray(calls.status, ['pending', 'dialing', 'in_progress']),
        ),
      ),
  )) as CandidateCall[];

  if (candidateCalls.length === 0) return;

  // 3. Best-effort provider cancellation for active calls. Pending calls have
  //    no provider_call_id yet (the provider has not been told to dial), so
  //    we only call cancelCall for `dialing` / `in_progress` rows.
  await Promise.all(
    candidateCalls
      .filter((c) => c.status === 'dialing' || c.status === 'in_progress')
      .map((c) => cancelAtProvider(c)),
  );

  // 4. Flip each call to `failed / opted_out` and write the audit entry inside
  //    a single org-scoped transaction. The status filter keeps this idempotent
  //    against duplicate event deliveries and against webhook races where the
  //    provider may already have written a terminal status.
  const flippedIds = await withOrgContext(orgId, async (tx) => {
    const updated = await tx
      .update(calls)
      .set({ status: 'failed', error_code: 'opted_out' })
      .where(
        and(
          eq(calls.org_id, orgId),
          inArray(
            calls.id,
            candidateCalls.map((c) => c.id),
          ),
          inArray(calls.status, ['pending', 'dialing', 'in_progress']),
        ),
      )
      .returning({ id: calls.id });

    if (updated.length === 0) return [] as string[];

    for (const row of updated) {
      await recordAudit(tx, {
        orgId,
        actorType: 'system',
        action: 'call.skipped',
        subjectType: 'call',
        subjectId: row.id,
        metadata: { reason: 'opted_out', source, phoneE164 },
      });
    }

    return updated.map((r) => r.id);
  });

  if (flippedIds.length === 0) return;

  // 5. Group flipped calls by campaign and emit one event per campaign so the
  //    campaign engine can recompute remaining and finalise where needed.
  //    Inbound IVR rows have campaign_id=null and therefore produce no event.
  const flippedSet = new Set(flippedIds);
  const callsByCampaign = new Map<
    string,
    { contactId: string; pending: number; active: number }
  >();

  for (const c of candidateCalls) {
    if (!flippedSet.has(c.id) || c.campaign_id === null) continue;
    const isActive = c.status === 'dialing' || c.status === 'in_progress';
    const existing = callsByCampaign.get(c.campaign_id);
    if (!existing) {
      callsByCampaign.set(c.campaign_id, {
        contactId: c.contact_id ?? (contactIds[0] as string),
        pending: isActive ? 0 : 1,
        active: isActive ? 1 : 0,
      });
    } else if (isActive) {
      existing.active += 1;
    } else {
      existing.pending += 1;
    }
  }

  const events: InngestEventPayload[] = [];
  for (const [campaignId, counts] of callsByCampaign) {
    const eventData: CampaignContactOptedOutData = {
      orgId,
      campaignId,
      contactId: counts.contactId,
      phoneE164,
      source,
      cancelledPendingCount: counts.pending,
      cancelledActiveCount: counts.active,
    };
    events.push({
      name: CAMPAIGN_CONTACT_OPTED_OUT_EVENT,
      data: eventData as unknown as Record<string, unknown>,
      // Keyed on (campaign, phone, source) so a re-delivered opt-out for the
      // same source produces the same id and is deduplicated by Inngest. A
      // distinct source still produces a new event because each carries new
      // information for plan 13's notifier.
      id: `contact-opted-out-${campaignId}-${phoneE164}-${source}`,
    });
  }

  if (events.length > 0) {
    await sendInngestEvents(events);
  }

  // 6. Per-campaign finalisation re-check. A campaign whose remaining calls
  //    were all just opted-out can now be moved to `completed`. Best-effort —
  //    a transient finalisation failure must not prevent us from acknowledging
  //    the event, so failures are logged and swallowed.
  await Promise.all(
    Array.from(callsByCampaign.keys()).map((campaignId) =>
      checkAndFinaliseCampaignCompletion(orgId, campaignId).catch((e: unknown) => {
        void logger.error('[opt-out-propagation] finalisation check failed', {
          campaign_id: campaignId,
          error: e instanceof Error ? e.message : String(e),
        });
      }),
    ),
  );
}

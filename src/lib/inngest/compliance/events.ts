/**
 * Inngest event name constants and payload types for the compliance domain.
 *
 * - `compliance/opt-out-registered` — already defined in
 *   `src/lib/services/optout.ts` as the canonical source. This file does NOT
 *   redefine it; it only provides downstream events emitted by the opt-out
 *   propagation handler.
 * - `campaign/contact-opted-out` — emitted after the propagation handler has
 *   aborted any pending or in-progress calls for an opted-out contact, so the
 *   campaign engine can recompute remaining counts and finalise as needed.
 */

import type { OptOutSource } from '@/lib/services/optout';

export const CAMPAIGN_CONTACT_OPTED_OUT_EVENT = 'campaign/contact-opted-out' as const;

export interface CampaignContactOptedOutData {
  orgId: string;
  campaignId: string;
  contactId: string;
  phoneE164: string;
  source: OptOutSource;
  /**
   * Number of pending calls flipped to `failed/opted_out` by the propagation
   * handler for this campaign.
   */
  cancelledPendingCount: number;
  /**
   * Number of `dialing` or `in_progress` calls cancelled at the voice provider
   * for this campaign.
   */
  cancelledActiveCount: number;
}

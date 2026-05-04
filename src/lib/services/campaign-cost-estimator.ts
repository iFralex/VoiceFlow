import { computeCallCost } from './billing-rules';

// ─── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_EXPECTED_AVG_DURATION_SECONDS = 90;
const MAX_CALL_DURATION_SECONDS = 180; // matches CreateCallParams.maxDurationSeconds default

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface EstimateCampaignCostInput {
  /** Number of contacts to call */
  contactCount: number;
  /** Org's current weighted-average rate in cents per minute */
  perMinuteCents: number;
  /**
   * Expected average call duration in seconds.
   * Defaults to 90s (historical baseline). Can be overridden per script template.
   */
  expectedAvgDurationSeconds?: number;
  /**
   * Maximum allowed call duration in seconds.
   * Defaults to 180s (MAX_CALL_DURATION). Used to compute the reservation amount.
   */
  maxCallDurationSeconds?: number;
}

export interface CampaignCostEstimate {
  /** Minimum cost: assumes all calls are too short to bill (< 6s) */
  minCents: number;
  /** Expected cost based on expectedAvgDurationSeconds */
  expectedCents: number;
  /**
   * Maximum cost based on maxCallDurationSeconds.
   * This is the amount reserved at campaign launch (spec §11.1).
   */
  maxCents: number;
}

// ─── estimateCampaignCost ──────────────────────────────────────────────────────

/**
 * Estimates the credit cost for a campaign.
 *
 * - `minCents` is always 0 — if every call is unanswered / hangs up in < 6s,
 *   nothing is billed.
 * - `expectedCents` uses `expectedAvgDurationSeconds` (default 90s) to forecast
 *   the typical spend.
 * - `maxCents` uses `maxCallDurationSeconds` (default 180s) and is the figure
 *   reserved at launch to guarantee no credit shortage mid-run (spec §11.1).
 */
export function estimateCampaignCost(input: EstimateCampaignCostInput): CampaignCostEstimate {
  const {
    contactCount,
    perMinuteCents,
    expectedAvgDurationSeconds = DEFAULT_EXPECTED_AVG_DURATION_SECONDS,
    maxCallDurationSeconds = MAX_CALL_DURATION_SECONDS,
  } = input;

  const expectedPerCall = computeCallCost({
    durationSeconds: expectedAvgDurationSeconds,
    perMinuteCents,
  });

  const maxPerCall = computeCallCost({
    durationSeconds: maxCallDurationSeconds,
    perMinuteCents,
  });

  return {
    minCents: 0,
    expectedCents: expectedPerCall.costCents * contactCount,
    maxCents: maxPerCall.costCents * contactCount,
  };
}

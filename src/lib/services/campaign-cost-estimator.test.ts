import { describe, expect, it } from 'vitest';

import { estimateCampaignCost } from './campaign-cost-estimator';

const PER_MINUTE_CENTS = 427; // ~4.27 c/min (Starter package rate)

describe('estimateCampaignCost', () => {
  it('always returns minCents = 0 (all calls could be unanswered)', () => {
    const result = estimateCampaignCost({
      contactCount: 100,
      perMinuteCents: PER_MINUTE_CENTS,
    });
    expect(result.minCents).toBe(0);
  });

  it('computes expectedCents using default 90s avg duration', () => {
    // computeCallCost(90s, 427) → billable = ceil(90/6)*6 = 90s, cost = ceil(90/60*427) = ceil(640.5) = 641
    // 10 contacts → 6410
    const result = estimateCampaignCost({
      contactCount: 10,
      perMinuteCents: PER_MINUTE_CENTS,
    });
    expect(result.expectedCents).toBe(641 * 10);
  });

  it('computes maxCents using default 180s max duration', () => {
    // computeCallCost(180s, 427) → billable = 180s, cost = ceil(180/60*427) = ceil(1281) = 1281
    // 10 contacts → 12810
    const result = estimateCampaignCost({
      contactCount: 10,
      perMinuteCents: PER_MINUTE_CENTS,
    });
    expect(result.maxCents).toBe(1281 * 10);
  });

  it('expectedCents < maxCents for any nonzero contact count', () => {
    const result = estimateCampaignCost({
      contactCount: 50,
      perMinuteCents: PER_MINUTE_CENTS,
    });
    expect(result.expectedCents).toBeLessThan(result.maxCents);
  });

  it('respects a custom expectedAvgDurationSeconds', () => {
    // computeCallCost(60s, 600) → billable=60s, cost=ceil(60/60*600)=600
    // 5 contacts → 3000
    const result = estimateCampaignCost({
      contactCount: 5,
      perMinuteCents: 600,
      expectedAvgDurationSeconds: 60,
    });
    expect(result.expectedCents).toBe(600 * 5);
  });

  it('respects a custom maxCallDurationSeconds', () => {
    // computeCallCost(120s, 600) → billable=120s, cost=ceil(120/60*600)=1200
    // 5 contacts → 6000
    const result = estimateCampaignCost({
      contactCount: 5,
      perMinuteCents: 600,
      maxCallDurationSeconds: 120,
    });
    expect(result.maxCents).toBe(1200 * 5);
  });

  it('scales linearly with contactCount', () => {
    const base = estimateCampaignCost({ contactCount: 1, perMinuteCents: PER_MINUTE_CENTS });
    const scaled = estimateCampaignCost({ contactCount: 100, perMinuteCents: PER_MINUTE_CENTS });
    expect(scaled.expectedCents).toBe(base.expectedCents * 100);
    expect(scaled.maxCents).toBe(base.maxCents * 100);
  });

  it('returns zero expected and max for zero contacts', () => {
    const result = estimateCampaignCost({
      contactCount: 0,
      perMinuteCents: PER_MINUTE_CENTS,
    });
    expect(result.minCents).toBe(0);
    expect(result.expectedCents).toBe(0);
    expect(result.maxCents).toBe(0);
  });

  it('handles expectedAvgDuration below minimum billable threshold (< 6s)', () => {
    // computeCallCost(3s, ...) → billableSeconds=0, costCents=0 → expectedCents=0
    const result = estimateCampaignCost({
      contactCount: 10,
      perMinuteCents: PER_MINUTE_CENTS,
      expectedAvgDurationSeconds: 3,
    });
    expect(result.expectedCents).toBe(0);
    // maxCents should still use default 180s
    expect(result.maxCents).toBe(1281 * 10);
  });
});

/**
 * Unit tests for the CLI watchdog. The DB context is mocked so these tests
 * focus on the pure scoring math and the transition decision tree without
 * standing up Postgres. Integration tests covering the full SQL behaviour
 * and the cooldown-history accounting live in `cli_watchdog.integration.test.ts`.
 */

import { describe, expect, it, vi } from 'vitest';

// `cli_watchdog.ts` transitively imports `@/lib/inngest` (which pulls in
// storage/signed.ts → supabase/admin.ts). Stub those modules so the pure-math
// tests below don't need real Supabase env vars.
vi.mock('@/lib/db/context', () => ({
  withSystemContext: vi.fn(),
}));
vi.mock('@/lib/db/schema', () => ({
  calls: {},
  cliCooldownHistory: {},
  optOutRegistry: {},
  phoneNumbers: {},
}));
vi.mock('@/lib/inngest', () => ({
  CLI_COOLING_DOWN_EVENT: 'cli/cooling-down',
  CLI_RETIRED_EVENT: 'cli/retired',
  sendInngestEvents: vi.fn(),
}));

import {
  computeSpamScore,
  DEFAULT_SPAM_SCORE_THRESHOLD,
  MIN_CALLS_FOR_SCORING,
} from './cli_watchdog';

describe('computeSpamScore', () => {
  it('returns 0 when no calls were dialed', () => {
    const result = computeSpamScore({ dialed: 0, pickups: 0, voicemails: 0, complaints: 0 });
    expect(result.score).toBe(0);
    expect(result.pickupRate).toBe(0);
  });

  it('returns 0 when sample size is below the minimum threshold', () => {
    // 9 dialed, all voicemail — would normally score high, but small sample
    // is statistically unreliable so we keep the CLI active.
    const result = computeSpamScore({
      dialed: MIN_CALLS_FOR_SCORING - 1,
      pickups: 0,
      voicemails: MIN_CALLS_FOR_SCORING - 1,
      complaints: 0,
    });
    expect(result.score).toBe(0);
    expect(result.voicemailRate).toBeCloseTo(1, 5);
  });

  it('produces a healthy score for a high-pickup CLI', () => {
    // 100 dialed, 80 pickups, 5 voicemails, 0 complaints
    const { score } = computeSpamScore({
      dialed: 100,
      pickups: 80,
      voicemails: 5,
      complaints: 0,
    });
    // 40 * (1 - 0.8) + 25 * 0.05 + 35 * 0 = 8 + 1.25 = 9.25 → 9
    expect(score).toBe(9);
    expect(score).toBeLessThan(DEFAULT_SPAM_SCORE_THRESHOLD);
  });

  it('produces a high score for a low-pickup CLI', () => {
    // 100 dialed, 5 pickups, 60 voicemails, 5 complaints
    const { score, pickupRate, voicemailRate, complaintRate } = computeSpamScore({
      dialed: 100,
      pickups: 5,
      voicemails: 60,
      complaints: 5,
    });
    // 40 * 0.95 + 25 * 0.6 + 35 * 0.05 = 38 + 15 + 1.75 = 54.75 → 55
    expect(score).toBe(55);
    expect(pickupRate).toBeCloseTo(0.05, 5);
    expect(voicemailRate).toBeCloseTo(0.6, 5);
    expect(complaintRate).toBeCloseTo(0.05, 5);
  });

  it('crosses the default threshold when complaint rate spikes', () => {
    // 100 dialed, 30 pickups, 20 voicemails, 30 complaints
    const { score } = computeSpamScore({
      dialed: 100,
      pickups: 30,
      voicemails: 20,
      complaints: 30,
    });
    // 40 * 0.7 + 25 * 0.2 + 35 * 0.3 = 28 + 5 + 10.5 = 43.5 → 44
    expect(score).toBe(44);
  });

  it('saturates at 100 in the worst case', () => {
    const { score } = computeSpamScore({
      dialed: 100,
      pickups: 0,
      voicemails: 100,
      complaints: 100,
    });
    // 40 + 25 + 35 = 100
    expect(score).toBe(100);
  });

  it('clamps individual rates so dirty inputs cannot blow past 100', () => {
    // pickups > dialed should not produce a negative score.
    const { score, pickupRate } = computeSpamScore({
      dialed: 10,
      pickups: 50,
      voicemails: 50,
      complaints: 50,
    });
    expect(pickupRate).toBe(1);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('rounds to the nearest integer', () => {
    const { score } = computeSpamScore({
      dialed: 100,
      pickups: 33,
      voicemails: 33,
      complaints: 33,
    });
    // 40 * 0.67 + 25 * 0.33 + 35 * 0.33 = 26.8 + 8.25 + 11.55 = 46.6 → 47
    expect(score).toBe(47);
  });

  it('threshold separates 70-or-below (pass) from 71-or-above (cooldown)', () => {
    // Pickup rate 0.25, voicemail 0.4, complaint 0.4
    // 40 * 0.75 + 25 * 0.4 + 35 * 0.4 = 30 + 10 + 14 = 54
    const at54 = computeSpamScore({
      dialed: 100,
      pickups: 25,
      voicemails: 40,
      complaints: 40,
    });
    expect(at54.score).toBeLessThanOrEqual(DEFAULT_SPAM_SCORE_THRESHOLD);

    // Pickup rate 0, voicemail 0.5, complaint 0.5
    // 40 + 12.5 + 17.5 = 70
    const at70 = computeSpamScore({
      dialed: 100,
      pickups: 0,
      voicemails: 50,
      complaints: 50,
    });
    expect(at70.score).toBe(70);

    // 1 less pickup pushes score above the threshold.
    const above = computeSpamScore({
      dialed: 100,
      pickups: 0,
      voicemails: 60,
      complaints: 50,
    });
    expect(above.score).toBeGreaterThan(DEFAULT_SPAM_SCORE_THRESHOLD);
  });
});

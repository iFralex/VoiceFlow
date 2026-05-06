import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyDispatchJitter, DEFAULT_JITTER_MAX_MS, pickJitterMs } from './jitter';

describe('pickJitterMs', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 0 when maxMs is 0 or negative', () => {
    expect(pickJitterMs(0)).toBe(0);
    expect(pickJitterMs(-1)).toBe(0);
  });

  it('returns a value within [0, maxMs] for the default cap', () => {
    for (let i = 0; i < 50; i++) {
      const ms = pickJitterMs();
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThanOrEqual(DEFAULT_JITTER_MAX_MS);
    }
  });

  it('respects an explicit maxMs argument', () => {
    for (let i = 0; i < 50; i++) {
      const ms = pickJitterMs(50);
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThanOrEqual(50);
    }
  });

  it('hits 0 when Math.random returns 0', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(pickJitterMs(500)).toBe(0);
  });

  it('hits maxMs when Math.random returns just under 1', () => {
    // Math.random yields [0, 1); the ceiling element of the resulting
    // distribution is `floor(0.99999... * 501) = 500`.
    vi.spyOn(Math, 'random').mockReturnValue(0.9999999);
    expect(pickJitterMs(500)).toBe(500);
  });
});

describe('applyDispatchJitter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('resolves immediately and returns 0 when the picked delay is 0', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const result = await applyDispatchJitter();
    expect(result).toBe(0);
  });

  it('waits for the picked number of milliseconds before resolving', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const promise = applyDispatchJitter(100);

    let resolved = false;
    void promise.then(() => {
      resolved = true;
    });

    // Advance just under the delay — should not resolve yet.
    await vi.advanceTimersByTimeAsync(40);
    expect(resolved).toBe(false);

    // Advance past the delay — should resolve.
    await vi.advanceTimersByTimeAsync(20);
    await promise;
    expect(resolved).toBe(true);
  });
});

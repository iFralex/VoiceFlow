import { describe, it, expect, vi, beforeEach } from 'vitest';

// Track mock instances
const mockIsFeatureEnabled = vi.fn();
const mockShutdown = vi.fn().mockResolvedValue(undefined);

class MockPostHog {
  isFeatureEnabled = mockIsFeatureEnabled;
  shutdown = mockShutdown;
}

vi.mock('posthog-node', () => ({ PostHog: MockPostHog }));

vi.mock('@/lib/env', () => ({
  env: {
    NEXT_PUBLIC_POSTHOG_KEY: 'phc_test',
    NEXT_PUBLIC_POSTHOG_HOST: 'https://eu.i.posthog.com',
    NODE_ENV: 'test',
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isFlagEnabled', () => {
  it('returns true when PostHog returns true', async () => {
    const { isFlagEnabled } = await import('./server');
    mockIsFeatureEnabled.mockResolvedValue(true);
    expect(await isFlagEnabled('org-1', 'dashboard.cmd-k-search')).toBe(true);
  });

  it('returns false when PostHog returns false', async () => {
    const { isFlagEnabled } = await import('./server');
    mockIsFeatureEnabled.mockResolvedValue(false);
    expect(await isFlagEnabled('org-1', 'dashboard.cmd-k-search')).toBe(false);
  });

  it('returns defaultValue when PostHog throws', async () => {
    const { isFlagEnabled } = await import('./server');
    mockIsFeatureEnabled.mockRejectedValue(new Error('network'));
    expect(await isFlagEnabled('org-1', 'dashboard.cmd-k-search', true)).toBe(true);
  });

  it('returns false (defaultValue) when PostHog returns undefined', async () => {
    const { isFlagEnabled } = await import('./server');
    mockIsFeatureEnabled.mockResolvedValue(undefined);
    expect(await isFlagEnabled('org-1', 'voice.proprietary-stack')).toBe(false);
  });

  it('passes flagKey and orgId to PostHog', async () => {
    const { isFlagEnabled } = await import('./server');
    mockIsFeatureEnabled.mockResolvedValue(true);
    await isFlagEnabled('org-abc', 'email.weekly-summary');
    expect(mockIsFeatureEnabled).toHaveBeenCalledWith('email.weekly-summary', 'org-abc');
  });
});

'use client';

import { useEffect, useState } from 'react';
import posthog from 'posthog-js';
import type { FlagKey } from './flags';

/**
 * Client-side hook to evaluate a feature flag.
 *
 * Returns `defaultValue` on the first render (before PostHog loads) and
 * updates asynchronously once the client has fetched flag overrides.
 *
 * PostHog must be initialised via <PostHogProvider> in the root layout before
 * this hook is called.  When running in environments without
 * NEXT_PUBLIC_POSTHOG_KEY the hook always returns `defaultValue`.
 */
export function useFlag(flagKey: FlagKey, defaultValue = false): boolean {
  const [enabled, setEnabled] = useState<boolean>(() => {
    try {
      return posthog.isFeatureEnabled(flagKey) ?? defaultValue;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    // Re-evaluate once flags are loaded from the PostHog network
    const unsubscribe = posthog.onFeatureFlags(() => {
      setEnabled(posthog.isFeatureEnabled(flagKey) ?? defaultValue);
    });
    return unsubscribe;
  }, [flagKey, defaultValue]);

  return enabled;
}

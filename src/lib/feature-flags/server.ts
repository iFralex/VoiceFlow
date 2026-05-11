import { PostHog } from 'posthog-node';
import { env } from '@/lib/env';
import type { FlagKey } from './flags';

// Singleton PostHog server client. Null when POSTHOG_KEY is not configured.
let _client: PostHog | null = null;

function getClient(): PostHog | null {
  if (!env.NEXT_PUBLIC_POSTHOG_KEY) return null;
  if (!_client) {
    _client = new PostHog(env.NEXT_PUBLIC_POSTHOG_KEY, {
      host: env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com',
      // Disable automatic event capture on the server side — we only need flags
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return _client;
}

/**
 * Evaluate a feature flag server-side for a given organisation.
 *
 * Falls back to `defaultValue` when PostHog is not configured or the network
 * call fails, so callers never need to handle errors.
 */
export async function isFlagEnabled(
  orgId: string,
  flagKey: FlagKey,
  defaultValue = false,
): Promise<boolean> {
  const client = getClient();
  if (!client) return defaultValue;
  try {
    const enabled = await client.isFeatureEnabled(flagKey, orgId);
    return enabled ?? defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * Flush pending PostHog events before the process exits (e.g. in cron routes).
 * Call this at the end of long-lived server functions; it is a no-op when
 * PostHog is not configured.
 */
export async function shutdownPostHog(): Promise<void> {
  await _client?.shutdown();
  _client = null;
}

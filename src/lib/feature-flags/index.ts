export { FLAGS } from './flags';
export type { FlagKey } from './flags';
export { isFlagEnabled, shutdownPostHog } from './server';
// useFlag is intentionally not re-exported here because it is a client module
// ('use client') — import it directly from '@/lib/feature-flags/client'.

/**
 * Anti-spam dispatch jitter (plan 10 task 6).
 *
 * Inserts a small uniform random delay (0–`maxMs` milliseconds, default 500)
 * before the dispatcher hands a call to the voice provider. The point is to
 * spread out outbound bursts so the SBC carrier (and downstream Italian
 * networks) does not see a tight, machine-paced cadence that pattern matches
 * to spam.
 *
 * Kept in `src/lib/voice/cli/` because it pairs with `pickCliForOrg` as part
 * of the same anti-spam toolkit; consumed from `src/lib/services/calls.ts`'s
 * `dispatchCall` immediately before `provider.createCall`.
 */
export const DEFAULT_JITTER_MAX_MS = 500;

export function pickJitterMs(maxMs: number = DEFAULT_JITTER_MAX_MS): number {
  if (maxMs <= 0) return 0;
  return Math.floor(Math.random() * (maxMs + 1));
}

export async function applyDispatchJitter(
  maxMs: number = DEFAULT_JITTER_MAX_MS,
): Promise<number> {
  const ms = pickJitterMs(maxMs);
  if (ms === 0) return 0;
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
  return ms;
}

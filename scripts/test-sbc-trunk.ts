/**
 * scripts/test-sbc-trunk.ts — manual SBC trunk smoke test (plan 10 task 15).
 *
 * Picks a non-org-dedicated SBC CLI from `phone_numbers`, dispatches a real
 * call via Vapi to `SBC_SMOKE_TEST_NUMBER`, polls Vapi until the call ends,
 * and asserts the call lasted > 2s and ended with `hangup` or
 * `silence-timeout`.
 *
 * Used by the founder as part of the SBC trunk validation checklist documented
 * in `docs/runbooks/cli-pool-management.md`. The same logic runs weekly via
 * the `/api/cron/sbc-smoke-test` Vercel cron — both call into
 * `runSbcSmokeTest()` so behaviour stays consistent.
 *
 * Exit codes:
 *   0 — call connected, lasted > 2s, ended with allowed reason
 *   1 — any failure (no candidate CLI, createCall threw, timeout, assertion)
 *
 * Usage:
 *   pnpm exec tsx scripts/test-sbc-trunk.ts
 */

import { runSbcSmokeTest } from '@/lib/services/sbc_smoke_test';

async function main(): Promise<void> {
  const result = await runSbcSmokeTest();
  if (result.ok) {
    console.warn(
      `[sbc-smoke-test] OK: ${result.e164} → ${result.providerCallId}` +
        ` ended=${result.endedReason} duration=${result.durationSeconds?.toFixed(1)}s`,
    );
    process.exit(0);
  }
  console.error(
    `[sbc-smoke-test] FAIL (${result.reason}): ${result.detail}` +
      (result.providerCallId ? ` providerCallId=${result.providerCallId}` : '') +
      (result.e164 ? ` cli=${result.e164}` : ''),
  );
  process.exit(1);
}

main().catch((err) => {
  console.error('[sbc-smoke-test] unexpected error:', err);
  process.exit(1);
});

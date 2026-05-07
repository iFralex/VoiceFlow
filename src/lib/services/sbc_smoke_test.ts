/**
 * SBC trunk smoke test (plan 10 task 15).
 *
 * Picks a non-org-dedicated SBC CLI from the shared pool, dispatches a real
 * call via Vapi to `SBC_SMOKE_TEST_NUMBER`, and waits for the call to end.
 * Asserts the call lasted at least 2 seconds and ended with one of the two
 * benign reasons (`hangup` — far end picked up and hung up — or
 * `silence-timeout` — far end answered but stayed silent). Anything else
 * indicates the SBC trunk is degraded before the dispatcher's
 * consecutive-failure counter catches up, so an alert event fires
 * (`sbc/smoke-test-failed`) for plan 13's notification handler.
 *
 * Design notes:
 *   - The test does NOT insert a `calls` row. Picking a real CLI but skipping
 *     the campaign/contact/audit machinery keeps the smoke test cheap and
 *     means the founder dashboard doesn't show fake calls. The trade-off is
 *     that the inbound webhook path is unexercised — that's covered by the
 *     `inbound_calls.integration.test.ts` instead.
 *   - The picker tiebreakers (region match, idle preference, etc.) are
 *     irrelevant for a smoke test; we just take the lowest `daily_call_count`
 *     SBC CLI that's currently active. The smoke test counts toward the daily
 *     cap (one call/week is negligible).
 *   - We poll Vapi's `GET /call/:id` directly rather than wait for the webhook
 *     because the webhook path requires a `calls` row keyed on `provider_call_id`
 *     and we deliberately don't create one.
 */

import { and, asc, eq, isNull } from 'drizzle-orm';

import { type DbTx, withSystemContext } from '@/lib/db/context';
import { phoneNumbers } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { sendInngestEvent } from '@/lib/inngest/client';
import {
  SBC_SMOKE_TEST_FAILED_EVENT,
  type SbcSmokeTestFailedData,
} from '@/lib/inngest/handlers/cli';
import { VoiceProviderError } from '@/lib/voice/errors';
import { VapiAdapter } from '@/lib/voice/vapi/adapter';

// ── Constants ──────────────────────────────────────────────────────────────

/** Vapi REST base URL (mirrors the constant baked into VapiAdapter). */
const VAPI_BASE_URL = 'https://api.vapi.ai';

/** Maximum time we'll wait for the test call to end before declaring timeout. */
export const DEFAULT_TIMEOUT_MS = 90_000;

/** Interval between Vapi `GET /call/:id` polls while waiting for end. */
export const DEFAULT_POLL_INTERVAL_MS = 5_000;

/** Minimum call duration (seconds) required to consider the trunk healthy. */
export const DURATION_THRESHOLD_SECONDS = 2;

/**
 * Vapi `endedReason` values the smoke test treats as healthy SBC behaviour.
 * Any other reason (`pipeline-error`, `assistant-error`, `phone-call-provider-…`)
 * is treated as a smoke-test failure even if the call did connect.
 */
export const ALLOWED_ENDED_REASONS = ['hangup', 'silence-timeout'] as const;

/** Phone providers tracked as the SBC trunk (matches `dispatchCall`). */
const SBC_PROVIDERS = ['voiped', 'telnyx'] as const;

/** Smoke-test assistant prompt — used when the founder hasn't preconfigured one. */
const SMOKE_TEST_SYSTEM_PROMPT =
  'Sei un test automatico. Saluta brevemente in italiano e attendi che la persona dica "pronto", poi termina la chiamata educatamente.';
const SMOKE_TEST_FIRST_MESSAGE =
  'Buongiorno, questa è una verifica automatica della linea. Se mi sente, dica "pronto".';
const SMOKE_TEST_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';
const SMOKE_TEST_MAX_DURATION_SECONDS = 30;

// ── Types ──────────────────────────────────────────────────────────────────

export interface RunSbcSmokeTestOptions {
  /** Override `env.SBC_SMOKE_TEST_NUMBER` (used by tests). */
  testNumber?: string;
  /** Override `env.NEXT_PUBLIC_APP_URL` for the webhook URL (used by tests). */
  webhookBaseUrl?: string;
  /** Vapi API key override. Defaults to `env.VAPI_API_KEY`. */
  vapiApiKey?: string;
  /** Inject a Vapi adapter instance (used by tests). */
  adapter?: VapiAdapter;
  /** Inject a fetch implementation for the polling step. Defaults to global. */
  fetchImpl?: typeof fetch;
  /** Override the polling interval (used by tests to short-circuit timing). */
  pollIntervalMs?: number;
  /** Override the wait-for-end timeout. */
  timeoutMs?: number;
  /**
   * Inject a clock for deterministic timeout calculations. Defaults to
   * `Date.now`. Tests pass an incrementing fake to avoid actual wall-clock
   * waits inside the polling loop.
   */
  now?: () => number;
  /** Pluggable sleep — tests pass a no-op resolver. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Run the candidate selection inside an existing transaction (used by
   * integration tests to share a rolled-back tx with seed data).
   */
  tx?: DbTx;
  /**
   * Override the `sbc/smoke-test-failed` Inngest publish. Defaults to
   * `sendInngestEvent`. Tests inject a spy so they can assert without going
   * to Inngest.
   */
  emit?: (data: SbcSmokeTestFailedData) => Promise<void>;
}

export interface SbcSmokeTestResult {
  /** `true` iff the call connected, lasted ≥ 2s, and ended with an allowed reason. */
  ok: boolean;
  /** Failure classifier (absent on success). */
  reason?: SbcSmokeTestFailedData['reason'];
  /** Free-text detail for the alert / log. */
  detail?: string;
  /** The CLI the smoke test attempted to use, when one was selected. */
  phoneNumberId?: string;
  e164?: string;
  /** Vapi call id, when createCall succeeded. */
  providerCallId?: string;
  /** Observed duration in seconds, when the call did end. */
  durationSeconds?: number;
  /** Observed Vapi `endedReason`, when the call did end. */
  endedReason?: string;
}

// ── Implementation ─────────────────────────────────────────────────────────

interface VapiPollShape {
  id?: string;
  status?: string;
  endedReason?: string;
  startedAt?: string;
  endedAt?: string;
}

async function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function emitFailure(
  data: SbcSmokeTestFailedData,
  emitter: ((data: SbcSmokeTestFailedData) => Promise<void>) | undefined,
): Promise<void> {
  try {
    if (emitter) {
      await emitter(data);
      return;
    }
    await sendInngestEvent({
      name: SBC_SMOKE_TEST_FAILED_EVENT,
      data: data as unknown as Record<string, unknown>,
    });
  } catch (err) {
    // Best-effort: the cron route also logs the result, so an Inngest outage
    // never masks the original failure.
    console.error('[sbc-smoke-test] Failed to emit alert event', err);
  }
}

async function pickSbcCandidate(
  tx: DbTx,
): Promise<{ id: string; e164: string; providerExternalId: string | null } | null> {
  const rows = await tx
    .select({
      id: phoneNumbers.id,
      e164: phoneNumbers.e164,
      provider_external_id: phoneNumbers.provider_external_id,
      provider: phoneNumbers.provider,
    })
    .from(phoneNumbers)
    .where(
      and(
        eq(phoneNumbers.status, 'active'),
        isNull(phoneNumbers.org_id),
      ),
    )
    .orderBy(asc(phoneNumbers.daily_call_count), asc(phoneNumbers.last_used_at));

  // Filter to SBC providers in JS rather than via inArray to keep the Drizzle
  // query simple and avoid an extra import; the pool size is at most 15 so
  // this is trivially cheap.
  const sbc = rows.find((r) =>
    (SBC_PROVIDERS as readonly string[]).includes(r.provider),
  );
  if (!sbc) return null;
  return {
    id: sbc.id,
    e164: sbc.e164,
    providerExternalId: sbc.provider_external_id,
  };
}

/**
 * Polls Vapi's `GET /call/:id` until the call has ended or the timeout is
 * reached. Returns the parsed response on success or `null` on timeout.
 */
async function waitForCallEnd(
  providerCallId: string,
  apiKey: string,
  fetchImpl: typeof fetch,
  pollIntervalMs: number,
  timeoutMs: number,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
): Promise<{ ended: VapiPollShape | null; lastStatus: string | undefined }> {
  const deadline = now() + timeoutMs;
  let lastStatus: string | undefined;
  while (now() < deadline) {
    let res: Response;
    try {
      res = await fetchImpl(
        `${VAPI_BASE_URL}/call/${encodeURIComponent(providerCallId)}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}` },
        },
      );
    } catch (err) {
      // Network failure (DNS, connection refused, TLS, abort): treat the same
      // as a 5xx blip so a transient outage doesn't break the cron's contract
      // of always resolving. The timeout still bounds total wait.
      lastStatus = `fetch_error:${err instanceof Error ? err.message : 'unknown'}`;
      await sleep(pollIntervalMs);
      continue;
    }
    if (!res.ok) {
      // Treat transient fetch errors as "not yet ended" so a single 5xx blip
      // doesn't fail the smoke test. The timeout still bounds total wait.
      lastStatus = `http_${res.status}`;
      await sleep(pollIntervalMs);
      continue;
    }
    let json: VapiPollShape;
    try {
      json = (await res.json()) as VapiPollShape;
    } catch (err) {
      // Malformed JSON from a 200 response — treat as a transient blip too.
      lastStatus = `json_error:${err instanceof Error ? err.message : 'unknown'}`;
      await sleep(pollIntervalMs);
      continue;
    }
    lastStatus = json.status;
    if (json.status === 'ended') {
      return { ended: json, lastStatus };
    }
    await sleep(pollIntervalMs);
  }
  return { ended: null, lastStatus };
}

function computeDurationSeconds(json: VapiPollShape): number | undefined {
  if (!json.startedAt || !json.endedAt) return undefined;
  const start = Date.parse(json.startedAt);
  const end = Date.parse(json.endedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return undefined;
  return Math.max(0, (end - start) / 1000);
}

/**
 * Runs the SBC smoke test once. Always resolves with a `SbcSmokeTestResult`
 * — failures are reported via `ok: false` and an emitted Inngest event,
 * never thrown. The cron route inspects `result.ok` to decide its HTTP
 * status code.
 */
export async function runSbcSmokeTest(
  options: RunSbcSmokeTestOptions = {},
): Promise<SbcSmokeTestResult> {
  const testNumber = options.testNumber ?? env.SBC_SMOKE_TEST_NUMBER;
  if (!testNumber) {
    const result: SbcSmokeTestResult = {
      ok: false,
      reason: 'no_test_number_configured',
      detail:
        'SBC_SMOKE_TEST_NUMBER is not configured — smoke test cannot run',
    };
    await emitFailure(toFailureData(result), options.emit);
    return result;
  }

  // 1. Pick a CLI.
  const work = (tx: DbTx) => pickSbcCandidate(tx);
  const candidate = options.tx
    ? await work(options.tx)
    : await withSystemContext(work);
  if (!candidate) {
    const result: SbcSmokeTestResult = {
      ok: false,
      reason: 'no_candidate_cli',
      detail: 'No active non-dedicated SBC CLI found in phone_numbers pool',
    };
    await emitFailure(toFailureData(result), options.emit);
    return result;
  }

  // 2. Resolve the Vapi adapter and API key (the adapter holds it privately,
  //    so we read env directly for the polling step).
  const apiKey = options.vapiApiKey ?? env.VAPI_API_KEY;
  if (!apiKey) {
    const result: SbcSmokeTestResult = {
      ok: false,
      reason: 'create_call_failed',
      detail: 'VAPI_API_KEY is not configured',
      phoneNumberId: candidate.id,
      e164: candidate.e164,
    };
    await emitFailure(toFailureData(result), options.emit);
    return result;
  }
  const adapter = options.adapter ?? new VapiAdapter(apiKey);
  if (!candidate.providerExternalId) {
    const result: SbcSmokeTestResult = {
      ok: false,
      reason: 'create_call_failed',
      detail: 'Selected CLI has no provider_external_id (Vapi phoneNumberId)',
      phoneNumberId: candidate.id,
      e164: candidate.e164,
    };
    await emitFailure(toFailureData(result), options.emit);
    return result;
  }

  // 3. Dispatch via Vapi.
  const webhookBase = options.webhookBaseUrl ?? env.NEXT_PUBLIC_APP_URL;
  let providerCallId: string;
  try {
    ({ providerCallId } = await adapter.createCall({
      toNumber: testNumber,
      fromNumber: candidate.providerExternalId,
      systemPrompt: SMOKE_TEST_SYSTEM_PROMPT,
      firstMessage: SMOKE_TEST_FIRST_MESSAGE,
      voiceId: SMOKE_TEST_VOICE_ID,
      language: 'it-IT',
      maxDurationSeconds: SMOKE_TEST_MAX_DURATION_SECONDS,
      webhookUrl: `${webhookBase}/api/webhooks/vapi`,
      metadata: {
        // The webhook handler keys off provider_call_id and a calls row;
        // we deliberately don't insert one, so these are best-effort tags
        // for Vapi's dashboard only.
        orgId: 'sbc-smoke-test',
        campaignId: 'sbc-smoke-test',
        callId: 'sbc-smoke-test',
        contactId: 'sbc-smoke-test',
      },
      endCallFunctions: [],
      amdEnabled: false,
      recordingEnabled: false,
    }));
  } catch (err) {
    const detail =
      err instanceof VoiceProviderError
        ? `${err.code}: ${err.message}`
        : err instanceof Error
          ? err.message
          : 'createCall threw';
    const result: SbcSmokeTestResult = {
      ok: false,
      reason: 'create_call_failed',
      detail,
      phoneNumberId: candidate.id,
      e164: candidate.e164,
    };
    await emitFailure(toFailureData(result), options.emit);
    return result;
  }

  // 4. Poll Vapi until the call ends or we time out.
  const fetchImpl = options.fetchImpl ?? fetch;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const nowFn = options.now ?? Date.now;
  const sleepFn = options.sleep ?? defaultSleep;

  const { ended, lastStatus } = await waitForCallEnd(
    providerCallId,
    apiKey,
    fetchImpl,
    pollIntervalMs,
    timeoutMs,
    nowFn,
    sleepFn,
  );

  if (!ended) {
    const result: SbcSmokeTestResult = {
      ok: false,
      reason: 'timeout_waiting_for_end',
      detail: `Call did not end within ${Math.round(timeoutMs / 1000)}s (last status: ${lastStatus ?? 'unknown'})`,
      phoneNumberId: candidate.id,
      e164: candidate.e164,
      providerCallId,
    };
    await emitFailure(toFailureData(result), options.emit);
    return result;
  }

  const durationSeconds = computeDurationSeconds(ended);
  const endedReason = ended.endedReason;

  // 5. Assertions.
  if (durationSeconds === undefined || durationSeconds <= DURATION_THRESHOLD_SECONDS) {
    const result: SbcSmokeTestResult = {
      ok: false,
      reason: 'duration_too_short',
      detail: `Duration was ${durationSeconds ?? 'unknown'}s — expected > ${DURATION_THRESHOLD_SECONDS}s`,
      phoneNumberId: candidate.id,
      e164: candidate.e164,
      providerCallId,
      ...(durationSeconds !== undefined && { durationSeconds }),
      ...(endedReason !== undefined && { endedReason }),
    };
    await emitFailure(toFailureData(result), options.emit);
    return result;
  }
  if (
    endedReason === undefined ||
    !(ALLOWED_ENDED_REASONS as readonly string[]).includes(endedReason)
  ) {
    const result: SbcSmokeTestResult = {
      ok: false,
      reason: 'unexpected_ended_reason',
      detail: `endedReason="${endedReason ?? 'unknown'}" not in [${ALLOWED_ENDED_REASONS.join(', ')}]`,
      phoneNumberId: candidate.id,
      e164: candidate.e164,
      providerCallId,
      durationSeconds,
      ...(endedReason !== undefined && { endedReason }),
    };
    await emitFailure(toFailureData(result), options.emit);
    return result;
  }

  return {
    ok: true,
    phoneNumberId: candidate.id,
    e164: candidate.e164,
    providerCallId,
    durationSeconds,
    endedReason,
  };
}

function toFailureData(result: SbcSmokeTestResult): SbcSmokeTestFailedData {
  return {
    reason: result.reason ?? 'create_call_failed',
    detail: result.detail ?? 'unknown',
    ...(result.phoneNumberId && { phoneNumberId: result.phoneNumberId }),
    ...(result.e164 && { e164: result.e164 }),
    ...(result.providerCallId && { providerCallId: result.providerCallId }),
    ...(result.durationSeconds !== undefined && {
      durationSeconds: result.durationSeconds,
    }),
    ...(result.endedReason && { endedReason: result.endedReason }),
  };
}

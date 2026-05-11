/**
 * CLI watchdog: scoring, status transitions, and reactivation.
 *
 * This service powers the daily watchdog cron at `/api/cron/cli-watchdog`
 * (plan 10 task 7). For each `active` CLI it computes a heuristic spam score
 * from the last 24 hours of dispatched calls, and for each `cooling_down`
 * CLI it checks whether the 7-day cooldown window has elapsed.
 *
 * Score formula (0–100):
 *   - low pickup rate is the strongest spam signal carriers use
 *   - voicemail rate is moderate (some voicemail is unavoidable)
 *   - complaint rate (inbound IVR opt-outs) is the strongest single signal
 *
 *   score = round(40·(1 − pickup_rate) + 25·voicemail_rate + 35·complaint_rate)
 *
 *   Each term contributes its full weight at its worst case (pickup_rate=0,
 *   voicemail_rate=1, complaint_rate=1) and zero at its best, so the score
 *   is bounded to [0, 100] regardless of input noise.
 *
 * Transitions:
 *   active → cooling_down  when score > threshold (default 70). The CLI is
 *                          excluded from the picker for 7 days.
 *   active → retired       when entering a 3rd cooldown in 30 days.
 *   cooling_down → active  when the 7-day cooldown window has elapsed and
 *                          the CLI has not been retired.
 *   retired → *            never (manual reactivation only).
 *
 * Side effects:
 *   - inserts a `cli_cooldown_history` row for each `→ cooling_down` event
 *   - updates `phone_numbers.spam_score` to the freshly computed score on
 *     every active CLI evaluated (so the dashboard reflects current health)
 *   - emits `cli/cooling-down` or `cli/retired` Inngest events for plan 13's
 *     notification handler
 */

import { and, count, eq, gte, isNotNull, sql } from 'drizzle-orm';

import { type DbTx, withSystemContext } from '@/lib/db/context';
import { calls, cliCooldownHistory, optOutRegistry, phoneNumbers } from '@/lib/db/schema';
// Import directly from the leaf modules instead of the umbrella `@/lib/inngest`
// re-export. The umbrella module pulls in `processContactsImport` →
// `storage/signed.ts` → `supabase/admin.ts`, which requires Supabase env vars;
// the watchdog only needs the event names and the publish helper.
import { sendInngestEvents, type InngestEventPayload } from '@/lib/inngest/client';
import { CLI_COOLING_DOWN_EVENT, CLI_RETIRED_EVENT } from '@/lib/inngest/handlers/cli';
import { logger } from '@/lib/observability/logger';

// ── Tunables ────────────────────────────────────────────────────────────────

/** Spam score threshold above which an active CLI is moved to cooling_down. */
export const DEFAULT_SPAM_SCORE_THRESHOLD = 70;

/** Cooldown window length: a CLI stays excluded from the picker this long. */
export const COOLDOWN_DURATION_DAYS = 7;

/** Retirement trigger: more than this many cooldowns in 30 days → retire. */
export const RETIREMENT_COOLDOWN_LIMIT = 2;

/** Rolling window for counting cooldowns when deciding to retire. */
export const RETIREMENT_WINDOW_DAYS = 30;

/** Lower bound on dialed calls before a score is meaningful. */
export const MIN_CALLS_FOR_SCORING = 10;

/** Minimum duration (seconds) for a completed call to count as a real pickup. */
const PICKUP_MIN_SECONDS = 10;

// ── Public API ──────────────────────────────────────────────────────────────

export interface CliMetricsRow {
  phoneNumberId: string;
  e164: string;
  /**
   * Carrier supplying this CLI. Surfaced on `/admin/cli-pool` (plan 10 task 14)
   * so the founder can see at a glance whether dispatched volume is balanced
   * across the SBC primary (`voiped`/`telnyx`) and the Twilio fallback.
   */
  provider: 'voiped' | 'twilio' | 'telnyx';
  status: 'active' | 'cooling_down' | 'retired';
  dialed: number;
  pickups: number;
  voicemails: number;
  complaints: number;
  pickupRate: number;
  voicemailRate: number;
  complaintRate: number;
  spamScore: number;
}

export interface WatchdogTransition {
  phoneNumberId: string;
  e164: string;
  from: 'active' | 'cooling_down';
  to: 'cooling_down' | 'retired' | 'active';
  spamScore: number;
  cooldownsInWindow: number;
}

export interface WatchdogResult {
  evaluated: number;
  transitions: WatchdogTransition[];
}

export interface RunWatchdogOptions {
  threshold?: number;
  /** Override "now" for deterministic tests. */
  now?: Date;
  /**
   * Run inside an existing transaction instead of opening a new
   * `withSystemContext`. Used by integration tests so the watchdog and the
   * seed data share the same rolled-back transaction.
   */
  tx?: DbTx;
}

/**
 * Computes the spam-score components and final score for a single CLI.
 * Returns score=0 when fewer than `MIN_CALLS_FOR_SCORING` calls were dialed
 * — small samples are statistically unreliable, so we keep the CLI active
 * rather than risking a false-positive cooldown.
 */
export function computeSpamScore(input: {
  dialed: number;
  pickups: number;
  voicemails: number;
  complaints: number;
}): {
  score: number;
  pickupRate: number;
  voicemailRate: number;
  complaintRate: number;
} {
  const { dialed, pickups, voicemails, complaints } = input;
  if (dialed === 0) {
    return { score: 0, pickupRate: 0, voicemailRate: 0, complaintRate: 0 };
  }
  const pickupRate = Math.min(1, pickups / dialed);
  const voicemailRate = Math.min(1, voicemails / dialed);
  const complaintRate = Math.min(1, complaints / dialed);

  if (dialed < MIN_CALLS_FOR_SCORING) {
    return { score: 0, pickupRate, voicemailRate, complaintRate };
  }

  const raw = 40 * (1 - pickupRate) + 25 * voicemailRate + 35 * complaintRate;
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  return { score, pickupRate, voicemailRate, complaintRate };
}

/**
 * Returns one row per phone number with the last-N-day metrics computed by
 * the watchdog. Used by the founder dashboard and by `runWatchdog` itself.
 *
 * `windowDays` defaults to 1 to match the watchdog cadence; the dashboard
 * passes 7 to display weekly health.
 */
export async function collectCliMetrics(
  windowDays = 1,
  options: { tx?: DbTx; now?: Date } = {},
): Promise<CliMetricsRow[]> {
  const run = (tx: DbTx) => collectCliMetricsInner(tx, windowDays, options.now ?? new Date());
  if (options.tx) return run(options.tx);
  return withSystemContext(run);
}

async function collectCliMetricsInner(
  tx: DbTx,
  windowDays: number,
  now: Date,
): Promise<CliMetricsRow[]> {
  const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const cliRows = await tx
    .select({
      id: phoneNumbers.id,
      e164: phoneNumbers.e164,
      provider: phoneNumbers.provider,
      status: phoneNumbers.status,
    })
    .from(phoneNumbers);

  const out: CliMetricsRow[] = [];
  for (const cli of cliRows) {
    // Dialed = any outbound call that left "pending" (started_at IS NOT NULL)
    // from this CLI. Inbound IVR rows share the pool DID as `from_number`, so
    // every metric subquery filters on `direction = 'outbound'` to keep the
    // spam score scoped to dispatched campaign traffic.
    const dialedRows = await tx
      .select({ n: count() })
      .from(calls)
      .where(
        and(
          eq(calls.from_number, cli.e164),
          eq(calls.direction, 'outbound'),
          isNotNull(calls.started_at),
          gte(calls.started_at, since),
        ),
      );
    const dialed = Number(dialedRows[0]?.n ?? 0);

    const pickupsRows = await tx
      .select({ n: count() })
      .from(calls)
      .where(
        and(
          eq(calls.from_number, cli.e164),
          eq(calls.direction, 'outbound'),
          isNotNull(calls.started_at),
          gte(calls.started_at, since),
          eq(calls.status, 'completed'),
          sql`${calls.billable_seconds} > ${PICKUP_MIN_SECONDS}`,
        ),
      );
    const pickups = Number(pickupsRows[0]?.n ?? 0);

    const voicemailRows = await tx
      .select({ n: count() })
      .from(calls)
      .where(
        and(
          eq(calls.from_number, cli.e164),
          eq(calls.direction, 'outbound'),
          isNotNull(calls.started_at),
          gte(calls.started_at, since),
          eq(calls.status, 'voicemail'),
        ),
      );
    const voicemails = Number(voicemailRows[0]?.n ?? 0);

    // Complaints: opt-outs sourced from inbound IVR for any number ever called
    // from this CLI in the window. The inbound IVR (plan 10 task 9) records
    // source='inbound_ivr', so the join key is the dialed contact's phone. The
    // direction filter is defensive — inbound rows have null `contact_id` and
    // are already excluded by the INNER JOIN, but the explicit predicate makes
    // intent clear and protects against schema changes.
    const complaintRows = await tx.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n
      FROM ${optOutRegistry} o
      WHERE o.source = 'inbound_ivr'
        AND o.recorded_at >= ${since}
        AND EXISTS (
          SELECT 1 FROM ${calls} c
          INNER JOIN contacts ct ON ct.id = c.contact_id
          WHERE c.from_number = ${cli.e164}
            AND c.direction = 'outbound'
            AND c.started_at IS NOT NULL
            AND c.started_at >= ${since}
            AND ct.phone_e164 = o.phone_e164
            AND ct.org_id = o.org_id
        )
    `);
    const complaints = Number((complaintRows as unknown as { n: number }[])[0]?.n ?? 0);

    const { score, pickupRate, voicemailRate, complaintRate } = computeSpamScore({
      dialed,
      pickups,
      voicemails,
      complaints,
    });

    out.push({
      phoneNumberId: cli.id,
      e164: cli.e164,
      provider: cli.provider,
      status: cli.status,
      dialed,
      pickups,
      voicemails,
      complaints,
      pickupRate,
      voicemailRate,
      complaintRate,
      spamScore: score,
    });
  }
  return out;
}

/**
 * Runs the daily watchdog: re-scores every active CLI, moves spammy ones to
 * cooling_down (or retired on 3rd offence in 30 days), and reactivates any
 * cooling_down CLI whose 7-day window has expired. Idempotent: calling twice
 * in the same day produces the same end state, but each call still emits an
 * event for any transition that happened on that call (history rows are
 * inserted only on `→ cooling_down`, so re-running won't double-count).
 */
export async function runWatchdog(options: RunWatchdogOptions = {}): Promise<WatchdogResult> {
  const threshold = options.threshold ?? DEFAULT_SPAM_SCORE_THRESHOLD;
  const now = options.now ?? new Date();

  const work = async (tx: DbTx) => {
    const transitions: WatchdogTransition[] = [];
    const events: InngestEventPayload[] = [];

    // 1. Reactivate cooling_down CLIs whose window has expired.
    const cooldownExpiry = new Date(now.getTime() - COOLDOWN_DURATION_DAYS * 24 * 60 * 60 * 1000);
    const cooling = await tx
      .select({ id: phoneNumbers.id, e164: phoneNumbers.e164 })
      .from(phoneNumbers)
      .where(eq(phoneNumbers.status, 'cooling_down'));

    for (const row of cooling) {
      const [latest] = await tx
        .select({ started_at: cliCooldownHistory.started_at })
        .from(cliCooldownHistory)
        .where(eq(cliCooldownHistory.phone_number_id, row.id))
        .orderBy(sql`${cliCooldownHistory.started_at} DESC`)
        .limit(1);
      if (!latest) continue;
      if (latest.started_at <= cooldownExpiry) {
        await tx
          .update(phoneNumbers)
          .set({ status: 'active', spam_score: '0', daily_call_count: 0 })
          .where(eq(phoneNumbers.id, row.id));
        transitions.push({
          phoneNumberId: row.id,
          e164: row.e164,
          from: 'cooling_down',
          to: 'active',
          spamScore: 0,
          cooldownsInWindow: 0,
        });
      }
    }

    // 2. Re-score every active CLI.
    const metrics = await collectCliMetricsInner(tx, 1, now);
    const evaluated = metrics.filter((m) => m.status === 'active');

    for (const m of evaluated) {
      // Persist the freshest score so the dashboard and the picker tiebreaker
      // both see the up-to-date value.
      await tx
        .update(phoneNumbers)
        .set({ spam_score: String(m.spamScore) })
        .where(eq(phoneNumbers.id, m.phoneNumberId));

      if (m.spamScore <= threshold) continue;

      // Count prior cooldowns in the rolling window (this run will add one).
      const windowStart = new Date(
        now.getTime() - RETIREMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      );
      const [{ n: priorCount } = { n: 0 }] = await tx
        .select({ n: count() })
        .from(cliCooldownHistory)
        .where(
          and(
            eq(cliCooldownHistory.phone_number_id, m.phoneNumberId),
            gte(cliCooldownHistory.started_at, windowStart),
          ),
        );
      const cooldownsInWindow = Number(priorCount) + 1;

      // Always record this cooldown for forensics, regardless of whether the
      // outcome is cooling_down or retired.
      await tx.insert(cliCooldownHistory).values({
        phone_number_id: m.phoneNumberId,
        spam_score: String(m.spamScore),
        reason: 'spam_score_exceeded',
      });

      if (cooldownsInWindow > RETIREMENT_COOLDOWN_LIMIT) {
        await tx
          .update(phoneNumbers)
          .set({ status: 'retired', spam_score: String(m.spamScore) })
          .where(eq(phoneNumbers.id, m.phoneNumberId));
        transitions.push({
          phoneNumberId: m.phoneNumberId,
          e164: m.e164,
          from: 'active',
          to: 'retired',
          spamScore: m.spamScore,
          cooldownsInWindow,
        });
        events.push({
          name: CLI_RETIRED_EVENT,
          data: {
            phoneNumberId: m.phoneNumberId,
            e164: m.e164,
            cooldownsInWindow,
          },
        });
      } else {
        await tx
          .update(phoneNumbers)
          .set({ status: 'cooling_down', spam_score: String(m.spamScore) })
          .where(eq(phoneNumbers.id, m.phoneNumberId));
        const resumeAt = new Date(
          now.getTime() + COOLDOWN_DURATION_DAYS * 24 * 60 * 60 * 1000,
        );
        transitions.push({
          phoneNumberId: m.phoneNumberId,
          e164: m.e164,
          from: 'active',
          to: 'cooling_down',
          spamScore: m.spamScore,
          cooldownsInWindow,
        });
        events.push({
          name: CLI_COOLING_DOWN_EVENT,
          data: {
            phoneNumberId: m.phoneNumberId,
            e164: m.e164,
            spamScore: m.spamScore,
            pickupRate: m.pickupRate,
            voicemailRate: m.voicemailRate,
            complaintRate: m.complaintRate,
            resumeAt: resumeAt.toISOString(),
            cooldownsInWindow,
          },
        });
      }
    }

    return { transitions, events, evaluatedCount: evaluated.length };
  };

  const result = options.tx ? await work(options.tx) : await withSystemContext(work);

  // Inngest fan-out happens after commit so a failed event publish doesn't
  // roll back the watchdog's bookkeeping.
  if (result.events.length > 0) {
    try {
      await sendInngestEvents(result.events);
    } catch (err) {
      // Best-effort: the audit trail is still in cli_cooldown_history.
      void logger.error('Failed to publish CLI watchdog events', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { evaluated: result.evaluatedCount, transitions: result.transitions };
}

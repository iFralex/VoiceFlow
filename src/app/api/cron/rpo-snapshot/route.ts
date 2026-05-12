/**
 * Daily RPO snapshot cron — plan 11 task 2.
 *
 * Runs daily at 04:30 Europe/Rome (registered in `vercel.json`). Sweeps every
 * org's distinct B2C phone numbers whose RPO status is stale or unknown,
 * batches them through the configured `RpoClient.bulkCheck`, refreshes the
 * cross-org `rpo_snapshots` table, and propagates the result back into each
 * affected contact row.
 *
 * Numbers that transition `clear|unchecked → blocked` get the contact flagged
 * `opt_out=true` with reason `rpo_block`, and a `compliance/rpo-block-detected`
 * Inngest event is emitted per affected contact so plan 13 can notify the
 * dealer. Numbers that transition `blocked → clear` simply have their snapshot
 * and contact row updated; we do NOT clear `opt_out` because a contact may
 * have been opted out for an unrelated reason.
 *
 * Authenticates via the same `Authorization: Bearer ${CRON_SECRET}` header as
 * the other crons, with a byte-length-aware timing-safe compare.
 */

import { timingSafeEqual } from 'crypto';

import { and, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getRpoClient, type RpoClient } from '@/lib/compliance/rpo/client';
import { recordAudit } from '@/lib/db/audit';
import { withSystemContext } from '@/lib/db/context';
import { contacts, optOutRegistry, rpoSnapshots } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { sendInngestEvents } from '@/lib/inngest/client';
import { logger } from '@/lib/observability/logger';
import {
  COMPLIANCE_OPT_OUT_REGISTERED_EVENT,
  type ComplianceOptOutRegisteredData,
} from '@/lib/services/optout';

const CHUNK_SIZE = 1000;
const STALE_THRESHOLD_DAYS = 7;

export const RPO_BLOCK_DETECTED_EVENT = 'compliance/rpo-block-detected' as const;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function authorize(request: Request): boolean {
  const secret = env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!auth) return false;
  // Byte-length compare (not string length) — multibyte UTF-8 headers can match
  // on string length while differing in byte length, which would make
  // timingSafeEqual throw and the route 500 instead of returning a clean 401.
  const authBuf = Buffer.from(auth);
  const expectedBuf = Buffer.from(`Bearer ${secret}`);
  if (authBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(authBuf, expectedBuf);
}

// ---------------------------------------------------------------------------
// Snapshot routine
// ---------------------------------------------------------------------------

export interface RpoSnapshotResult {
  chunks: number;
  totalChecked: number;
  totalBlocked: number;
  totalContactsUpdated: number;
  totalNewlyBlockedContacts: number;
  errors: number;
}

/**
 * Runs the snapshot. Exposed for tests and for the route handler.
 *
 * `clientOverride` lets tests inject a deterministic RpoClient without going
 * through the env-driven factory.
 */
export async function runRpoSnapshot(clientOverride?: RpoClient): Promise<RpoSnapshotResult> {
  const rpoClient = clientOverride ?? getRpoClient();
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);

  let chunks = 0;
  let totalChecked = 0;
  let totalBlocked = 0;
  let totalContactsUpdated = 0;
  let totalNewlyBlockedContacts = 0;
  let errors = 0;

  let cursor: string | null = null;

  for (;;) {
    const phones = await fetchCandidatePhones(cursor, cutoff);
    if (phones.length === 0) break;

    try {
      const priorBlocked = await fetchPriorBlockedMap(phones);
      const result = await rpoClient.bulkCheck(phones);
      const checkedAt = new Date();

      const blockedNow: string[] = [];
      const clearNow: string[] = [];
      const newlyBlocked: string[] = [];
      for (const phone of phones) {
        const isBlocked = result.get(phone) ?? false;
        if (isBlocked) {
          blockedNow.push(phone);
          if (priorBlocked.get(phone) !== true) newlyBlocked.push(phone);
        } else {
          clearNow.push(phone);
        }
      }

      const chunkContactsUpdated = await persistChunk({
        phones,
        clearNow,
        blockedNow,
        result,
        checkedAt,
      });

      if (newlyBlocked.length > 0) {
        const affected = await emitRpoBlockEvents(newlyBlocked, checkedAt);
        totalNewlyBlockedContacts += affected;
      }

      totalChecked += phones.length;
      totalBlocked += blockedNow.length;
      totalContactsUpdated += chunkContactsUpdated;
      cursor = phones[phones.length - 1] ?? null;
      chunks++;
    } catch (err) {
      void logger.error('[rpo-snapshot] chunk failed', {
        cursor,
        chunkSize: phones.length,
        error: err instanceof Error ? err.message : String(err),
      });
      errors++;
      break;
    }

    if (phones.length < CHUNK_SIZE) break;
  }

  await withSystemContext(async (tx) => {
    await recordAudit(tx, {
      actorType: 'system',
      action: 'compliance.rpo_snapshot_completed',
      subjectType: 'rpo',
      subjectId: 'daily',
      metadata: {
        chunks,
        totalChecked,
        totalBlocked,
        totalContactsUpdated,
        totalNewlyBlockedContacts,
        errors,
      },
    });
  });

  return { chunks, totalChecked, totalBlocked, totalContactsUpdated, totalNewlyBlockedContacts, errors };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchCandidatePhones(cursor: string | null, cutoff: Date): Promise<string[]> {
  return withSystemContext(async (tx) => {
    const staleness = or(
      eq(contacts.rpo_status, 'unchecked'),
      isNull(contacts.rpo_checked_at),
      lt(contacts.rpo_checked_at, cutoff),
    );

    const conditions = [
      eq(contacts.contact_type, 'b2c'),
      eq(contacts.opt_out, false),
      isNull(contacts.deleted_at),
      staleness,
    ];
    if (cursor !== null) conditions.push(gt(contacts.phone_e164, cursor));

    const rows = await tx
      .selectDistinct({ phone_e164: contacts.phone_e164 })
      .from(contacts)
      .where(and(...conditions))
      .orderBy(contacts.phone_e164)
      .limit(CHUNK_SIZE);

    return rows.map((r) => r.phone_e164);
  });
}

async function fetchPriorBlockedMap(phones: string[]): Promise<Map<string, boolean>> {
  if (phones.length === 0) return new Map();
  return withSystemContext(async (tx) => {
    const rows = await tx
      .select({ phone_e164: rpoSnapshots.phone_e164, is_blocked: rpoSnapshots.is_blocked })
      .from(rpoSnapshots)
      .where(inArray(rpoSnapshots.phone_e164, phones));
    const map = new Map<string, boolean>();
    for (const r of rows) map.set(r.phone_e164, r.is_blocked);
    return map;
  });
}

interface PersistChunkArgs {
  phones: string[];
  clearNow: string[];
  blockedNow: string[];
  result: Map<string, boolean>;
  checkedAt: Date;
}

async function persistChunk({
  phones,
  clearNow,
  blockedNow,
  result,
  checkedAt,
}: PersistChunkArgs): Promise<number> {
  return withSystemContext(async (tx) => {
    if (phones.length > 0) {
      await tx
        .insert(rpoSnapshots)
        .values(
          phones.map((phone) => ({
            phone_e164: phone,
            is_blocked: result.get(phone) ?? false,
            last_checked_at: checkedAt,
          })),
        )
        .onConflictDoUpdate({
          target: rpoSnapshots.phone_e164,
          set: {
            is_blocked: sql`excluded.is_blocked`,
            last_checked_at: sql`excluded.last_checked_at`,
          },
        });
    }

    let updated = 0;

    if (clearNow.length > 0) {
      const r = await tx
        .update(contacts)
        .set({ rpo_status: 'clear', rpo_checked_at: checkedAt })
        .where(
          and(
            inArray(contacts.phone_e164, clearNow),
            isNull(contacts.deleted_at),
            eq(contacts.contact_type, 'b2c'),
          ),
        )
        .returning({ id: contacts.id });
      updated += r.length;
    }

    if (blockedNow.length > 0) {
      // Guard with `opt_out = false` so we do NOT flip `opt_out_reason` on
      // contacts already opted out for an unrelated reason (e.g. another org
      // has the same number flagged via `dealer_input`). Without this filter
      // the daily cron would silently rewrite the original source recorded by
      // the unified opt-out service every run, masking who first opted them
      // out. Already-opted-out rows keep their existing `rpo_status` — they
      // aren't callable anyway and `rpo_snapshots` carries the cross-org truth.
      const r = await tx
        .update(contacts)
        .set({
          rpo_status: 'blocked',
          rpo_checked_at: checkedAt,
          opt_out: true,
          opt_out_reason: 'rpo_block',
        })
        .where(
          and(
            inArray(contacts.phone_e164, blockedNow),
            isNull(contacts.deleted_at),
            eq(contacts.opt_out, false),
            eq(contacts.contact_type, 'b2c'),
          ),
        )
        .returning({ id: contacts.id });
      updated += r.length;
    }

    return updated;
  });
}

async function emitRpoBlockEvents(phones: string[], checkedAt: Date): Promise<number> {
  const affected = await withSystemContext(async (tx) => {
    const rows = await tx
      .select({
        id: contacts.id,
        org_id: contacts.org_id,
        phone_e164: contacts.phone_e164,
      })
      .from(contacts)
      .where(
        and(inArray(contacts.phone_e164, phones), isNull(contacts.deleted_at)),
      );

    if (rows.length === 0) return rows;

    // Plan 11 task 5: route every newly-blocked tuple through the unified
    // opt-out registry. The cron's bulk UPDATE on `contacts` is the fast path
    // for the daily sweep — without this companion insert each (org, phone)
    // would lack the registry entry that downstream services expect.
    await tx
      .insert(optOutRegistry)
      .values(
        rows.map((r) => ({
          org_id: r.org_id,
          phone_e164: r.phone_e164,
          source: 'rpo_block' as const,
        })),
      )
      .onConflictDoNothing();

    // Per-tuple audit entry — only fires on a true clear|unchecked → blocked
    // transition (the caller already filtered through `priorBlocked` so daily
    // re-runs of an already-blocked number do not pile up duplicate entries).
    for (const r of rows) {
      await recordAudit(tx, {
        orgId: r.org_id,
        actorType: 'system',
        action: 'opt_out.recorded',
        subjectType: 'phone_number',
        subjectId: r.phone_e164,
        metadata: {
          source: 'rpo_block',
          contactId: r.id,
          checkedAt: checkedAt.toISOString(),
        },
      });
    }

    return rows;
  });

  if (affected.length === 0) return 0;

  // One batch with both event types: the legacy `compliance/rpo-block-detected`
  // (RPO-specific dealer notifier in plan 13) and the unified
  // `compliance/opt-out-registered` (consumed by the same plan-13 notifier for
  // every opt-out source). Inngest dedupes both kinds via the per-event id.
  const rpoEvents = affected.map((c) => ({
    name: RPO_BLOCK_DETECTED_EVENT,
    data: {
      orgId: c.org_id,
      contactId: c.id,
      phoneE164: c.phone_e164,
      checkedAt: checkedAt.toISOString(),
    },
    id: `rpo-block-${c.id}-${checkedAt.getTime()}`,
  }));

  const optOutEvents = affected.map((c) => ({
    name: COMPLIANCE_OPT_OUT_REGISTERED_EVENT,
    data: {
      orgId: c.org_id,
      phoneE164: c.phone_e164,
      source: 'rpo_block' as const,
      recordedAt: checkedAt.toISOString(),
    } satisfies ComplianceOptOutRegisteredData as unknown as Record<string, unknown>,
    id: `opt-out-${c.org_id}-${c.phone_e164}-rpo_block`,
  }));

  await sendInngestEvents([...rpoEvents, ...optOutEvents]);

  return affected.length;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<Response> {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await runRpoSnapshot();
  return NextResponse.json({ ok: true, ...result });
}

export const dynamic = 'force-dynamic';

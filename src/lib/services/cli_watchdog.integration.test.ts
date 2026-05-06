/**
 * Integration tests for the CLI watchdog. Each test runs inside a
 * `withTestDb` transaction (always rolled back) so the test database is
 * never mutated.
 *
 * These tests cover the SQL-driven behaviour the unit tests cannot:
 *   - active → cooling_down on threshold breach
 *   - cooldown_history rows are inserted with the triggering score
 *   - cooling_down → active reactivation after the 7-day window
 *   - active → retired on the 3rd cooldown in 30 days
 *   - retired CLIs are never reactivated
 *   - dashboard metrics reflect dialed/pickup/voicemail counts
 *
 * Prerequisites:
 *   docker compose -f infra/test/docker-compose.yml up -d
 *   DATABASE_DIRECT_URL=postgresql://postgres:postgres@localhost:5433/vox_auto_test \
 *     pnpm db:migrate
 */

import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

// Stub the low-level Inngest client so the watchdog's fan-out is a no-op in
// tests. Mocking the umbrella `@/lib/inngest` re-export pulls in
// `processContactsImport` → `storage/signed.ts` → `supabase/admin.ts` which
// requires real env vars; mocking just the client side-steps that chain.
vi.mock('@/lib/inngest/client', () => ({
  sendInngestEvent: vi.fn().mockResolvedValue(undefined),
  sendInngestEvents: vi.fn().mockResolvedValue(undefined),
}));

import type { DbTx as ProdDbTx } from '@/lib/db/context';
import {
  calls,
  campaigns,
  cliCooldownHistory,
  contactLists,
  contacts,
  optOutRegistry,
  organizations,
  phoneNumbers,
  scriptTemplates,
  scripts,
} from '@/lib/db/schema';
import { type DbTx as TestDbTx, withTestDb } from '@/test/db';

import {
  collectCliMetrics,
  COOLDOWN_DURATION_DAYS,
  runWatchdog,
} from './cli_watchdog';

// ── Fixed UUIDs (9x prefix to avoid collisions with picker test 8x) ─────────

const ORG = '90000000-0000-0000-0000-000000000001';
const PHONE_HEALTHY = '90000000-0000-0000-0000-000000000010';
const PHONE_SPAMMY = '90000000-0000-0000-0000-000000000011';
const PHONE_COOLING_FRESH = '90000000-0000-0000-0000-000000000012';
const PHONE_COOLING_OLD = '90000000-0000-0000-0000-000000000013';
const PHONE_RETIRING = '90000000-0000-0000-0000-000000000014';
const PHONE_RETIRED = '90000000-0000-0000-0000-000000000015';

const TEMPLATE_ID = '90000000-0000-0000-0000-000000000020';
const SCRIPT_ID = '90000000-0000-0000-0000-000000000021';
const LIST_ID = '90000000-0000-0000-0000-000000000022';
const CONTACT_ID = '90000000-0000-0000-0000-000000000023';
const CAMPAIGN_ID = '90000000-0000-0000-0000-000000000024';
const CONTACT_PHONE = '+393409999999';

const skipWhenNoDb = !process.env['TEST_DATABASE_URL'];

function asProdTx(tx: TestDbTx): ProdDbTx {
  return tx as unknown as ProdDbTx;
}

async function seedScaffold(tx: TestDbTx) {
  await tx.insert(organizations).values({
    id: ORG,
    name: 'Watchdog Org',
    country: 'IT',
    timezone: 'Europe/Rome',
  });
  await tx.insert(scriptTemplates).values({
    id: TEMPLATE_ID,
    slug: 'watchdog-test',
    name: 'Watchdog Test',
    version: 1,
    system_prompt: 'sys',
    variable_schema: { properties: {} } as unknown as object,
    default_voice_id: 'placeholder',
  });
  await tx.insert(scripts).values({
    id: SCRIPT_ID,
    org_id: ORG,
    template_id: TEMPLATE_ID,
    name: 'Test Script',
    variables: {},
    voice_id: null,
  });
  await tx.insert(contactLists).values({
    id: LIST_ID,
    org_id: ORG,
    name: 'Test List',
    source: 'api',
    total_count: 1,
    valid_count: 1,
  });
  await tx.insert(contacts).values({
    id: CONTACT_ID,
    org_id: ORG,
    contact_list_id: LIST_ID,
    phone_e164: CONTACT_PHONE,
    consent_basis: 'consent',
  });
  await tx.insert(campaigns).values({
    id: CAMPAIGN_ID,
    org_id: ORG,
    contact_list_id: LIST_ID,
    script_id: SCRIPT_ID,
    name: 'Test Campaign',
    status: 'draft',
  });
}

async function insertCall(
  tx: TestDbTx,
  fromNumber: string,
  status: 'completed' | 'voicemail' | 'no_answer' | 'failed',
  durationSeconds: number | null,
  startedAt: Date,
) {
  await tx.insert(calls).values({
    org_id: ORG,
    campaign_id: CAMPAIGN_ID,
    contact_id: CONTACT_ID,
    provider: 'vapi',
    status,
    from_number: fromNumber,
    started_at: startedAt,
    billable_seconds: durationSeconds,
  });
}

function runWatchdogInTx(tx: TestDbTx, now: Date, threshold?: number) {
  const opts: Parameters<typeof runWatchdog>[0] = { now, tx: asProdTx(tx) };
  if (threshold !== undefined) opts.threshold = threshold;
  return runWatchdog(opts);
}

/**
 * Seeds `count` voicemail calls with distinct contacts, each followed by an
 * inbound-IVR opt-out for that contact's phone. Produces dialed=count,
 * voicemails=count, complaints=count → max score (100). The `salt` lets
 * callers reuse this helper across multiple CLIs in the same test transaction
 * without primary-key collisions.
 */
async function seedSpammyTraffic(
  tx: TestDbTx,
  fromNumber: string,
  count: number,
  startedAt: Date,
  salt: number,
) {
  for (let i = 0; i < count; i++) {
    const phone = `+393408${String(salt).padStart(3, '0')}${String(i).padStart(4, '0')}`;
    const contactId =
      `90000000-0000-0000-0000-0000${String(salt).padStart(4, '0')}${String(i).padStart(4, '0')}`;
    await tx.insert(contacts).values({
      id: contactId,
      org_id: ORG,
      contact_list_id: LIST_ID,
      phone_e164: phone,
      consent_basis: 'consent',
    });
    await tx.insert(calls).values({
      org_id: ORG,
      campaign_id: CAMPAIGN_ID,
      contact_id: contactId,
      provider: 'vapi',
      status: 'voicemail',
      from_number: fromNumber,
      started_at: startedAt,
    });
    await tx.insert(optOutRegistry).values({
      org_id: ORG,
      phone_e164: phone,
      source: 'inbound_ivr',
      recorded_at: startedAt,
    });
  }
}

describe('collectCliMetrics integration', () => {
  it.skipIf(skipWhenNoDb)('reports dialed/pickup/voicemail/score per CLI', async () => {
    await withTestDb(async (tx) => {
      await seedScaffold(tx);
      await tx.insert(phoneNumbers).values([
        {
          id: PHONE_HEALTHY,
          e164: '+390299990001',
          org_id: null,
          provider: 'voiped',
          status: 'active',
          region: 'milano',
          capabilities: ['landline'],
          daily_call_count: 0,
          spam_score: '0',
        },
      ]);
      const now = new Date();
      const recent = new Date(now.getTime() - 60 * 60 * 1000);
      // 12 dialed, 10 pickups (>10s), 2 voicemails → healthy score
      for (let i = 0; i < 10; i++) {
        await insertCall(tx, '+390299990001', 'completed', 30, recent);
      }
      await insertCall(tx, '+390299990001', 'voicemail', null, recent);
      await insertCall(tx, '+390299990001', 'voicemail', null, recent);

      const metrics = await collectCliMetrics(1, { tx: asProdTx(tx), now });
      const row = metrics.find((m) => m.e164 === '+390299990001');
      expect(row).toBeDefined();
      expect(row!.dialed).toBe(12);
      expect(row!.pickups).toBe(10);
      expect(row!.voicemails).toBe(2);
      expect(row!.spamScore).toBeLessThanOrEqual(20);
    });
  });

  it.skipIf(skipWhenNoDb)('ignores calls outside the window', async () => {
    await withTestDb(async (tx) => {
      await seedScaffold(tx);
      await tx.insert(phoneNumbers).values({
        id: PHONE_HEALTHY,
        e164: '+390299990001',
        org_id: null,
        provider: 'voiped',
        status: 'active',
        region: 'milano',
        capabilities: ['landline'],
        daily_call_count: 0,
        spam_score: '0',
      });
      const now = new Date();
      const inWindow = new Date(now.getTime() - 60 * 60 * 1000);
      const outOfWindow = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
      await insertCall(tx, '+390299990001', 'completed', 30, inWindow);
      await insertCall(tx, '+390299990001', 'voicemail', null, outOfWindow);

      const metrics = await collectCliMetrics(1, { tx: asProdTx(tx), now });
      const row = metrics.find((m) => m.e164 === '+390299990001');
      expect(row!.dialed).toBe(1);
      expect(row!.voicemails).toBe(0);
    });
  });
});

describe('runWatchdog integration', () => {
  it.skipIf(skipWhenNoDb)('moves a high-score active CLI to cooling_down and inserts history', async () => {
    await withTestDb(async (tx) => {
      await seedScaffold(tx);
      await tx.insert(phoneNumbers).values({
        id: PHONE_SPAMMY,
        e164: '+390299990002',
        org_id: null,
        provider: 'voiped',
        status: 'active',
        region: 'milano',
        capabilities: ['landline'],
        daily_call_count: 5,
        spam_score: '0',
      });
      const now = new Date();
      const recent = new Date(now.getTime() - 60 * 60 * 1000);
      await seedSpammyTraffic(tx, '+390299990002', 30, recent, 0);

      const result = await runWatchdogInTx(tx, now);
      const cooled = result.transitions.find((t) => t.to === 'cooling_down');
      expect(cooled).toBeDefined();
      expect(cooled!.e164).toBe('+390299990002');
      expect(cooled!.cooldownsInWindow).toBe(1);

      const after = await tx
        .select({ status: phoneNumbers.status })
        .from(phoneNumbers)
        .where(eq(phoneNumbers.id, PHONE_SPAMMY));
      expect(after[0]?.status).toBe('cooling_down');

      const history = await tx
        .select()
        .from(cliCooldownHistory)
        .where(eq(cliCooldownHistory.phone_number_id, PHONE_SPAMMY));
      expect(history).toHaveLength(1);
      expect(history[0]?.reason).toBe('spam_score_exceeded');
    });
  });

  it.skipIf(skipWhenNoDb)('reactivates a cooling_down CLI whose 7-day window has expired', async () => {
    await withTestDb(async (tx) => {
      await seedScaffold(tx);
      await tx.insert(phoneNumbers).values({
        id: PHONE_COOLING_OLD,
        e164: '+390299990003',
        org_id: null,
        provider: 'voiped',
        status: 'cooling_down',
        region: 'milano',
        capabilities: ['landline'],
        daily_call_count: 0,
        spam_score: '85',
      });
      const now = new Date();
      const cooledLongAgo = new Date(
        now.getTime() - (COOLDOWN_DURATION_DAYS + 1) * 24 * 60 * 60 * 1000,
      );
      await tx.insert(cliCooldownHistory).values({
        phone_number_id: PHONE_COOLING_OLD,
        spam_score: '85',
        started_at: cooledLongAgo,
      });

      const result = await runWatchdogInTx(tx, now);
      const reactivated = result.transitions.find((t) => t.to === 'active');
      expect(reactivated).toBeDefined();
      expect(reactivated!.e164).toBe('+390299990003');

      const after = await tx
        .select({ status: phoneNumbers.status, spam_score: phoneNumbers.spam_score })
        .from(phoneNumbers)
        .where(eq(phoneNumbers.id, PHONE_COOLING_OLD));
      expect(after[0]?.status).toBe('active');
      expect(Number(after[0]?.spam_score)).toBe(0);
    });
  });

  it.skipIf(skipWhenNoDb)('does not reactivate a cooling_down CLI whose window is still open', async () => {
    await withTestDb(async (tx) => {
      await seedScaffold(tx);
      await tx.insert(phoneNumbers).values({
        id: PHONE_COOLING_FRESH,
        e164: '+390299990004',
        org_id: null,
        provider: 'voiped',
        status: 'cooling_down',
        region: 'milano',
        capabilities: ['landline'],
        daily_call_count: 0,
        spam_score: '85',
      });
      const now = new Date();
      const cooledRecently = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
      await tx.insert(cliCooldownHistory).values({
        phone_number_id: PHONE_COOLING_FRESH,
        spam_score: '85',
        started_at: cooledRecently,
      });

      const result = await runWatchdogInTx(tx, now);
      const reactivated = result.transitions.find(
        (t) => t.e164 === '+390299990004' && t.to === 'active',
      );
      expect(reactivated).toBeUndefined();

      const after = await tx
        .select({ status: phoneNumbers.status })
        .from(phoneNumbers)
        .where(eq(phoneNumbers.id, PHONE_COOLING_FRESH));
      expect(after[0]?.status).toBe('cooling_down');
    });
  });

  it.skipIf(skipWhenNoDb)(
    'retires a CLI whose 3rd cooldown in 30 days is triggered by this run',
    async () => {
      await withTestDb(async (tx) => {
        await seedScaffold(tx);
        await tx.insert(phoneNumbers).values({
          id: PHONE_RETIRING,
          e164: '+390299990005',
          org_id: null,
          provider: 'voiped',
          status: 'active',
          region: 'milano',
          capabilities: ['landline'],
          daily_call_count: 0,
          spam_score: '0',
        });
        const now = new Date();
        // Two prior cooldowns inside the 30-day window.
        for (let i = 0; i < 2; i++) {
          await tx.insert(cliCooldownHistory).values({
            phone_number_id: PHONE_RETIRING,
            spam_score: '85',
            started_at: new Date(now.getTime() - (i + 1) * 5 * 24 * 60 * 60 * 1000),
          });
        }

        const recent = new Date(now.getTime() - 60 * 60 * 1000);
        // Drive the score above the threshold using inbound IVR complaints
        // and voicemails as in the cooldown test above.
        for (let i = 0; i < 10; i++) {
          const phone = `+393409888${String(i).padStart(3, '0')}`;
          const id = `90000000-0000-0000-0000-0000004${String(i).padStart(5, '0')}`;
          await tx.insert(contacts).values({
            id,
            org_id: ORG,
            contact_list_id: LIST_ID,
            phone_e164: phone,
            consent_basis: 'consent',
          });
          await tx.insert(calls).values({
            org_id: ORG,
            campaign_id: CAMPAIGN_ID,
            contact_id: id,
            provider: 'vapi',
            status: 'voicemail',
            from_number: '+390299990005',
            started_at: recent,
          });
          await tx.insert(optOutRegistry).values({
            org_id: ORG,
            phone_e164: phone,
            source: 'inbound_ivr',
            recorded_at: recent,
          });
        }

        const result = await runWatchdogInTx(tx, now);
        const retired = result.transitions.find((t) => t.to === 'retired');
        expect(retired).toBeDefined();
        expect(retired!.e164).toBe('+390299990005');
        expect(retired!.cooldownsInWindow).toBe(3);

        const after = await tx
          .select({ status: phoneNumbers.status })
          .from(phoneNumbers)
          .where(eq(phoneNumbers.id, PHONE_RETIRING));
        expect(after[0]?.status).toBe('retired');
      });
    },
  );

  it.skipIf(skipWhenNoDb)('never reactivates a retired CLI', async () => {
    await withTestDb(async (tx) => {
      await seedScaffold(tx);
      await tx.insert(phoneNumbers).values({
        id: PHONE_RETIRED,
        e164: '+390299990006',
        org_id: null,
        provider: 'voiped',
        status: 'retired',
        region: 'milano',
        capabilities: ['landline'],
        daily_call_count: 0,
        spam_score: '90',
      });
      const now = new Date();
      // Old cooldown so reactivation logic could conceivably consider it.
      await tx.insert(cliCooldownHistory).values({
        phone_number_id: PHONE_RETIRED,
        spam_score: '90',
        started_at: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000),
      });

      await runWatchdogInTx(tx, now);

      const after = await tx
        .select({ status: phoneNumbers.status })
        .from(phoneNumbers)
        .where(eq(phoneNumbers.id, PHONE_RETIRED));
      expect(after[0]?.status).toBe('retired');
    });
  });

  it.skipIf(skipWhenNoDb)('persists the freshly computed score for an active CLI', async () => {
    await withTestDb(async (tx) => {
      await seedScaffold(tx);
      await tx.insert(phoneNumbers).values({
        id: PHONE_HEALTHY,
        e164: '+390299990007',
        org_id: null,
        provider: 'voiped',
        status: 'active',
        region: 'milano',
        capabilities: ['landline'],
        daily_call_count: 0,
        spam_score: '50', // stale value; the watchdog should overwrite it
      });
      const now = new Date();
      const recent = new Date(now.getTime() - 60 * 60 * 1000);
      for (let i = 0; i < 30; i++) {
        await insertCall(tx, '+390299990007', 'completed', 30, recent);
      }

      await runWatchdogInTx(tx, now);

      const after = await tx
        .select({ spam_score: phoneNumbers.spam_score })
        .from(phoneNumbers)
        .where(eq(phoneNumbers.id, PHONE_HEALTHY));
      // Healthy CLI: score should be 0 (high pickup, no voicemail/complaint).
      expect(Number(after[0]?.spam_score)).toBe(0);
    });
  });

  it.skipIf(skipWhenNoDb)(
    'cycles a flagged CLI active → cooling_down and back to active across two runs (plan 10 task 16)',
    async () => {
      await withTestDb(async (tx) => {
        await seedScaffold(tx);
        await tx.insert(phoneNumbers).values({
          id: PHONE_SPAMMY,
          e164: '+390299990099',
          org_id: null,
          provider: 'voiped',
          status: 'active',
          region: 'milano',
          capabilities: ['landline'],
          daily_call_count: 0,
          spam_score: '0',
        });

        // ── Run 1: spammy traffic in the last hour, watchdog cools the CLI.
        const day1 = new Date('2026-05-01T02:00:00Z');
        const day1Recent = new Date(day1.getTime() - 60 * 60 * 1000);
        await seedSpammyTraffic(tx, '+390299990099', 30, day1Recent, 99);

        const r1 = await runWatchdogInTx(tx, day1);
        const cooled = r1.transitions.find(
          (t) => t.e164 === '+390299990099' && t.to === 'cooling_down',
        );
        expect(cooled).toBeDefined();
        expect(cooled!.cooldownsInWindow).toBe(1);

        const afterRun1 = await tx
          .select({ status: phoneNumbers.status })
          .from(phoneNumbers)
          .where(eq(phoneNumbers.id, PHONE_SPAMMY));
        expect(afterRun1[0]?.status).toBe('cooling_down');

        // The cooldown-history row records the day1 timestamp.
        const history = await tx
          .select({ started_at: cliCooldownHistory.started_at })
          .from(cliCooldownHistory)
          .where(eq(cliCooldownHistory.phone_number_id, PHONE_SPAMMY));
        expect(history).toHaveLength(1);

        // ── Run 2: advance past the 7-day window. The same CLI should
        //         reactivate. We do not insert any new spammy traffic, so
        //         re-scoring should yield 0 and the CLI stays active.
        const day2 = new Date(day1.getTime() + (COOLDOWN_DURATION_DAYS + 1) * 24 * 60 * 60 * 1000);
        const r2 = await runWatchdogInTx(tx, day2);
        const reactivated = r2.transitions.find(
          (t) => t.e164 === '+390299990099' && t.to === 'active',
        );
        expect(reactivated).toBeDefined();

        const afterRun2 = await tx
          .select({ status: phoneNumbers.status, spam_score: phoneNumbers.spam_score })
          .from(phoneNumbers)
          .where(eq(phoneNumbers.id, PHONE_SPAMMY));
        expect(afterRun2[0]?.status).toBe('active');
        expect(Number(afterRun2[0]?.spam_score)).toBe(0);
      });
    },
  );
});


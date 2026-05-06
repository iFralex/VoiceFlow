/**
 * Integration tests for `findRecentOutboundCallsToNumber`. Each test runs
 * inside a `withTestDb` transaction (always rolled back) so the test database
 * is never mutated.
 *
 * These tests exercise real Postgres semantics that the unit tests cannot:
 *   - the JOIN onto `contacts.phone_e164`
 *   - the `direction = 'outbound'` filter
 *   - the `make_interval(days => N)` lookback window
 *   - cross-org results (multiple orgs called the same number) — system
 *     context, no RLS scoping
 *
 * Prerequisites:
 *   docker compose -f infra/test/docker-compose.yml up -d
 *   DATABASE_DIRECT_URL=postgresql://postgres:postgres@localhost:5433/vox_auto_test \
 *     pnpm db:migrate
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/vox_auto_test
 */

import { describe, expect, it } from 'vitest';

import type { DbTx as ProdDbTx } from '@/lib/db/context';
import {
  calls,
  campaigns,
  contactLists,
  contacts,
  organizations,
  scriptTemplates,
  scripts,
} from '@/lib/db/schema';
import { type DbTx as TestDbTx, withTestDb } from '@/test/db';

import { findRecentOutboundCallsToNumber } from './lookup';

// ── Fixed test UUIDs ────────────────────────────────────────────────────────
// Using 9x prefix to avoid collisions with other integration tests
// (contacts uses 1x, multitenancy uses 2x/3x, calls uses 7x, picker uses 8x).

const ORG_A = '90000000-0000-0000-0000-000000000001';
const ORG_B = '90000000-0000-0000-0000-000000000002';
const ORG_C = '90000000-0000-0000-0000-000000000003';

const TEMPLATE_ID = '90000000-0000-0000-0000-000000000020';

const SCRIPT_A = '90000000-0000-0000-0000-000000000031';
const SCRIPT_B = '90000000-0000-0000-0000-000000000032';
const SCRIPT_C = '90000000-0000-0000-0000-000000000033';

const LIST_A = '90000000-0000-0000-0000-000000000041';
const LIST_B = '90000000-0000-0000-0000-000000000042';
const LIST_C = '90000000-0000-0000-0000-000000000043';

const CONTACT_A = '90000000-0000-0000-0000-000000000051';
const CONTACT_B = '90000000-0000-0000-0000-000000000052';
const CONTACT_C = '90000000-0000-0000-0000-000000000053';
const CONTACT_OTHER = '90000000-0000-0000-0000-000000000054';

const CAMPAIGN_A = '90000000-0000-0000-0000-000000000061';
const CAMPAIGN_B = '90000000-0000-0000-0000-000000000062';
const CAMPAIGN_C = '90000000-0000-0000-0000-000000000063';

const TARGET_PHONE = '+393401112233';
const OTHER_PHONE = '+393404445566';

const skipWhenNoDb = !process.env['TEST_DATABASE_URL'];

function asProdTx(tx: TestDbTx): ProdDbTx {
  return tx as unknown as ProdDbTx;
}

/**
 * Seeds three orgs with their own contact-list / contact / script / campaign,
 * all calling `TARGET_PHONE`. ORG_C also has a separate contact at
 * `OTHER_PHONE` so we can verify the phone-number filter excludes unrelated
 * rows.
 */
async function seedThreeOrgsCallingSamePhone(tx: TestDbTx) {
  await tx.insert(organizations).values([
    { id: ORG_A, name: 'Org A', country: 'IT', timezone: 'Europe/Rome' },
    { id: ORG_B, name: 'Org B', country: 'IT', timezone: 'Europe/Rome' },
    { id: ORG_C, name: 'Org C', country: 'IT', timezone: 'Europe/Rome' },
  ]);

  await tx.insert(scriptTemplates).values({
    id: TEMPLATE_ID,
    slug: 'inbound-lookup-test',
    name: 'Inbound Lookup Test',
    version: 1,
    system_prompt: 'system',
    variable_schema: { properties: {} } as unknown as object,
    default_voice_id: 'placeholder',
  });

  await tx.insert(scripts).values([
    { id: SCRIPT_A, org_id: ORG_A, template_id: TEMPLATE_ID, name: 'Script A', variables: {}, voice_id: null },
    { id: SCRIPT_B, org_id: ORG_B, template_id: TEMPLATE_ID, name: 'Script B', variables: {}, voice_id: null },
    { id: SCRIPT_C, org_id: ORG_C, template_id: TEMPLATE_ID, name: 'Script C', variables: {}, voice_id: null },
  ]);

  await tx.insert(contactLists).values([
    { id: LIST_A, org_id: ORG_A, name: 'List A', source: 'api', total_count: 1, valid_count: 1 },
    { id: LIST_B, org_id: ORG_B, name: 'List B', source: 'api', total_count: 1, valid_count: 1 },
    { id: LIST_C, org_id: ORG_C, name: 'List C', source: 'api', total_count: 2, valid_count: 2 },
  ]);

  await tx.insert(contacts).values([
    {
      id: CONTACT_A,
      org_id: ORG_A,
      contact_list_id: LIST_A,
      phone_e164: TARGET_PHONE,
      consent_basis: 'consent',
    },
    {
      id: CONTACT_B,
      org_id: ORG_B,
      contact_list_id: LIST_B,
      phone_e164: TARGET_PHONE,
      consent_basis: 'consent',
    },
    {
      id: CONTACT_C,
      org_id: ORG_C,
      contact_list_id: LIST_C,
      phone_e164: TARGET_PHONE,
      consent_basis: 'consent',
    },
    {
      id: CONTACT_OTHER,
      org_id: ORG_C,
      contact_list_id: LIST_C,
      phone_e164: OTHER_PHONE,
      consent_basis: 'consent',
    },
  ]);

  await tx.insert(campaigns).values([
    { id: CAMPAIGN_A, org_id: ORG_A, contact_list_id: LIST_A, script_id: SCRIPT_A, name: 'Campaign A', status: 'draft' },
    { id: CAMPAIGN_B, org_id: ORG_B, contact_list_id: LIST_B, script_id: SCRIPT_B, name: 'Campaign B', status: 'draft' },
    { id: CAMPAIGN_C, org_id: ORG_C, contact_list_id: LIST_C, script_id: SCRIPT_C, name: 'Campaign C', status: 'draft' },
  ]);
}

interface InsertCallSpec {
  orgId: string;
  campaignId: string;
  contactId: string;
  startedAt: Date | null;
  direction?: 'outbound' | 'inbound';
}

async function insertCalls(tx: TestDbTx, specs: InsertCallSpec[]) {
  await tx.insert(calls).values(
    specs.map((s) => ({
      org_id: s.orgId,
      campaign_id: s.campaignId,
      contact_id: s.contactId,
      provider: 'vapi' as const,
      status: 'completed' as const,
      direction: s.direction ?? 'outbound',
      started_at: s.startedAt,
    })),
  );
}

describe('findRecentOutboundCallsToNumber integration', () => {
  it.skipIf(skipWhenNoDb)('returns calls from every org that dialed the number recently', async () => {
    await withTestDb(async (tx) => {
      await seedThreeOrgsCallingSamePhone(tx);
      await insertCalls(tx, [
        { orgId: ORG_A, campaignId: CAMPAIGN_A, contactId: CONTACT_A, startedAt: new Date(Date.now() - 60 * 1000) },
        { orgId: ORG_B, campaignId: CAMPAIGN_B, contactId: CONTACT_B, startedAt: new Date(Date.now() - 2 * 60 * 1000) },
        { orgId: ORG_C, campaignId: CAMPAIGN_C, contactId: CONTACT_C, startedAt: new Date(Date.now() - 3 * 60 * 1000) },
      ]);

      const results = await findRecentOutboundCallsToNumber(TARGET_PHONE, {
        tx: asProdTx(tx),
      });
      const orgIds = results.map((r) => r.orgId).sort();
      expect(orgIds).toEqual([ORG_A, ORG_B, ORG_C].sort());
    });
  });

  it.skipIf(skipWhenNoDb)('orders results by started_at DESC (most recent first)', async () => {
    await withTestDb(async (tx) => {
      await seedThreeOrgsCallingSamePhone(tx);
      const t1 = new Date(Date.now() - 10 * 60 * 1000); // oldest
      const t2 = new Date(Date.now() - 5 * 60 * 1000);
      const t3 = new Date(Date.now() - 1 * 60 * 1000); // newest
      await insertCalls(tx, [
        { orgId: ORG_A, campaignId: CAMPAIGN_A, contactId: CONTACT_A, startedAt: t1 },
        { orgId: ORG_B, campaignId: CAMPAIGN_B, contactId: CONTACT_B, startedAt: t3 },
        { orgId: ORG_C, campaignId: CAMPAIGN_C, contactId: CONTACT_C, startedAt: t2 },
      ]);

      const results = await findRecentOutboundCallsToNumber(TARGET_PHONE, {
        tx: asProdTx(tx),
      });
      expect(results.map((r) => r.orgId)).toEqual([ORG_B, ORG_C, ORG_A]);
    });
  });

  it.skipIf(skipWhenNoDb)('excludes calls outside the lookback window', async () => {
    await withTestDb(async (tx) => {
      await seedThreeOrgsCallingSamePhone(tx);
      const recent = new Date(Date.now() - 5 * 60 * 1000);
      const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
      await insertCalls(tx, [
        { orgId: ORG_A, campaignId: CAMPAIGN_A, contactId: CONTACT_A, startedAt: recent },
        { orgId: ORG_B, campaignId: CAMPAIGN_B, contactId: CONTACT_B, startedAt: old },
      ]);

      // Default 30-day window: only the recent call survives.
      const results = await findRecentOutboundCallsToNumber(TARGET_PHONE, {
        tx: asProdTx(tx),
      });
      expect(results).toHaveLength(1);
      expect(results[0]?.orgId).toBe(ORG_A);
    });
  });

  it.skipIf(skipWhenNoDb)('respects a custom withinDays window', async () => {
    await withTestDb(async (tx) => {
      await seedThreeOrgsCallingSamePhone(tx);
      const inSevenDayWindow = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      const outsideSevenDayWindow = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      await insertCalls(tx, [
        { orgId: ORG_A, campaignId: CAMPAIGN_A, contactId: CONTACT_A, startedAt: inSevenDayWindow },
        { orgId: ORG_B, campaignId: CAMPAIGN_B, contactId: CONTACT_B, startedAt: outsideSevenDayWindow },
      ]);

      const results = await findRecentOutboundCallsToNumber(TARGET_PHONE, {
        tx: asProdTx(tx),
        withinDays: 7,
      });
      expect(results).toHaveLength(1);
      expect(results[0]?.orgId).toBe(ORG_A);
    });
  });

  it.skipIf(skipWhenNoDb)('excludes inbound calls', async () => {
    await withTestDb(async (tx) => {
      await seedThreeOrgsCallingSamePhone(tx);
      const recent = new Date(Date.now() - 5 * 60 * 1000);
      await insertCalls(tx, [
        { orgId: ORG_A, campaignId: CAMPAIGN_A, contactId: CONTACT_A, startedAt: recent, direction: 'outbound' },
        { orgId: ORG_B, campaignId: CAMPAIGN_B, contactId: CONTACT_B, startedAt: recent, direction: 'inbound' },
      ]);

      const results = await findRecentOutboundCallsToNumber(TARGET_PHONE, {
        tx: asProdTx(tx),
      });
      expect(results).toHaveLength(1);
      expect(results[0]?.orgId).toBe(ORG_A);
    });
  });

  it.skipIf(skipWhenNoDb)('does not return calls to a different phone', async () => {
    await withTestDb(async (tx) => {
      await seedThreeOrgsCallingSamePhone(tx);
      const recent = new Date(Date.now() - 5 * 60 * 1000);
      // ORG_C calls both TARGET_PHONE (CONTACT_C) and OTHER_PHONE (CONTACT_OTHER)
      await insertCalls(tx, [
        { orgId: ORG_C, campaignId: CAMPAIGN_C, contactId: CONTACT_C, startedAt: recent },
        { orgId: ORG_C, campaignId: CAMPAIGN_C, contactId: CONTACT_OTHER, startedAt: recent },
      ]);

      const results = await findRecentOutboundCallsToNumber(TARGET_PHONE, {
        tx: asProdTx(tx),
      });
      expect(results).toHaveLength(1);
      expect(results[0]?.contactId).toBe(CONTACT_C);
    });
  });

  it.skipIf(skipWhenNoDb)('returns the contactId, callId and dialedAt for each row', async () => {
    await withTestDb(async (tx) => {
      await seedThreeOrgsCallingSamePhone(tx);
      const recent = new Date(Date.now() - 5 * 60 * 1000);
      await insertCalls(tx, [
        { orgId: ORG_A, campaignId: CAMPAIGN_A, contactId: CONTACT_A, startedAt: recent },
      ]);

      const results = await findRecentOutboundCallsToNumber(TARGET_PHONE, {
        tx: asProdTx(tx),
      });
      expect(results).toHaveLength(1);
      const r = results[0]!;
      expect(r.orgId).toBe(ORG_A);
      expect(r.contactId).toBe(CONTACT_A);
      expect(typeof r.callId).toBe('string');
      expect(r.dialedAt).toBeInstanceOf(Date);
    });
  });

  it.skipIf(skipWhenNoDb)('returns an empty array when no calls match', async () => {
    await withTestDb(async (tx) => {
      await seedThreeOrgsCallingSamePhone(tx);
      // No calls inserted.
      const results = await findRecentOutboundCallsToNumber(TARGET_PHONE, {
        tx: asProdTx(tx),
      });
      expect(results).toEqual([]);
    });
  });
});

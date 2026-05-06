/**
 * Integration tests for `recordInboundOptout` (plan 10 task 11).
 *
 * Exercises real Postgres semantics that the unit tests cannot:
 *   - the `opt_out_registry` unique constraint on (org_id, phone_e164)
 *   - the cross-org write pattern (one opt_out row per unique calling org)
 *   - the audit trail (one row per org, source 'inbound_ivr')
 *
 * Each test runs inside a `withTestDb` transaction that is always rolled back.
 *
 * Prerequisites:
 *   docker compose -f infra/test/docker-compose.yml up -d
 *   DATABASE_DIRECT_URL=postgresql://postgres:postgres@localhost:5433/vox_auto_test \
 *     pnpm db:migrate
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/vox_auto_test
 */

import { eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

// Force the service's withSystemContext / withOrgContext to share the test
// transaction (so its writes participate in the rollback). The mocks must run
// before importing the SUT.
vi.mock('@/lib/db/context', async () => {
  return {
    withSystemContext: vi.fn(),
    withOrgContext: vi.fn(),
  };
});

import { withOrgContext, withSystemContext } from '@/lib/db/context';
import {
  auditLog,
  calls,
  campaigns,
  contactLists,
  contacts,
  optOutRegistry,
  organizations,
  scriptTemplates,
  scripts,
} from '@/lib/db/schema';
import { withTestDb, type DbTx as TestDbTx } from '@/test/db';

import { recordInboundOptout } from './inbound_calls';

const ORG_A = 'a0000000-0000-0000-0000-000000000001';
const ORG_B = 'a0000000-0000-0000-0000-000000000002';

const TEMPLATE_ID = 'a0000000-0000-0000-0000-000000000020';
const SCRIPT_A = 'a0000000-0000-0000-0000-000000000031';
const SCRIPT_B = 'a0000000-0000-0000-0000-000000000032';
const LIST_A = 'a0000000-0000-0000-0000-000000000041';
const LIST_B = 'a0000000-0000-0000-0000-000000000042';
const CONTACT_A = 'a0000000-0000-0000-0000-000000000051';
const CONTACT_B = 'a0000000-0000-0000-0000-000000000052';
const CAMPAIGN_A = 'a0000000-0000-0000-0000-000000000061';
const CAMPAIGN_B = 'a0000000-0000-0000-0000-000000000062';

const TARGET_PHONE = '+393409998877';

const skipWhenNoDb = !process.env['TEST_DATABASE_URL'];

async function setOrgContext(tx: TestDbTx, orgId: string): Promise<void> {
  await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
}

async function clearOrgContext(tx: TestDbTx): Promise<void> {
  await tx.execute(sql`SELECT set_config('app.current_org_id', '', true)`);
}

async function seedTwoOrgsCallingNumber(tx: TestDbTx) {
  await tx.insert(organizations).values([
    { id: ORG_A, name: 'Org A', country: 'IT', timezone: 'Europe/Rome' },
    { id: ORG_B, name: 'Org B', country: 'IT', timezone: 'Europe/Rome' },
  ]);

  await tx.insert(scriptTemplates).values({
    id: TEMPLATE_ID,
    slug: 'inbound-optout-test',
    name: 'Inbound Opt-out Test',
    version: 1,
    system_prompt: 'system',
    variable_schema: { properties: {} } as unknown as object,
    default_voice_id: 'placeholder',
  });

  await tx.insert(scripts).values([
    { id: SCRIPT_A, org_id: ORG_A, template_id: TEMPLATE_ID, name: 'Script A', variables: {}, voice_id: null },
    { id: SCRIPT_B, org_id: ORG_B, template_id: TEMPLATE_ID, name: 'Script B', variables: {}, voice_id: null },
  ]);

  await tx.insert(contactLists).values([
    { id: LIST_A, org_id: ORG_A, name: 'List A', source: 'api', total_count: 1, valid_count: 1 },
    { id: LIST_B, org_id: ORG_B, name: 'List B', source: 'api', total_count: 1, valid_count: 1 },
  ]);

  await tx.insert(contacts).values([
    { id: CONTACT_A, org_id: ORG_A, contact_list_id: LIST_A, phone_e164: TARGET_PHONE, consent_basis: 'consent' },
    { id: CONTACT_B, org_id: ORG_B, contact_list_id: LIST_B, phone_e164: TARGET_PHONE, consent_basis: 'consent' },
  ]);

  await tx.insert(campaigns).values([
    { id: CAMPAIGN_A, org_id: ORG_A, contact_list_id: LIST_A, script_id: SCRIPT_A, name: 'Campaign A', status: 'draft' },
    { id: CAMPAIGN_B, org_id: ORG_B, contact_list_id: LIST_B, script_id: SCRIPT_B, name: 'Campaign B', status: 'draft' },
  ]);
}

async function insertOutboundCalls(tx: TestDbTx, recent: Date) {
  await tx.insert(calls).values([
    {
      org_id: ORG_A,
      campaign_id: CAMPAIGN_A,
      contact_id: CONTACT_A,
      provider: 'vapi',
      status: 'completed',
      direction: 'outbound',
      started_at: recent,
    },
    {
      org_id: ORG_B,
      campaign_id: CAMPAIGN_B,
      contact_id: CONTACT_B,
      provider: 'vapi',
      status: 'completed',
      direction: 'outbound',
      started_at: recent,
    },
  ]);
}

describe('recordInboundOptout integration', () => {
  it.skipIf(skipWhenNoDb)('writes one opt_out row + audit per unique calling org', async () => {
    await withTestDb(async (tx) => {
      await seedTwoOrgsCallingNumber(tx);
      await insertOutboundCalls(tx, new Date(Date.now() - 60 * 1000));

      // Wire withSystemContext / withOrgContext to the same test tx (no nested
      // transactions in postgres-js). Service-side withOrgContext sets the GUC,
      // so we mirror that here and clear it afterwards.
      vi.mocked(withSystemContext).mockImplementation((fn) => fn(tx as unknown as Parameters<typeof fn>[0]));
      vi.mocked(withOrgContext).mockImplementation(async (orgId, fn) => {
        await setOrgContext(tx, orgId as string);
        try {
          return await fn(tx as unknown as Parameters<typeof fn>[0]);
        } finally {
          await clearOrgContext(tx);
        }
      });

      const result = await recordInboundOptout({
        providerCallId: 'vapi-no-row',
        callerNumber: TARGET_PHONE,
      });
      expect(result.enroledOrgIds.sort()).toEqual([ORG_A, ORG_B].sort());

      // Verify exactly one opt_out_registry row per org (system context to read both)
      await clearOrgContext(tx);
      const optOutRows = await tx
        .select()
        .from(optOutRegistry)
        .where(eq(optOutRegistry.phone_e164, TARGET_PHONE));
      expect(optOutRows.length).toBe(2);
      const sourcesByOrg = new Map(optOutRows.map((r) => [r.org_id, r.source]));
      expect(sourcesByOrg.get(ORG_A)).toBe('inbound_ivr');
      expect(sourcesByOrg.get(ORG_B)).toBe('inbound_ivr');

      // Verify one audit row per org with source 'inbound_ivr'
      const auditRows = await tx
        .select()
        .from(auditLog)
        .where(eq(auditLog.subject_id, TARGET_PHONE));
      const auditByOrg = new Map(auditRows.map((r) => [r.org_id, r]));
      expect(auditByOrg.size).toBe(2);
      for (const row of auditRows) {
        expect(row.action).toBe('opt_out.recorded');
        expect(row.actor_type).toBe('webhook');
        expect((row.metadata as Record<string, unknown>)['source']).toBe('inbound_ivr');
      }
    });
  });

  it.skipIf(skipWhenNoDb)('is idempotent on the unique (org_id, phone_e164) constraint', async () => {
    await withTestDb(async (tx) => {
      await seedTwoOrgsCallingNumber(tx);
      await insertOutboundCalls(tx, new Date(Date.now() - 60 * 1000));

      vi.mocked(withSystemContext).mockImplementation((fn) => fn(tx as unknown as Parameters<typeof fn>[0]));
      vi.mocked(withOrgContext).mockImplementation(async (orgId, fn) => {
        await setOrgContext(tx, orgId as string);
        try {
          return await fn(tx as unknown as Parameters<typeof fn>[0]);
        } finally {
          await clearOrgContext(tx);
        }
      });

      // Double invocation — second call should not raise on the unique constraint.
      await recordInboundOptout({ providerCallId: 'vapi-1', callerNumber: TARGET_PHONE });
      await recordInboundOptout({ providerCallId: 'vapi-2', callerNumber: TARGET_PHONE });

      await clearOrgContext(tx);
      const optOutRows = await tx
        .select()
        .from(optOutRegistry)
        .where(eq(optOutRegistry.phone_e164, TARGET_PHONE));
      expect(optOutRows.length).toBe(2);
    });
  });

  it.skipIf(skipWhenNoDb)('writes nothing when no recent outbound caller exists', async () => {
    await withTestDb(async (tx) => {
      await seedTwoOrgsCallingNumber(tx);
      // No outbound calls inserted.

      vi.mocked(withSystemContext).mockImplementation((fn) => fn(tx as unknown as Parameters<typeof fn>[0]));
      vi.mocked(withOrgContext).mockImplementation(async (orgId, fn) => {
        await setOrgContext(tx, orgId as string);
        try {
          return await fn(tx as unknown as Parameters<typeof fn>[0]);
        } finally {
          await clearOrgContext(tx);
        }
      });

      const result = await recordInboundOptout({
        providerCallId: 'vapi-empty',
        callerNumber: TARGET_PHONE,
      });
      expect(result.enroledOrgIds).toEqual([]);

      await clearOrgContext(tx);
      const optOutRows = await tx
        .select()
        .from(optOutRegistry)
        .where(eq(optOutRegistry.phone_e164, TARGET_PHONE));
      expect(optOutRows.length).toBe(0);
    });
  });
});

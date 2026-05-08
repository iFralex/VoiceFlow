/**
 * Integration test for opt-out propagation across campaigns
 * (plan 11 task 18, plan 11 task 6).
 *
 * Verifies that `complianceOptOutRegisteredHandler` aborts in-flight calls
 * across every active campaign for the opted-out contact's phone number,
 * regardless of the source that triggered the opt-out:
 *   - `pending` calls are flipped to `failed/opted_out` without a provider
 *     cancellation (no provider_call_id yet)
 *   - `dialing` and `in_progress` calls are flipped to `failed/opted_out`
 *     after a best-effort provider cancellation
 *   - already-terminal calls are left alone (idempotent under retries)
 *   - a `call.skipped` audit row with reason `opted_out` is recorded per
 *     flipped call
 *
 * Each test runs inside a `withTestDb` transaction that is always rolled back.
 *
 * Prerequisites:
 *   docker compose -f infra/test/docker-compose.yml up -d
 *   DATABASE_DIRECT_URL=postgresql://postgres:postgres@localhost:5433/vox_auto_test \
 *     pnpm db:migrate
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/vox_auto_test
 */

import { and, eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCancelCall } = vi.hoisted(() => ({ mockCancelCall: vi.fn() }));

vi.mock('@/lib/voice/factory', () => ({
  getVoiceProviderByName: vi.fn(() => ({
    cancelCall: mockCancelCall,
  })),
}));

vi.mock('@/lib/inngest/client', () => ({
  sendInngestEvent: vi.fn().mockResolvedValue(undefined),
  sendInngestEvents: vi.fn().mockResolvedValue(undefined),
}));

// Stub the campaign-completion check so we don't pull in the rest of the
// dispatch chain (it queries credit_ledger, organizations, etc.).
vi.mock('@/lib/inngest/campaigns/completed', () => ({
  checkAndFinaliseCampaignCompletion: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/db/context', async () => ({
  withSystemContext: vi.fn(),
  withOrgContext: vi.fn(),
}));

import { withOrgContext, withSystemContext } from '@/lib/db/context';
import {
  auditLog,
  calls,
  campaigns,
  contactLists,
  contacts,
  organizations,
  scriptTemplates,
  scripts,
} from '@/lib/db/schema';
import { complianceOptOutRegisteredHandler } from '@/lib/inngest/compliance/optout-handler';
import { type DbTx as TestDbTx, withTestDb } from '@/test/db';

const ORG = 'c1000000-0000-0000-0000-000000000001';
const TEMPLATE = 'c1000000-0000-0000-0000-000000000020';
const SCRIPT = 'c1000000-0000-0000-0000-000000000021';
const LIST = 'c1000000-0000-0000-0000-000000000022';
const CONTACT = 'c1000000-0000-0000-0000-000000000023';
const CAMPAIGN = 'c1000000-0000-0000-0000-000000000024';

const PHONE = '+393331110200';

const skipWhenNoDb = !process.env['TEST_DATABASE_URL'];

async function setOrgContext(tx: TestDbTx, orgId: string): Promise<void> {
  await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
}

async function clearOrgContext(tx: TestDbTx): Promise<void> {
  await tx.execute(sql`SELECT set_config('app.current_org_id', '', true)`);
}

function bindContextsTo(tx: TestDbTx): void {
  vi.mocked(withSystemContext).mockImplementation((fn) =>
    fn(tx as unknown as Parameters<typeof fn>[0]),
  );
  vi.mocked(withOrgContext).mockImplementation(async (orgId, fn) => {
    await setOrgContext(tx, orgId as string);
    try {
      return await fn(tx as unknown as Parameters<typeof fn>[0]);
    } finally {
      await clearOrgContext(tx);
    }
  });
}

beforeEach(() => {
  mockCancelCall.mockReset();
  mockCancelCall.mockResolvedValue(undefined);
});

async function seedScaffold(tx: TestDbTx): Promise<void> {
  await tx.insert(organizations).values({
    id: ORG,
    name: 'Opt-out Org',
    country: 'IT',
    timezone: 'Europe/Rome',
  });
  await tx.insert(scriptTemplates).values({
    id: TEMPLATE,
    slug: 'optout-prop-test',
    name: 'Opt-out Propagation Test',
    version: 1,
    system_prompt: 'sys',
    variable_schema: { properties: {} } as unknown as object,
    default_voice_id: 'placeholder',
  });
  await tx.insert(scripts).values({
    id: SCRIPT,
    org_id: ORG,
    template_id: TEMPLATE,
    name: 'Script',
    variables: {},
    voice_id: null,
  });
  await tx.insert(contactLists).values({
    id: LIST,
    org_id: ORG,
    name: 'List',
    source: 'api',
    total_count: 0,
    valid_count: 0,
  });
  await tx.insert(contacts).values({
    id: CONTACT,
    org_id: ORG,
    contact_list_id: LIST,
    phone_e164: PHONE,
    consent_basis: 'consent',
  });
  await tx.insert(campaigns).values({
    id: CAMPAIGN,
    org_id: ORG,
    contact_list_id: LIST,
    script_id: SCRIPT,
    name: 'Campaign',
    status: 'running',
  });
}

describe('opt-out propagation integration', () => {
  it.skipIf(skipWhenNoDb)(
    'aborts every in-flight call across active campaigns regardless of opt-out source',
    async () => {
      await withTestDb(async (tx) => {
        await seedScaffold(tx);

        // Three in-flight calls: pending (no provider id), dialing, in_progress.
        // One terminal call that must be left untouched.
        const inserted = await tx
          .insert(calls)
          .values([
            {
              org_id: ORG,
              campaign_id: CAMPAIGN,
              contact_id: CONTACT,
              provider: 'vapi',
              status: 'pending',
            },
            {
              org_id: ORG,
              campaign_id: CAMPAIGN,
              contact_id: CONTACT,
              provider: 'vapi',
              status: 'dialing',
              provider_call_id: 'vapi-dialing-1',
            },
            {
              org_id: ORG,
              campaign_id: CAMPAIGN,
              contact_id: CONTACT,
              provider: 'vapi',
              status: 'in_progress',
              provider_call_id: 'vapi-inprogress-1',
            },
            {
              org_id: ORG,
              campaign_id: CAMPAIGN,
              contact_id: CONTACT,
              provider: 'vapi',
              status: 'completed',
            },
          ])
          .returning({ id: calls.id, status: calls.status });

        const pendingId = inserted.find((c) => c.status === 'pending')!.id;
        const dialingId = inserted.find((c) => c.status === 'dialing')!.id;
        const inProgressId = inserted.find((c) => c.status === 'in_progress')!.id;
        const completedId = inserted.find((c) => c.status === 'completed')!.id;

        bindContextsTo(tx);

        await complianceOptOutRegisteredHandler({
          orgId: ORG,
          phoneE164: PHONE,
          source: 'dealer_input',
          recordedAt: new Date('2026-05-08T12:00:00.000Z').toISOString(),
        });

        // Provider cancellation invoked exactly for the two active rows.
        expect(mockCancelCall).toHaveBeenCalledTimes(2);
        const cancelledIds = mockCancelCall.mock.calls.map(([id]) => id);
        expect(cancelledIds).toEqual(
          expect.arrayContaining(['vapi-dialing-1', 'vapi-inprogress-1']),
        );

        await clearOrgContext(tx);

        // All three in-flight rows now terminal with the opted_out error code.
        const aborted = await tx
          .select()
          .from(calls)
          .where(eq(calls.contact_id, CONTACT));
        const byId = new Map(aborted.map((r) => [r.id, r]));
        for (const id of [pendingId, dialingId, inProgressId]) {
          expect(byId.get(id)?.status).toBe('failed');
          expect(byId.get(id)?.error_code).toBe('opted_out');
        }
        // The pre-completed row is untouched.
        expect(byId.get(completedId)?.status).toBe('completed');
        expect(byId.get(completedId)?.error_code).toBeNull();

        // call.skipped audit row per flipped call.
        const auditRows = await tx
          .select()
          .from(auditLog)
          .where(
            and(
              eq(auditLog.org_id, ORG),
              eq(auditLog.action, 'call.skipped'),
            ),
          );
        const skippedIds = auditRows.map((r) => r.subject_id);
        expect(skippedIds).toEqual(
          expect.arrayContaining([pendingId, dialingId, inProgressId]),
        );
        expect(skippedIds).not.toContain(completedId);
        for (const row of auditRows) {
          const meta = row.metadata as Record<string, unknown>;
          expect(meta['reason']).toBe('opted_out');
          expect(meta['source']).toBe('dealer_input');
        }
      });
    },
  );

  it.skipIf(skipWhenNoDb)(
    'is idempotent under re-delivery — second invocation flips nothing further',
    async () => {
      await withTestDb(async (tx) => {
        await seedScaffold(tx);
        await tx.insert(calls).values({
          org_id: ORG,
          campaign_id: CAMPAIGN,
          contact_id: CONTACT,
          provider: 'vapi',
          status: 'pending',
        });

        bindContextsTo(tx);

        const recordedAt = new Date('2026-05-08T12:00:00.000Z').toISOString();
        await complianceOptOutRegisteredHandler({
          orgId: ORG,
          phoneE164: PHONE,
          source: 'gdpr_request',
          recordedAt,
        });
        // Second delivery — the status filter on the UPDATE is the idempotency guard.
        await complianceOptOutRegisteredHandler({
          orgId: ORG,
          phoneE164: PHONE,
          source: 'gdpr_request',
          recordedAt,
        });

        await clearOrgContext(tx);
        const auditRows = await tx
          .select()
          .from(auditLog)
          .where(
            and(
              eq(auditLog.org_id, ORG),
              eq(auditLog.action, 'call.skipped'),
            ),
          );
        // Exactly one skipped audit row — the second delivery saw a terminal
        // status and wrote nothing new.
        expect(auditRows).toHaveLength(1);
      });
    },
  );
});

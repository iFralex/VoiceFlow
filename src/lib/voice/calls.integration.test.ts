/**
 * Integration tests for the voice call service layer.
 *
 * Group A — service-logic tests with mocked DB context
 *   No real database required. `withOrgContext` and `withSystemContext` are
 *   replaced by mocks that call the callback with a fake transaction, allowing
 *   us to verify business logic (payload assembly, classifier gating) without
 *   infrastructure.
 *
 *   Note: msw is not installed in this project; fetch-level mocks use
 *   vi.stubGlobal / vi.fn(), consistent with the rest of the test suite.
 *
 * Group B — database integration tests (require TEST_DATABASE_URL)
 *   These tests use `withTestDb` (a rolled-back Postgres transaction) to
 *   exercise real Postgres semantics: the NULL-guard UPDATE pattern for tool
 *   outcome idempotency, and the FORCE ROW LEVEL SECURITY mechanism that
 *   enforces cross-org call isolation.
 *
 * Prerequisites for Group B:
 *   docker compose -f infra/test/docker-compose.yml up -d
 *   DATABASE_DIRECT_URL=postgresql://postgres:postgres@localhost:5433/vox_auto_test \
 *     pnpm db:migrate
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/vox_auto_test
 */

// ── Mocks (hoisted before any imports) ───────────────────────────────────────

vi.mock('@/lib/db/context', () => ({
  withOrgContext: vi.fn(),
  withSystemContext: vi.fn(),
}));

vi.mock('@/lib/inngest/client', () => ({
  sendInngestEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/voice/factory', () => ({
  getVoiceProvider: vi.fn(),
}));

vi.mock('@/lib/services/billing-rules', () => ({
  computePerMinuteCents: vi.fn().mockResolvedValue(50),
  computeCallCost: vi.fn().mockReturnValue({ billableSeconds: 60, costCents: 50 }),
}));

vi.mock('@/lib/services/credit', () => ({
  chargeForCall: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/services/system_flags', () => ({
  isSbcUnhealthy: vi.fn().mockResolvedValue(false),
  recordSbcDispatchFailure: vi.fn().mockResolvedValue(undefined),
  recordSbcDispatchSuccess: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/voice/cli/picker', () => ({
  pickCliForOrg: vi.fn().mockResolvedValue({
    phoneNumberId: 'phone-row-id',
    phoneE164: '+390211111111',
    providerExternalId: 'vapi-phone-id-xyz',
    provider: 'voiped' as const,
  }),
  NoAvailableCliError: class NoAvailableCliError extends Error {
    constructor(public readonly orgId: string) {
      super(`No CLI available for org ${orgId}`);
      this.name = 'NoAvailableCliError';
    }
  },
}));

// ── Imports ──────────────────────────────────────────────────────────────────

import { and, eq, isNull, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withOrgContext, withSystemContext } from '@/lib/db/context';
import {
  calls,
  campaigns,
  contactLists,
  contacts,
  organizations,
  scriptTemplates,
  scripts,
} from '@/lib/db/schema';
import { sendInngestEvent } from '@/lib/inngest/client';
import {
  CALL_CLASSIFY_EVENT,
  classifyAndFinaliseCall,
  dispatchCall,
} from '@/lib/services/calls';
import { getVoiceProvider } from '@/lib/voice/factory';
import { AI_ACT_PREAMBLE_IT } from '@/lib/voice/prompt/preamble';
import type { VoiceProvider } from '@/lib/voice/types';
import { withTestDb } from '@/test/db';

// ── Constants ─────────────────────────────────────────────────────────────────
// Using 7x UUIDs to avoid collisions with other integration test files
// (contacts uses 4x/5x, multitenancy uses 2x/3x).

const ORG_A = '70000000-0000-0000-0000-000000000001';
const ORG_B = '70000000-0000-0000-0000-000000000002';

const CAMPAIGN_ID = '70000000-0000-0000-0000-000000000010';
const SCRIPT_ID = '70000000-0000-0000-0000-000000000011';
const TEMPLATE_ID = '70000000-0000-0000-0000-000000000012';
const CONTACT_ID = '70000000-0000-0000-0000-000000000013';
const CALL_ID = '70000000-0000-0000-0000-000000000014';
const LIST_ID = '70000000-0000-0000-0000-000000000015';

const skipWhenNoDb = !process.env['TEST_DATABASE_URL'];

// ── Mock transaction builder ──────────────────────────────────────────────────

/**
 * Returns a minimal Drizzle-like transaction mock whose `.select()` method
 * serves results from `selectQueue` in order (FIFO). All writes (update,
 * insert) are no-ops that resolve successfully.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildMockTx(selectQueue: unknown[][]): any {
  let idx = 0;

  return {
    select: vi.fn(() => {
      const result = selectQueue[idx++] ?? [];
      // Build a chainable object that resolves limit() with the queued result
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {};
      chain.from = vi.fn(() => chain);
      chain.where = vi.fn(() => chain);
      chain.limit = vi.fn(() => Promise.resolve(result));
      return chain;
    }),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([])),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => Promise.resolve([{ id: 'mock-audit-id' }])),
    })),
    execute: vi.fn(() => Promise.resolve([])),
  };
}

// ── Group A: dispatchCall — payload assembly ──────────────────────────────────

describe('dispatchCall — payload assembly', () => {
  let createCallSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv('SKIP_ENV_VALIDATION', 'true');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com');
    vi.stubEnv('VAPI_ASSISTANT_ID', 'asst-default');
    vi.stubEnv('VAPI_WEBHOOK_SECRET', 'test-secret');
    vi.stubEnv('VOICE_PROVIDER', 'vapi');
    vi.stubEnv('INNGEST_EVENT_KEY', 'test-key');

    createCallSpy = vi.fn().mockResolvedValue({ providerCallId: 'prov-call-xyz' });

    vi.mocked(getVoiceProvider).mockReturnValue({
      name: 'vapi' as const,
      createCall: createCallSpy,
      cancelCall: vi.fn(),
      fetchRecording: vi.fn(),
      fetchTranscript: vi.fn(),
    } as unknown as VoiceProvider);

    // Fixture data returned by successive DB selects inside dispatchCall:
    //   1. call record
    //   2. campaign
    //   3. script
    //   4. script_template  (loaded via withSystemContext)
    //   5. contact
    // CLI selection is delegated to the mocked pickCliForOrg above.

    const callRow = {
      id: CALL_ID,
      org_id: ORG_A,
      campaign_id: CAMPAIGN_ID,
      contact_id: CONTACT_ID,
      provider: 'vapi',
      status: 'pending',
      metadata: null,
    };
    const campaignRow = {
      id: CAMPAIGN_ID,
      org_id: ORG_A,
      script_id: SCRIPT_ID,
      contact_list_id: LIST_ID,
    };
    const scriptRow = {
      id: SCRIPT_ID,
      org_id: ORG_A,
      template_id: TEMPLATE_ID,
      name: 'Test Script',
      // Variables required by the lead-reactivation prompt files on disk
      variables: {
        dealership_name: 'AutoRoma',
        brand: 'Volkswagen',
        salesperson_first_name: 'Marco',
        available_slots: ['15/06 10:00'],
        lead_origin_context: 'Interesse Golf GTI online',
      },
      voice_id: null,
    };
    const templateRow = {
      id: TEMPLATE_ID,
      // Must match a real slug so readFirstMessageTemplate can find the file
      slug: 'lead-reactivation',
      name: 'Riattivazione Lead',
      version: 1,
      // A minimal prompt body; assembleSystemPrompt prepends the AI Act preamble
      system_prompt:
        '{{salesperson_first_name}} chiama per {{dealership_name}} ({{brand}}).' +
        ' Slot: {{available_slots}}. Contesto: {{lead_origin_context}}.',
      variable_schema: {
        properties: {
          dealership_name: { type: 'string' },
          brand: { type: 'string' },
          salesperson_first_name: { type: 'string' },
          available_slots: { type: 'array' },
          lead_origin_context: { type: 'string' },
        },
      },
      default_voice_id: 'eleven-default-voice',
    };
    const contactRow = {
      id: CONTACT_ID,
      org_id: ORG_A,
      phone_e164: '+393331234567',
    };

    const mockTx = buildMockTx([
      [callRow],
      [campaignRow],
      [scriptRow],
      [templateRow],
      [contactRow],
    ]);

    // Both context helpers call their callback with the shared mockTx.
    // The select queue is consumed in the order dispatchCall issues queries.
    vi.mocked(withOrgContext).mockImplementation((_orgId, fn) => fn(mockTx));
    vi.mocked(withSystemContext).mockImplementation((fn) => fn(mockTx));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('system prompt begins with the AI Act transparency preamble', async () => {
    await dispatchCall(ORG_A, CALL_ID);

    expect(createCallSpy).toHaveBeenCalledOnce();
    const { systemPrompt } = createCallSpy.mock.calls[0]![0] as { systemPrompt: string };
    // The assembled prompt must start with the AI Act preamble (first 200 chars)
    const preamblePrefix = AI_ACT_PREAMBLE_IT.slice(0, 200);
    expect(systemPrompt.slice(0, 200)).toBe(preamblePrefix);
  });

  it('first message contains the AI Act disclosure phrase', async () => {
    await dispatchCall(ORG_A, CALL_ID);

    expect(createCallSpy).toHaveBeenCalledOnce();
    const { firstMessage } = createCallSpy.mock.calls[0]![0] as { firstMessage: string };
    expect(firstMessage.toLowerCase()).toContain('assistente vocale automatico');
  });

  it('persists from_number and cli_provider on the call row (plan 10 task 14)', async () => {
    // Re-build a mockTx that captures `update().set()` payloads so we can
    // verify the dispatch transition writes both the chosen CLI's E.164 and
    // its carrier alongside the existing provider_call_id/status fields.
    const updateCalls: Array<Record<string, unknown>> = [];
    const callRow = {
      id: CALL_ID,
      org_id: ORG_A,
      campaign_id: CAMPAIGN_ID,
      contact_id: CONTACT_ID,
      provider: 'vapi',
      status: 'pending',
      metadata: null,
    };
    const campaignRow = {
      id: CAMPAIGN_ID,
      org_id: ORG_A,
      script_id: SCRIPT_ID,
      contact_list_id: LIST_ID,
    };
    const scriptRow = {
      id: SCRIPT_ID,
      org_id: ORG_A,
      template_id: TEMPLATE_ID,
      name: 'Test Script',
      variables: {
        dealership_name: 'AutoRoma',
        brand: 'Volkswagen',
        salesperson_first_name: 'Marco',
        available_slots: ['15/06 10:00'],
        lead_origin_context: 'Interesse Golf GTI online',
      },
      voice_id: null,
    };
    const templateRow = {
      id: TEMPLATE_ID,
      slug: 'lead-reactivation',
      name: 'Riattivazione Lead',
      version: 1,
      system_prompt: 'body',
      variable_schema: { properties: {} },
      default_voice_id: 'eleven-default-voice',
    };
    const contactRow = {
      id: CONTACT_ID,
      org_id: ORG_A,
      phone_e164: '+393331234567',
    };

    const selectQueue: unknown[][] = [
      [callRow],
      [campaignRow],
      [scriptRow],
      [templateRow],
      [contactRow],
    ];
    let selectIdx = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const captureMockTx: any = {
      select: vi.fn(() => {
        const result = selectQueue[selectIdx++] ?? [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chain: any = {};
        chain.from = vi.fn(() => chain);
        chain.where = vi.fn(() => chain);
        chain.limit = vi.fn(() => Promise.resolve(result));
        return chain;
      }),
      update: vi.fn(() => ({
        set: vi.fn((payload: Record<string, unknown>) => {
          updateCalls.push(payload);
          return { where: vi.fn(() => Promise.resolve([])) };
        }),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => Promise.resolve([{ id: 'mock-audit-id' }])),
      })),
      execute: vi.fn(() => Promise.resolve([])),
    };

    vi.mocked(withOrgContext).mockImplementation((_orgId, fn) => fn(captureMockTx));
    vi.mocked(withSystemContext).mockImplementation((fn) => fn(captureMockTx));

    await dispatchCall(ORG_A, CALL_ID);

    const dialingPayload = updateCalls.find((p) => p['status'] === 'dialing');
    expect(dialingPayload).toBeDefined();
    expect(dialingPayload!['from_number']).toBe('+390211111111');
    expect(dialingPayload!['cli_provider']).toBe('voiped');
  });
});

// ── Group B: classifyAndFinaliseCall — classifier gating ─────────────────────

describe('classifyAndFinaliseCall — classifier gating', () => {
  beforeEach(() => {
    vi.stubEnv('SKIP_ENV_VALIDATION', 'true');
    vi.stubEnv('INNGEST_EVENT_KEY', 'test-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('emits call/classify Inngest event when no tool-driven outcome is set', async () => {
    const mockTx = buildMockTx([[{ org_id: ORG_A, outcome: null }]]);
    vi.mocked(withSystemContext).mockImplementationOnce((fn) => fn(mockTx));

    await classifyAndFinaliseCall(CALL_ID);

    const sendMock = vi.mocked(sendInngestEvent);
    expect(sendMock).toHaveBeenCalledOnce();
    expect(sendMock.mock.calls[0]![0].name).toBe(CALL_CLASSIFY_EVENT);
    expect(sendMock.mock.calls[0]![0].data).toMatchObject({ callId: CALL_ID });
  });

  it('does NOT emit call/classify when a tool-driven outcome already exists', async () => {
    const mockTx = buildMockTx([[{ org_id: ORG_A, outcome: 'appointment_booked' }]]);
    vi.mocked(withSystemContext).mockImplementationOnce((fn) => fn(mockTx));

    await classifyAndFinaliseCall(CALL_ID);

    expect(vi.mocked(sendInngestEvent)).not.toHaveBeenCalled();
  });

  it('does NOT emit call/classify when the call record is not found', async () => {
    const mockTx = buildMockTx([[/* empty — call not found */]]);
    vi.mocked(withSystemContext).mockImplementationOnce((fn) => fn(mockTx));

    await classifyAndFinaliseCall('nonexistent-call-id');

    expect(vi.mocked(sendInngestEvent)).not.toHaveBeenCalled();
  });
});

// ── Group C (DB): tool outcome NULL-guard idempotency ─────────────────────────

describe('calls table — tool outcome NULL-guard idempotency', () => {
  /**
   * The tool handlers in `src/lib/voice/tools/handlers.ts` guard all outcome
   * writes with `WHERE outcome IS NULL` to ensure the first tool invocation
   * wins and subsequent identical invocations are no-ops. This test verifies
   * that guarantee holds at the Postgres level.
   */
  it.skipIf(skipWhenNoDb)(
    'UPDATE with WHERE outcome IS NULL has no effect when outcome is already set',
    async () => {
      await withTestDb(async (tx) => {
        // Seed the dependency chain required by the FK constraints on `calls`
        await tx.insert(organizations).values({
          id: ORG_A,
          name: 'Voice Test Org',
          country: 'IT',
          timezone: 'Europe/Rome',
        });

        // script_templates is system-owned (no org_id)
        await tx.insert(scriptTemplates).values({
          id: TEMPLATE_ID,
          slug: 'lead-reactivation',
          name: 'Test Template',
          version: 99, // version 99 avoids collision with seeded data
          system_prompt: 'Test prompt body.',
          default_voice_id: null,
        });

        await tx.insert(scripts).values({
          id: SCRIPT_ID,
          org_id: ORG_A,
          template_id: TEMPLATE_ID,
          name: 'Test Script',
        });

        await tx.insert(contactLists).values({
          id: LIST_ID,
          org_id: ORG_A,
          name: 'Test List',
          source: 'csv-upload',
          total_count: 1,
          valid_count: 1,
        });

        await tx.insert(contacts).values({
          id: CONTACT_ID,
          org_id: ORG_A,
          contact_list_id: LIST_ID,
          phone_e164: '+393339900001',
          consent_basis: 'existing_customer',
        });

        await tx.insert(campaigns).values({
          id: CAMPAIGN_ID,
          org_id: ORG_A,
          script_id: SCRIPT_ID,
          contact_list_id: LIST_ID,
          name: 'Test Campaign',
        });

        // Insert a call that already has a tool-driven outcome set
        await tx.insert(calls).values({
          id: CALL_ID,
          org_id: ORG_A,
          campaign_id: CAMPAIGN_ID,
          contact_id: CONTACT_ID,
          provider: 'vapi',
          status: 'completed',
          outcome: 'appointment_booked',
        });

        // Simulate a second invocation of mark_not_interested tool handler.
        // The WHERE outcome IS NULL guard means this UPDATE must be a no-op.
        await tx
          .update(calls)
          .set({ outcome: 'not_interested' })
          .where(and(eq(calls.id, CALL_ID), isNull(calls.outcome)));

        const [row] = await tx
          .select({ outcome: calls.outcome })
          .from(calls)
          .where(eq(calls.id, CALL_ID))
          .limit(1);

        // Outcome must be unchanged — the NULL guard prevented the update
        expect(row?.outcome).toBe('appointment_booked');
      });
    },
  );
});

// ── Group D (DB): cross-org RLS on calls ──────────────────────────────────────

describe('calls table — cross-org RLS isolation', () => {
  /**
   * The `calls_org_isolation` RLS policy uses:
   *   USING (app.current_org_id <> '' AND org_id = app.current_org_id::uuid)
   *
   * With FORCE ROW LEVEL SECURITY, even the postgres superuser (used by the
   * test DB) is subject to this policy. A client bound to Org B must not be
   * able to read Org A's calls.
   */
  it.skipIf(skipWhenNoDb)(
    'Org-B-bound client cannot SELECT Org-A calls (GUC + FORCE RLS)',
    async () => {
      await withTestDb(async (tx) => {
        // Seed two orgs
        await tx.insert(organizations).values([
          { id: ORG_A, name: 'Alpha Org', country: 'IT', timezone: 'Europe/Rome' },
          { id: ORG_B, name: 'Beta Org', country: 'IT', timezone: 'Europe/Rome' },
        ]);

        // Seed the full FK chain for ORG_A so we can insert a call
        await tx.insert(scriptTemplates).values({
          id: TEMPLATE_ID,
          slug: 'lead-reactivation',
          name: 'RLS Test Template',
          version: 98, // unique version to avoid seed-data collision
          system_prompt: 'RLS test prompt.',
          default_voice_id: null,
        });

        await tx.insert(scripts).values({
          id: SCRIPT_ID,
          org_id: ORG_A,
          template_id: TEMPLATE_ID,
          name: 'RLS Test Script',
        });

        await tx.insert(contactLists).values({
          id: LIST_ID,
          org_id: ORG_A,
          name: 'RLS Test List',
          source: 'csv-upload',
          total_count: 1,
          valid_count: 1,
        });

        await tx.insert(contacts).values({
          id: CONTACT_ID,
          org_id: ORG_A,
          contact_list_id: LIST_ID,
          phone_e164: '+393339900002',
          consent_basis: 'existing_customer',
        });

        await tx.insert(campaigns).values({
          id: CAMPAIGN_ID,
          org_id: ORG_A,
          script_id: SCRIPT_ID,
          contact_list_id: LIST_ID,
          name: 'RLS Test Campaign',
        });

        // Insert a call for ORG_A (superuser bypass — FORCE RLS not active yet)
        await tx.insert(calls).values({
          id: CALL_ID,
          org_id: ORG_A,
          campaign_id: CAMPAIGN_ID,
          contact_id: CONTACT_ID,
          provider: 'vapi',
          status: 'completed',
        });

        // Enable FORCE RLS so the postgres superuser is also subject to the policy.
        // This DDL is transactional and will be rolled back with the test tx.
        await tx.execute(sql`ALTER TABLE calls FORCE ROW LEVEL SECURITY`);

        // Simulate a request bound to Org B (mirrors what withOrgContext does)
        await tx.execute(sql`SELECT set_config('app.current_org_id', ${ORG_B}, true)`);

        // An unrestricted SELECT should return 0 rows for the Org-B context
        const visible = await tx.select().from(calls);

        expect(visible.filter((c) => c.org_id === ORG_A)).toHaveLength(0);
      });
    },
  );

  it.skipIf(skipWhenNoDb)(
    'Org-A-bound client CAN SELECT its own calls (positive case)',
    async () => {
      await withTestDb(async (tx) => {
        // Seed the same fixtures but bind to ORG_A
        await tx.insert(organizations).values([
          { id: ORG_A, name: 'Alpha Org', country: 'IT', timezone: 'Europe/Rome' },
          { id: ORG_B, name: 'Beta Org', country: 'IT', timezone: 'Europe/Rome' },
        ]);

        await tx.insert(scriptTemplates).values({
          id: TEMPLATE_ID,
          slug: 'lead-reactivation',
          name: 'RLS Positive Template',
          version: 97,
          system_prompt: 'RLS positive test prompt.',
          default_voice_id: null,
        });

        await tx.insert(scripts).values({
          id: SCRIPT_ID,
          org_id: ORG_A,
          template_id: TEMPLATE_ID,
          name: 'RLS Positive Script',
        });

        await tx.insert(contactLists).values({
          id: LIST_ID,
          org_id: ORG_A,
          name: 'RLS Positive List',
          source: 'csv-upload',
          total_count: 1,
          valid_count: 1,
        });

        await tx.insert(contacts).values({
          id: CONTACT_ID,
          org_id: ORG_A,
          contact_list_id: LIST_ID,
          phone_e164: '+393339900003',
          consent_basis: 'existing_customer',
        });

        await tx.insert(campaigns).values({
          id: CAMPAIGN_ID,
          org_id: ORG_A,
          script_id: SCRIPT_ID,
          contact_list_id: LIST_ID,
          name: 'RLS Positive Campaign',
        });

        await tx.insert(calls).values({
          id: CALL_ID,
          org_id: ORG_A,
          campaign_id: CAMPAIGN_ID,
          contact_id: CONTACT_ID,
          provider: 'vapi',
          status: 'completed',
        });

        await tx.execute(sql`ALTER TABLE calls FORCE ROW LEVEL SECURITY`);

        // Bind to ORG_A — should see its own call
        await tx.execute(sql`SELECT set_config('app.current_org_id', ${ORG_A}, true)`);

        const visible = await tx.select().from(calls);

        expect(visible.some((c) => c.id === CALL_ID && c.org_id === ORG_A)).toBe(true);
      });
    },
  );
});

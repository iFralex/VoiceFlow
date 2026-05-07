import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockWithSystemContext } = vi.hoisted(() => {
  const mockWithSystemContext = vi.fn();
  return { mockWithSystemContext };
});

vi.mock('@/lib/db/context', () => ({
  withSystemContext: mockWithSystemContext,
}));

vi.mock('@/lib/db/schema', () => ({
  calls: {
    id: 'c_id',
    org_id: 'c_org_id',
    direction: 'c_direction',
    campaign_id: 'c_campaign_id',
    metadata: 'c_metadata',
    created_at: 'c_created_at',
  },
  campaigns: { id: 'g_id', script_id: 'g_script_id' },
  scripts: { id: 's_id', template_id: 's_template_id', variables: 's_variables' },
  scriptTemplates: {
    id: 't_id',
    slug: 't_slug',
    system_prompt: 't_system_prompt',
    variable_schema: 't_variable_schema',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ type: 'eq', col, val }),
  and: (...args: unknown[]) => ({ type: 'and', args: args.filter((a) => a !== undefined) }),
  gte: (col: unknown, val: unknown) => ({ type: 'gte', col, val }),
  lte: (col: unknown, val: unknown) => ({ type: 'lte', col, val }),
  sql: Object.assign(
    (strings: TemplateStringsArray) => ({ type: 'sql', text: strings.join('') }),
    { raw: (s: string) => s },
  ),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { AI_ACT_PREAMBLE_IT } from '@/lib/voice/prompt/preamble';

import { runAiActConformanceAudit } from './audit';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';

interface SampleRow {
  callId: string;
  orgId: string;
  scriptId: string;
  scriptVariables: unknown;
  templateSlug: string;
  templateBody: string;
  templateSchema: unknown;
  callMetadata: unknown;
}

function buildTx(rows: SampleRow[]): unknown {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(function chain(): unknown {
          return {
            innerJoin: vi.fn(function chain2(): unknown {
              return {
                innerJoin: vi.fn(function chain3(): unknown {
                  return {
                    where: vi.fn(() => ({
                      orderBy: vi.fn(() => ({
                        limit: vi.fn().mockResolvedValue(rows),
                      })),
                    })),
                  };
                }),
              };
            }),
          };
        }),
      })),
    })),
  };
}

function queueRows(rows: SampleRow[]): void {
  mockWithSystemContext.mockImplementationOnce(
    async (fn: (tx: unknown) => Promise<unknown>) => fn(buildTx(rows)),
  );
}

const CAR_RENEWAL_VARS = {
  salesperson_first_name: 'Marco',
  salesperson_full_name: 'Marco Rossi',
  dealership_name: 'AutoBella',
  current_vehicle_model: 'Fiat 500',
  current_vehicle_purchase_year: '2020',
  preferred_callback_window: 'mattina',
  available_models: ['Fiat Panda', 'Fiat 500X'],
  appointment_lead_days: '5',
};

const VALID_TEMPLATE_BODY = 'Sei {{salesperson_first_name}} di {{dealership_name}}. Parli del modello {{current_vehicle_model}}.';

const VALID_VARIABLE_SCHEMA = {
  properties: {
    salesperson_first_name: {},
    salesperson_full_name: {},
    dealership_name: {},
    current_vehicle_model: {},
    current_vehicle_purchase_year: {},
    preferred_callback_window: {},
    available_models: {},
    appointment_lead_days: {},
  },
};

function makeRow(overrides: Partial<SampleRow> = {}): SampleRow {
  return {
    callId: 'cccccccc-cccc-4ccc-8ccc-000000000001',
    orgId: ORG_ID,
    scriptId: 'ssssssss-ssss-4sss-8sss-000000000001',
    scriptVariables: CAR_RENEWAL_VARS,
    templateSlug: 'car-renewal',
    templateBody: VALID_TEMPLATE_BODY,
    templateSchema: VALID_VARIABLE_SCHEMA,
    callMetadata: { disclosure_verified: true },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runAiActConformanceAudit', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('returns zeros and an empty samples array when no calls match', async () => {
    queueRows([]);

    const result = await runAiActConformanceAudit({
      windowStart: new Date('2026-04-01T00:00:00Z'),
      windowEnd: new Date('2026-05-01T00:00:00Z'),
    });

    expect(result.totalSampled).toBe(0);
    expect(result.layer1Passed).toBe(0);
    expect(result.layer2Passed).toBe(0);
    expect(result.layer3Passed).toBe(0);
    expect(result.layer3NotApplicable).toBe(0);
    expect(result.samples).toEqual([]);
    expect(result.windowStart).toBe('2026-04-01T00:00:00.000Z');
    expect(result.windowEnd).toBe('2026-05-01T00:00:00.000Z');
  });

  it('passes all three layers for a healthy call', async () => {
    queueRows([makeRow()]);

    const result = await runAiActConformanceAudit({
      windowStart: new Date('2026-04-01T00:00:00Z'),
      windowEnd: new Date('2026-05-01T00:00:00Z'),
    });

    expect(result.totalSampled).toBe(1);
    expect(result.layer1Passed).toBe(1);
    expect(result.layer2Passed).toBe(1);
    expect(result.layer3Passed).toBe(1);
    expect(result.layer3NotApplicable).toBe(0);

    const sample = result.samples[0]!;
    expect(sample.layer1Passed).toBe(true);
    expect(sample.layer2Passed).toBe(true);
    expect(sample.layer3Passed).toBe(true);
    expect(sample.failureReasons).toEqual([]);
    expect(sample.templateSlug).toBe('car-renewal');
  });

  it('reports layer3 as not-applicable when disclosure_verified flag is missing', async () => {
    queueRows([makeRow({ callMetadata: null })]);

    const result = await runAiActConformanceAudit({
      windowStart: new Date('2026-04-01T00:00:00Z'),
      windowEnd: new Date('2026-05-01T00:00:00Z'),
    });

    expect(result.layer3Passed).toBe(0);
    expect(result.layer3NotApplicable).toBe(1);
    const sample = result.samples[0]!;
    expect(sample.layer3Passed).toBeNull();
    // Not-applicable does NOT push a failure reason: the call has not been
    // classified yet, so its layer-3 status is unknown rather than failed.
    expect(
      sample.failureReasons.some((r) => r.startsWith('layer3')),
    ).toBe(false);
  });

  it('reports layer3 as failed when disclosure_verified=false', async () => {
    queueRows([makeRow({ callMetadata: { disclosure_verified: false } })]);

    const result = await runAiActConformanceAudit({
      windowStart: new Date('2026-04-01T00:00:00Z'),
      windowEnd: new Date('2026-05-01T00:00:00Z'),
    });

    expect(result.layer3Passed).toBe(0);
    expect(result.layer3NotApplicable).toBe(0);
    const sample = result.samples[0]!;
    expect(sample.layer3Passed).toBe(false);
    expect(
      sample.failureReasons.some((r) => r.startsWith('layer3')),
    ).toBe(true);
  });

  it('fails layer1 when the canonical preamble would be missing', async () => {
    // Sanity check: assembleSystemPrompt always prepends the preamble, so the
    // only way layer1 fails in practice is if AI_ACT_PREAMBLE_IT itself were
    // edited/truncated. Simulate corruption by spying on the helper that
    // strips the preamble — instead, simulate a thrown interpolate by
    // providing a template that references an unknown variable, which makes
    // assembleSystemPrompt throw and layer1 fail.
    queueRows([
      makeRow({
        templateBody: 'Sei {{unknown_variable}}.',
        templateSchema: { properties: {} },
      }),
    ]);

    const result = await runAiActConformanceAudit({
      windowStart: new Date('2026-04-01T00:00:00Z'),
      windowEnd: new Date('2026-05-01T00:00:00Z'),
    });

    const sample = result.samples[0]!;
    expect(sample.layer1Passed).toBe(false);
    expect(
      sample.failureReasons.some((r) => r.startsWith('layer1')),
    ).toBe(true);
  });

  it('fails layer2 when the template slug has no first-message file on disk', async () => {
    queueRows([makeRow({ templateSlug: 'nonexistent-template-slug' })]);

    const result = await runAiActConformanceAudit({
      windowStart: new Date('2026-04-01T00:00:00Z'),
      windowEnd: new Date('2026-05-01T00:00:00Z'),
    });

    const sample = result.samples[0]!;
    expect(sample.layer2Passed).toBe(false);
    expect(
      sample.failureReasons.some((r) =>
        r.includes('first-message template missing'),
      ),
    ).toBe(true);
  });

  it('aggregates counters across a mixed sample', async () => {
    queueRows([
      makeRow({ callId: 'c1', callMetadata: { disclosure_verified: true } }),
      makeRow({ callId: 'c2', callMetadata: { disclosure_verified: false } }),
      makeRow({ callId: 'c3', callMetadata: null }),
      makeRow({ callId: 'c4', callMetadata: { disclosure_verified: true } }),
    ]);

    const result = await runAiActConformanceAudit({
      windowStart: new Date('2026-04-01T00:00:00Z'),
      windowEnd: new Date('2026-05-01T00:00:00Z'),
    });

    expect(result.totalSampled).toBe(4);
    expect(result.layer1Passed).toBe(4);
    expect(result.layer2Passed).toBe(4);
    expect(result.layer3Passed).toBe(2);
    expect(result.layer3NotApplicable).toBe(1);
    // Sanity: every layer-3 column sums to <= totalSampled
    expect(result.layer3Passed + result.layer3NotApplicable).toBeLessThanOrEqual(
      result.totalSampled,
    );
  });

  it('canonical preamble starts with the regulator-mandated transparency rule', () => {
    // Pin the audit's notion of the preamble to the literal text asserted by
    // the dispatch-time verifier — a regression here would silently drift the
    // audit away from what the verifier rejects.
    expect(AI_ACT_PREAMBLE_IT).toMatch(
      /^Devi rispettare scrupolosamente la seguente regola di trasparenza/,
    );
  });
});

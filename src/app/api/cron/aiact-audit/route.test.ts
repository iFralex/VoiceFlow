import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockWithSystemContext,
  mockRecordAudit,
  mockRunAiActConformanceAudit,
  mockEnv,
} = vi.hoisted(() => {
  const mockWithSystemContext = vi.fn();
  const mockRecordAudit = vi.fn().mockResolvedValue(undefined);
  const mockRunAiActConformanceAudit = vi.fn();
  const mockEnv = { CRON_SECRET: 'test-cron-secret-16chars' };
  return {
    mockWithSystemContext,
    mockRecordAudit,
    mockRunAiActConformanceAudit,
    mockEnv,
  };
});

vi.mock('@/lib/db/context', () => ({
  withSystemContext: mockWithSystemContext,
}));

vi.mock('@/lib/db/audit', () => ({
  recordAudit: mockRecordAudit,
}));

vi.mock('@/lib/compliance/aiact/audit', () => ({
  runAiActConformanceAudit: mockRunAiActConformanceAudit,
}));

vi.mock('@/lib/env', () => ({
  env: mockEnv,
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { GET, runAiActAuditCron } from './route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CRON_SECRET = 'test-cron-secret-16chars';

function makeRequest(secret?: string): Request {
  return new Request('http://localhost/api/cron/aiact-audit', {
    method: 'GET',
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

function defaultAuditResult() {
  return {
    totalSampled: 4,
    layer1Passed: 4,
    layer2Passed: 4,
    layer3Passed: 3,
    layer3NotApplicable: 1,
    windowStart: '2026-04-01T00:00:00.000Z',
    windowEnd: '2026-05-01T00:00:00.000Z',
    samples: [
      {
        callId: 'c1',
        orgId: 'o1',
        scriptId: 's1',
        templateSlug: 'car-renewal',
        layer1Passed: true,
        layer2Passed: true,
        layer3Passed: true,
        failureReasons: [],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/cron/aiact-audit — auth', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockEnv.CRON_SECRET = CRON_SECRET;
    mockRunAiActConformanceAudit.mockResolvedValue(defaultAuditResult());
    // Pass-through so recordAudit is observed
    mockWithSystemContext.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    );
  });

  afterEach(() => {
    mockEnv.CRON_SECRET = CRON_SECRET;
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockRunAiActConformanceAudit).not.toHaveBeenCalled();
  });

  it('returns 401 when bearer token does not match CRON_SECRET', async () => {
    const res = await GET(makeRequest('wrong-secret-16chars-x'));
    expect(res.status).toBe(401);
    expect(mockRunAiActConformanceAudit).not.toHaveBeenCalled();
  });

  it('returns 200 and runs the audit on a valid request', async () => {
    const res = await GET(makeRequest(CRON_SECRET));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; totalSampled: number };
    expect(json.ok).toBe(true);
    expect(json.totalSampled).toBe(4);
    expect(mockRunAiActConformanceAudit).toHaveBeenCalledOnce();
  });
});

describe('runAiActAuditCron', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRunAiActConformanceAudit.mockResolvedValue(defaultAuditResult());
    mockWithSystemContext.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    );
  });

  it('uses a 31-day trailing window relative to `now`', async () => {
    const now = new Date('2026-05-07T06:00:00Z');
    await runAiActAuditCron(now);

    expect(mockRunAiActConformanceAudit).toHaveBeenCalledOnce();
    const args = mockRunAiActConformanceAudit.mock.calls[0]![0] as {
      windowStart: Date;
      windowEnd: Date;
    };
    expect(args.windowEnd.toISOString()).toBe('2026-05-07T06:00:00.000Z');
    const expectedStart = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);
    expect(args.windowStart.toISOString()).toBe(expectedStart.toISOString());
  });

  it('persists the result to audit_log with action compliance.aiact_audit_completed', async () => {
    await runAiActAuditCron(new Date('2026-05-07T06:00:00Z'));

    expect(mockRecordAudit).toHaveBeenCalledOnce();
    const auditCall = mockRecordAudit.mock.calls[0]!;
    expect(auditCall[1]).toMatchObject({
      actorType: 'system',
      action: 'compliance.aiact_audit_completed',
      subjectType: 'aiact',
      subjectId: 'monthly',
    });
    const metadata = (auditCall[1] as { metadata: Record<string, unknown> }).metadata;
    expect(metadata).toMatchObject({
      totalSampled: 4,
      layer1Passed: 4,
      layer2Passed: 4,
      layer3Passed: 3,
      layer3NotApplicable: 1,
    });
    // Samples must be included so the dashboard can list per-call failures.
    expect(Array.isArray(metadata.samples)).toBe(true);
  });

  it('returns the audit result so the route can echo it', async () => {
    const result = await runAiActAuditCron(new Date('2026-05-07T06:00:00Z'));
    expect(result.totalSampled).toBe(4);
    expect(result.layer1Passed).toBe(4);
    expect(result.layer3NotApplicable).toBe(1);
  });
});

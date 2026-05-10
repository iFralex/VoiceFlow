import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mock factories
const { mockIngest } = vi.hoisted(() => ({
  mockIngest: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@axiomhq/js', () => ({
  // Must use function/class syntax to be usable as a constructor with `new`
  Axiom: function AxiomMock() {
    return { ingest: mockIngest };
  },
}));

vi.mock('@/lib/env', () => ({
  env: {
    NODE_ENV: 'production',
    AXIOM_TOKEN: 'test-token',
    AXIOM_DATASET: 'test-dataset',
  },
}));

vi.mock('./request-context', () => ({
  getRequestContext: vi.fn().mockReturnValue({
    requestId: 'req-123',
    orgId: 'org-abc',
    userId: 'user-xyz',
  }),
}));

import { logger } from './logger';

describe('logger', () => {
  beforeEach(() => {
    mockIngest.mockClear();
  });

  it('ingests an info log with enriched context', async () => {
    await logger.info('test message', { call_id: 'call-1' });

    expect(mockIngest).toHaveBeenCalledOnce();
    const [dataset, events] = mockIngest.mock.calls[0] as [string, unknown[]];
    expect(dataset).toBe('test-dataset');
    const event = events[0] as Record<string, unknown>;
    expect(event.level).toBe('info');
    expect(event.message).toBe('test message');
    expect(event.call_id).toBe('call-1');
    expect(event.request_id).toBe('req-123');
    expect(event.org_id).toBe('org-abc');
    expect(event.user_id).toBe('user-xyz');
    expect(typeof event.ts).toBe('string');
  });

  it('ingests a warn log', async () => {
    await logger.warn('warning message');

    expect(mockIngest).toHaveBeenCalledOnce();
    const event = (mockIngest.mock.calls[0] as [string, unknown[]])[1][0] as Record<
      string,
      unknown
    >;
    expect(event.level).toBe('warn');
  });

  it('ingests an error log', async () => {
    await logger.error('error message', { campaign_id: 'camp-99' });

    expect(mockIngest).toHaveBeenCalledOnce();
    const event = (mockIngest.mock.calls[0] as [string, unknown[]])[1][0] as Record<
      string,
      unknown
    >;
    expect(event.level).toBe('error');
    expect(event.campaign_id).toBe('camp-99');
  });

  it('ctx fields take precedence over request context', async () => {
    await logger.info('override test', { org_id: 'org-override' });

    const event = (mockIngest.mock.calls[0] as [string, unknown[]])[1][0] as Record<
      string,
      unknown
    >;
    expect(event.org_id).toBe('org-override');
  });

  it('does not throw when axiom ingest fails', async () => {
    mockIngest.mockRejectedValueOnce(new Error('network error'));
    await expect(logger.info('resilient call')).resolves.toBeUndefined();
  });
});

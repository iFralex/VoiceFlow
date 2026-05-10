import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSelect, mockFrom, mockWhere, mockLimit, mockEnv } = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockWhere = vi.fn(() => ({ limit: mockLimit }));
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  const mockEnv = {};
  return { mockSelect, mockFrom, mockWhere, mockLimit, mockEnv };
});

vi.mock('@/lib/db/client', () => ({
  db: { select: mockSelect },
}));

vi.mock('@/lib/db/schema/email_log', () => ({
  emailLog: {
    id: 'email_log.id',
    sent_at: 'email_log.sent_at',
    tags: 'email_log.tags',
    error: 'email_log.error',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ __and: args }),
  gt: (col: unknown, val: unknown) => ({ __gt: [col, val] }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    __sql: strings.join('?'),
    __values: values,
  }),
}));

import { hasRecentEmailSent } from './idempotency';

describe('hasRecentEmailSent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when a matching row exists', async () => {
    mockLimit.mockResolvedValue([{ id: BigInt(1) }]);
    const result = await hasRecentEmailSent('org-123', 'low-balance', 24);
    expect(result).toBe(true);
  });

  it('returns false when no matching rows exist', async () => {
    mockLimit.mockResolvedValue([]);
    const result = await hasRecentEmailSent('org-123', 'low-balance', 24);
    expect(result).toBe(false);
  });

  it('calls db.select with limit(1)', async () => {
    mockLimit.mockResolvedValue([]);
    await hasRecentEmailSent('org-456', 'low-balance', 24);
    expect(mockLimit).toHaveBeenCalledWith(1);
  });

  it('passes the correct table to from()', async () => {
    mockLimit.mockResolvedValue([]);
    await hasRecentEmailSent('org-456', 'low-balance', 24);
    expect(mockFrom).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'email_log.id' }),
    );
  });
});

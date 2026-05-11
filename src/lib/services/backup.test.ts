import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock env before importing backup module
vi.mock('@/lib/env', () => ({
  env: {
    DATABASE_DIRECT_URL: 'postgresql://test:test@localhost:5432/test',
    BACKUP_B2_KEY_ID: undefined,
    BACKUP_B2_APP_KEY: undefined,
    BACKUP_B2_BUCKET_ID: undefined,
    BACKUP_ENCRYPTION_KEY: undefined,
    NODE_ENV: 'test',
  },
}));

vi.mock('@/lib/observability/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock postgres client
vi.mock('postgres', () => {
  const sql = vi.fn() as unknown as ReturnType<typeof import('postgres').default>;
  // sql tagged template returns empty array by default
  const proxy = new Proxy(vi.fn().mockResolvedValue([]) as unknown as typeof sql, {
    get(target, prop) {
      if (prop === 'end') return vi.fn().mockResolvedValue(undefined);
      // sql(tableName) identity for table name interpolation
      if (prop === 'toString') return () => 'sql';
      return (target as Record<string, unknown>)[prop as string];
    },
    apply(_target, _this, args) {
      // Tagged template call: sql`SELECT ...`
      if (Array.isArray(args[0])) return Promise.resolve([]);
      // sql(tableName) interpolation helper — return the string
      return args[0];
    },
  });
  return { default: vi.fn(() => proxy) };
});

import { runDatabaseBackup } from './backup';

describe('runDatabaseBackup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns not-configured when env vars are absent', async () => {
    const result = await runDatabaseBackup();
    expect(result.ok).toBe(false);
    expect(result.error).toBe('backup_not_configured');
  });
});

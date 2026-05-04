import { beforeEach, describe, expect, it, vi } from 'vitest';

import { validateItalianVat } from './organizations';

// ─── VAT validation ────────────────────────────────────────────────────────

describe('validateItalianVat', () => {
  it('accepts a known-good P.IVA', () => {
    // 12345678903 is a valid test P.IVA
    expect(validateItalianVat('12345678903')).toBe(true);
  });

  it('accepts all-zeros edge case', () => {
    // 00000000000: sum=0 → check=(10-0%10)%10=0 ✓
    expect(validateItalianVat('00000000000')).toBe(true);
  });

  it('rejects wrong check digit', () => {
    expect(validateItalianVat('12345678901')).toBe(false);
  });

  it('rejects fewer than 11 digits', () => {
    expect(validateItalianVat('1234567890')).toBe(false);
  });

  it('rejects more than 11 digits', () => {
    expect(validateItalianVat('123456789012')).toBe(false);
  });

  it('rejects non-numeric characters', () => {
    expect(validateItalianVat('1234567890A')).toBe(false);
  });

  it('trims surrounding whitespace before validating', () => {
    expect(validateItalianVat('  12345678903  ')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(validateItalianVat('')).toBe(false);
  });
});

// ─── Service functions (mocked DB layer) ───────────────────────────────────

// Build mock tx object before the module-level vi.mock calls
const mockRecordAudit = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/db/audit', () => ({
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

let mockTxSelectResult: unknown[] = [];
let mockTxInsertResult: unknown[] = [];
let mockTxUpdateResult: unknown[] = [];

const mockTx = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn().mockImplementation(() => Promise.resolve(mockTxSelectResult)),
      innerJoin: vi.fn(() => ({
        where: vi.fn().mockImplementation(() => Promise.resolve(mockTxSelectResult)),
      })),
    })),
  })),
  insert: vi.fn(() => ({
    values: vi.fn(() => ({
      returning: vi.fn().mockImplementation(() => Promise.resolve(mockTxInsertResult)),
    })),
  })),
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn().mockImplementation(() => Promise.resolve(mockTxUpdateResult)),
      })),
    })),
  })),
  execute: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@/lib/db/context', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
  withSystemContext: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
}));

const { withOrgContext, withSystemContext } = await import('@/lib/db/context');

const fakeOrg = {
  id: 'org-1',
  name: 'Acme',
  legal_name: null,
  vat_number: null,
  country: 'IT',
  timezone: 'Europe/Rome',
  created_at: new Date(),
  deleted_at: null,
};

describe('createOrganization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTxInsertResult = [fakeOrg];
    // Re-wire mocks after clearAllMocks
    mockTx.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(mockTxSelectResult),
        innerJoin: vi.fn(() => ({ where: vi.fn().mockResolvedValue(mockTxSelectResult) })),
      })),
    });
    mockTx.insert.mockReturnValue({
      values: vi.fn(() => ({
        returning: vi.fn().mockImplementation(() => Promise.resolve(mockTxInsertResult)),
      })),
    });
    mockTx.update.mockReturnValue({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue(mockTxUpdateResult),
        })),
      })),
    });
  });

  it('throws invalid_vat_number for a bad VAT', async () => {
    const { createOrganization } = await import('./organizations');
    await expect(
      createOrganization({ ownerId: 'u1', name: 'Acme', vatNumber: '12345678901' }),
    ).rejects.toThrow('invalid_vat_number');
  });

  it('inserts org + membership + audit in a system context transaction', async () => {
    const { createOrganization } = await import('./organizations');
    const result = await createOrganization({ ownerId: 'u1', name: 'Acme' });

    expect(withSystemContext).toHaveBeenCalledOnce();
    expect(mockTx.insert).toHaveBeenCalledTimes(2); // org + membership
    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ action: 'org.created', subjectId: 'org-1' }),
    );
    expect(result).toEqual(fakeOrg);
  });

  it('accepts a valid VAT number', async () => {
    const { createOrganization } = await import('./organizations');
    await expect(
      createOrganization({ ownerId: 'u1', name: 'Acme', vatNumber: '12345678903' }),
    ).resolves.toEqual(fakeOrg);
  });
});

describe('getOrganization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTxSelectResult = [fakeOrg];
    mockTx.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([fakeOrg]),
        innerJoin: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
      })),
    });
  });

  it('uses withOrgContext and returns the org', async () => {
    const { getOrganization } = await import('./organizations');
    const result = await getOrganization('org-1');

    expect(withOrgContext).toHaveBeenCalledWith('org-1', expect.any(Function));
    expect(result).toEqual(fakeOrg);
  });

  it('returns null when org not found', async () => {
    mockTx.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([]),
        innerJoin: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
      })),
    });
    const { getOrganization } = await import('./organizations');
    const result = await getOrganization('org-missing');
    expect(result).toBeNull();
  });
});

describe('listOrganizationsForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([fakeOrg]),
        innerJoin: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([{ org: fakeOrg }]),
        })),
      })),
    });
  });

  it('uses withSystemContext', async () => {
    const { listOrganizationsForUser } = await import('./organizations');
    await listOrganizationsForUser('u1');

    expect(withSystemContext).toHaveBeenCalledOnce();
  });

  it('maps rows to Organization objects', async () => {
    const { listOrganizationsForUser } = await import('./organizations');
    const result = await listOrganizationsForUser('u1');
    expect(result).toEqual([fakeOrg]);
  });
});

describe('updateOrganization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTxUpdateResult = [{ ...fakeOrg, name: 'New Name' }];
    mockTx.update.mockReturnValue({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue(mockTxUpdateResult),
        })),
      })),
    });
  });

  it('uses withOrgContext and returns updated org', async () => {
    const { updateOrganization } = await import('./organizations');
    const result = await updateOrganization('org-1', { name: 'New Name' }, 'user-1');

    expect(withOrgContext).toHaveBeenCalledWith('org-1', expect.any(Function));
    expect(result.name).toBe('New Name');
  });

  it('throws for invalid VAT in patch', async () => {
    const { updateOrganization } = await import('./organizations');
    await expect(updateOrganization('org-1', { vat_number: '12345678901' }, 'user-1')).rejects.toThrow(
      'invalid_vat_number',
    );
  });

  it('accepts null VAT (removal) without validation', async () => {
    mockTxUpdateResult = [fakeOrg];
    mockTx.update.mockReturnValue({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([fakeOrg]),
        })),
      })),
    });
    const { updateOrganization } = await import('./organizations');
    await expect(updateOrganization('org-1', { vat_number: null }, 'user-1')).resolves.toBeDefined();
  });

  it('throws organization_not_found when update returns empty', async () => {
    mockTx.update.mockReturnValue({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([]),
        })),
      })),
    });
    const { updateOrganization } = await import('./organizations');
    await expect(updateOrganization('org-1', { name: 'X' }, 'user-1')).rejects.toThrow(
      'organization_not_found',
    );
  });
});

describe('softDeleteOrganization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTxUpdateResult = [{ id: 'org-1' }];
    mockTx.update.mockReturnValue({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([{ id: 'org-1' }]),
        })),
      })),
    });
  });

  it('uses withOrgContext', async () => {
    const { softDeleteOrganization } = await import('./organizations');
    await softDeleteOrganization('org-1', 'u1');
    expect(withOrgContext).toHaveBeenCalledWith('org-1', expect.any(Function));
  });

  it('sets deleted_at and records audit', async () => {
    const { softDeleteOrganization } = await import('./organizations');
    await softDeleteOrganization('org-1', 'u1');

    const setCall = mockTx.update.mock.results[0]?.value.set;
    expect(setCall).toHaveBeenCalledWith(expect.objectContaining({ deleted_at: expect.any(Date) }));
    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ action: 'org.deleted', subjectId: 'org-1' }),
    );
  });

  it('throws organization_not_found when already deleted', async () => {
    mockTx.update.mockReturnValue({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([]),
        })),
      })),
    });
    const { softDeleteOrganization } = await import('./organizations');
    await expect(softDeleteOrganization('org-1', 'u1')).rejects.toThrow('organization_not_found');
  });
});

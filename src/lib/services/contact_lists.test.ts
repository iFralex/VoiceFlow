import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockRecordAudit = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/db/audit', () => ({
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

const mockTxSelectResult: unknown[] = [];
let mockTxInsertResult: unknown[] = [];
const mockTxUpdateResult: unknown[] = [];
let mockTxDeleteResult: unknown[] = [];

const mockTx = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn().mockImplementation(() => Promise.resolve(mockTxSelectResult)),
    })),
  })),
  insert: vi.fn(() => ({
    values: vi.fn(() => ({
      returning: vi.fn().mockImplementation(() => Promise.resolve(mockTxInsertResult)),
    })),
  })),
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn().mockImplementation(() => Promise.resolve(mockTxUpdateResult)),
    })),
  })),
  delete: vi.fn(() => ({
    where: vi.fn(() => ({
      returning: vi.fn().mockImplementation(() => Promise.resolve(mockTxDeleteResult)),
    })),
  })),
  execute: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@/lib/db/context', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
  withSystemContext: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
}));

const { withOrgContext } = await import('@/lib/db/context');

// ─── Fixtures ────────────────────────────────────────────────────────────────

const fakeList = {
  id: 'list-1',
  org_id: 'org-1',
  name: 'Test List',
  source: 'csv-upload' as const,
  source_file_path: null,
  total_count: 0,
  valid_count: 0,
  import_status: 'pending' as const,
  created_at: new Date(),
};

// ─── createContactList ───────────────────────────────────────────────────────

describe('createContactList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTxInsertResult = [fakeList];
    mockTx.insert.mockReturnValue({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([fakeList]),
      })),
    });
  });

  it('inserts a contact list and records audit', async () => {
    const { createContactList } = await import('./contact_lists');
    const result = await createContactList('org-1', 'user-1', {
      name: 'Test List',
      source: 'csv-upload',
    });

    expect(withOrgContext).toHaveBeenCalledWith('org-1', expect.any(Function));
    expect(mockTx.insert).toHaveBeenCalledOnce();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        action: 'contact_list.created',
        subjectId: 'list-1',
        orgId: 'org-1',
        actorUserId: 'user-1',
      }),
    );
    expect(result).toEqual(fakeList);
  });

  it('passes source_file_path when provided', async () => {
    const { createContactList } = await import('./contact_lists');
    const valuesArgs: unknown[] = [];
    mockTx.insert.mockReturnValue({
      values: vi.fn((...args: unknown[]) => {
        valuesArgs.push(...args);
        return { returning: vi.fn().mockResolvedValue([fakeList]) };
      }),
    });

    await createContactList('org-1', 'user-1', {
      name: 'Test List',
      source: 'csv-upload',
      sourceFilePath: 'org-1/uploads/file.csv',
    });

    expect(valuesArgs[0]).toMatchObject({ source_file_path: 'org-1/uploads/file.csv' });
  });

  it('sets source_file_path to null when omitted', async () => {
    const { createContactList } = await import('./contact_lists');
    const valuesArgs: unknown[] = [];
    mockTx.insert.mockReturnValue({
      values: vi.fn((...args: unknown[]) => {
        valuesArgs.push(...args);
        return { returning: vi.fn().mockResolvedValue([fakeList]) };
      }),
    });

    await createContactList('org-1', 'user-1', { name: 'Test List', source: 'zapier' });

    expect(valuesArgs[0]).toMatchObject({ source_file_path: null });
  });
});

// ─── listContactLists ────────────────────────────────────────────────────────

describe('listContactLists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([fakeList]),
      })),
    });
  });

  it('uses withOrgContext and returns lists', async () => {
    const { listContactLists } = await import('./contact_lists');
    const result = await listContactLists('org-1');

    expect(withOrgContext).toHaveBeenCalledWith('org-1', expect.any(Function));
    expect(result).toEqual([fakeList]);
  });

  it('returns empty array when no lists', async () => {
    mockTx.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    });
    const { listContactLists } = await import('./contact_lists');
    const result = await listContactLists('org-1');
    expect(result).toEqual([]);
  });
});

// ─── getContactList ───────────────────────────────────────────────────────────

describe('getContactList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([fakeList]),
      })),
    });
  });

  it('uses withOrgContext and returns the list', async () => {
    const { getContactList } = await import('./contact_lists');
    const result = await getContactList('org-1', 'list-1');

    expect(withOrgContext).toHaveBeenCalledWith('org-1', expect.any(Function));
    expect(result).toEqual(fakeList);
  });

  it('returns null when not found', async () => {
    mockTx.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    });
    const { getContactList } = await import('./contact_lists');
    const result = await getContactList('org-1', 'missing-id');
    expect(result).toBeNull();
  });
});

// ─── deleteContactList ────────────────────────────────────────────────────────

describe('deleteContactList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTxDeleteResult = [{ id: 'list-1' }];
    mockTx.delete.mockReturnValue({
      where: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: 'list-1' }]),
      })),
    });
  });

  it('deletes the list and records audit', async () => {
    const { deleteContactList } = await import('./contact_lists');
    await deleteContactList('org-1', 'user-1', 'list-1');

    expect(withOrgContext).toHaveBeenCalledWith('org-1', expect.any(Function));
    expect(mockTx.delete).toHaveBeenCalledOnce();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        action: 'contact_list.deleted',
        subjectId: 'list-1',
        orgId: 'org-1',
        actorUserId: 'user-1',
      }),
    );
  });

  it('throws contact_list_not_found when list does not exist', async () => {
    mockTx.delete.mockReturnValue({
      where: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([]),
      })),
    });
    const { deleteContactList } = await import('./contact_lists');
    await expect(deleteContactList('org-1', 'user-1', 'missing-id')).rejects.toThrow(
      'contact_list_not_found',
    );
  });
});

// ─── updateListCounts ─────────────────────────────────────────────────────────

describe('updateListCounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.update.mockReturnValue({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(undefined),
      })),
    });
  });

  it('uses withOrgContext and updates counts', async () => {
    const { updateListCounts } = await import('./contact_lists');
    await updateListCounts('org-1', 'list-1', 100, 95);

    expect(withOrgContext).toHaveBeenCalledWith('org-1', expect.any(Function));
    expect(mockTx.update).toHaveBeenCalledOnce();

    const setCall = mockTx.update.mock.results[0]?.value.set;
    expect(setCall).toHaveBeenCalledWith({ total_count: 100, valid_count: 95 });
  });

  it('does not call recordAudit (count update is internal)', async () => {
    const { updateListCounts } = await import('./contact_lists');
    await updateListCounts('org-1', 'list-1', 50, 50);
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});

// ─── updateListImportStatus ───────────────────────────────────────────────────

describe('updateListImportStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.update.mockReturnValue({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(undefined),
      })),
    });
  });

  it('uses withOrgContext and updates import_status to parsing', async () => {
    const { updateListImportStatus } = await import('./contact_lists');
    await updateListImportStatus('org-1', 'list-1', 'parsing');

    expect(withOrgContext).toHaveBeenCalledWith('org-1', expect.any(Function));
    expect(mockTx.update).toHaveBeenCalledOnce();

    const setCall = mockTx.update.mock.results[0]?.value.set;
    expect(setCall).toHaveBeenCalledWith({ import_status: 'parsing' });
  });

  it('updates import_status to completed', async () => {
    const { updateListImportStatus } = await import('./contact_lists');
    await updateListImportStatus('org-1', 'list-1', 'completed');

    const setCall = mockTx.update.mock.results[0]?.value.set;
    expect(setCall).toHaveBeenCalledWith({ import_status: 'completed' });
  });

  it('updates import_status to failed', async () => {
    const { updateListImportStatus } = await import('./contact_lists');
    await updateListImportStatus('org-1', 'list-1', 'failed');

    const setCall = mockTx.update.mock.results[0]?.value.set;
    expect(setCall).toHaveBeenCalledWith({ import_status: 'failed' });
  });
});

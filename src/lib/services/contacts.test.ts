import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockRecordAudit = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/db/audit', () => ({
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

vi.mock('@/lib/db/context', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
  withSystemContext: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
}));

// Forward-declare mockTx so the context mock can reference it
let mockTx: {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
};

// Build a chainable select mock that resolves at the end of any chain length
// by returning a thenable at each step that also has further chain methods.
function makeSelectChain(result: unknown[]): unknown {
  const chain: Record<string, unknown> = {};
  const thenable = {
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(result)),
    from: vi.fn(() => thenable),
    where: vi.fn(() => thenable),
    orderBy: vi.fn(() => thenable),
    limit: vi.fn(() => Promise.resolve(result)),
    ...chain,
  };
  return thenable;
}

let mockSelectResult: unknown[] = [];
let mockInsertResult: unknown[] = [];
let mockUpdateResult: unknown[] = [];

mockTx = {
  select: vi.fn(() => makeSelectChain(mockSelectResult)),
  insert: vi.fn(() => ({
    values: vi.fn(() => ({
      returning: vi.fn(() => Promise.resolve(mockInsertResult)),
      onConflictDoUpdate: vi.fn(() => Promise.resolve(undefined)),
      onConflictDoNothing: vi.fn(() => Promise.resolve(undefined)),
    })),
  })),
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve(mockUpdateResult)),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(undefined)),
      })),
    })),
  })),
  delete: vi.fn(() => ({
    where: vi.fn(() => ({
      returning: vi.fn(() => Promise.resolve([])),
    })),
  })),
  execute: vi.fn().mockResolvedValue(undefined),
};

const { withOrgContext } = await import('@/lib/db/context');

// ─── Fixtures ────────────────────────────────────────────────────────────────

const fakeContact = {
  id: 'contact-1',
  org_id: 'org-1',
  contact_list_id: 'list-1',
  phone_e164: '+393331234567',
  first_name: 'Mario',
  last_name: 'Rossi',
  email: 'mario@example.com',
  consent_basis: 'existing_customer' as const,
  consent_evidence: null,
  contact_type: 'b2c' as const,
  rpo_status: 'unchecked' as const,
  rpo_checked_at: null,
  opt_out: false,
  opt_out_reason: null,
  metadata: null,
  created_at: new Date('2024-01-01T10:00:00Z'),
  deleted_at: null,
};

const fakeNewContact = {
  org_id: 'org-1',
  contact_list_id: 'list-1',
  phone_e164: '+393331234567',
  first_name: 'Mario',
  last_name: 'Rossi',
  email: 'mario@example.com',
  consent_basis: 'existing_customer' as const,
};

// ─── upsertContact ───────────────────────────────────────────────────────────

describe('upsertContact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts a new contact when none exists', async () => {
    mockSelectResult = [];
    mockInsertResult = [fakeContact];
    mockTx.select = vi.fn(() => makeSelectChain([]));
    mockTx.insert = vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([fakeContact])),
        onConflictDoUpdate: vi.fn(() => Promise.resolve(undefined)),
        onConflictDoNothing: vi.fn(() => Promise.resolve(undefined)),
      })),
    }));

    const { upsertContact } = await import('./contacts');
    const result = await upsertContact('org-1', fakeNewContact);

    expect(withOrgContext).toHaveBeenCalledWith('org-1', expect.any(Function));
    expect(mockTx.insert).toHaveBeenCalledOnce();
    expect(result).toEqual({ inserted: true, contact: fakeContact });
  });

  it('updates an existing contact when phone already exists', async () => {
    const updatedContact = { ...fakeContact, first_name: 'Luigi' };
    mockTx.select = vi.fn(() => makeSelectChain([fakeContact]));
    mockTx.update = vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve([updatedContact])),
        })),
      })),
    }));

    const { upsertContact } = await import('./contacts');
    const result = await upsertContact('org-1', { ...fakeNewContact, first_name: 'Luigi' });

    expect(mockTx.update).toHaveBeenCalledOnce();
    expect(result).toEqual({ inserted: false, contact: updatedContact });
  });

  it('does not call insert when contact already exists', async () => {
    mockTx.select = vi.fn(() => makeSelectChain([fakeContact]));
    mockTx.update = vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve([fakeContact])),
        })),
      })),
    }));
    mockTx.insert = vi.fn();

    const { upsertContact } = await import('./contacts');
    await upsertContact('org-1', fakeNewContact);

    expect(mockTx.insert).not.toHaveBeenCalled();
  });
});

// ─── bulkUpsertContacts ───────────────────────────────────────────────────────

describe('bulkUpsertContacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns zero counts for empty input', async () => {
    const { bulkUpsertContacts } = await import('./contacts');
    const result = await bulkUpsertContacts('org-1', []);

    expect(result).toEqual({ insertedCount: 0, updatedCount: 0, skippedCount: 0 });
    expect(withOrgContext).not.toHaveBeenCalled();
  });

  it('correctly counts inserted vs updated contacts', async () => {
    const contact1 = { ...fakeNewContact, phone_e164: '+393331111111' };
    const contact2 = { ...fakeNewContact, phone_e164: '+393332222222' };
    const contact3 = { ...fakeNewContact, phone_e164: '+393333333333' };

    // contact1 and contact2 exist; contact3 is new
    mockTx.select = vi.fn(() =>
      makeSelectChain([{ phone: '+393331111111' }, { phone: '+393332222222' }]),
    );
    mockTx.insert = vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([])),
        onConflictDoUpdate: vi.fn(() => Promise.resolve(undefined)),
        onConflictDoNothing: vi.fn(() => Promise.resolve(undefined)),
      })),
    }));

    const { bulkUpsertContacts } = await import('./contacts');
    const result = await bulkUpsertContacts('org-1', [contact1, contact2, contact3]);

    expect(withOrgContext).toHaveBeenCalledOnce();
    expect(mockTx.insert).toHaveBeenCalledOnce();
    expect(result).toEqual({ insertedCount: 1, updatedCount: 2, skippedCount: 0 });
  });

  it('calls withOrgContext once per batch of 500', async () => {
    // Create 501 contacts to force two batches
    const manyContacts = Array.from({ length: 501 }, (_, i) => ({
      ...fakeNewContact,
      phone_e164: `+3933300${String(i).padStart(5, '0')}`,
    }));

    mockTx.select = vi.fn(() => makeSelectChain([]));
    mockTx.insert = vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(() => Promise.resolve(undefined)),
      })),
    }));

    const { bulkUpsertContacts } = await import('./contacts');
    await bulkUpsertContacts('org-1', manyContacts);

    // 501 contacts → 2 batches → 2 withOrgContext calls
    expect(withOrgContext).toHaveBeenCalledTimes(2);
  });

  it('performs ON CONFLICT DO UPDATE via insert', async () => {
    const onConflictDoUpdate = vi.fn(() => Promise.resolve(undefined));
    mockTx.select = vi.fn(() => makeSelectChain([]));
    mockTx.insert = vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate,
        onConflictDoNothing: vi.fn(() => Promise.resolve(undefined)),
      })),
    }));

    const { bulkUpsertContacts } = await import('./contacts');
    await bulkUpsertContacts('org-1', [fakeNewContact]);

    expect(onConflictDoUpdate).toHaveBeenCalledOnce();
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.any(Array),
        set: expect.objectContaining({ first_name: expect.anything() }),
      }),
    );
  });
});

// ─── listContacts ─────────────────────────────────────────────────────────────

describe('listContacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns contacts without cursor for first page', async () => {
    mockTx.select = vi.fn(() => makeSelectChain([fakeContact]));

    const { listContacts } = await import('./contacts');
    const result = await listContacts('org-1', {}, { limit: 10 });

    expect(withOrgContext).toHaveBeenCalledWith('org-1', expect.any(Function));
    expect(result.items).toEqual([fakeContact]);
    expect(result.nextCursor).toBeUndefined();
  });

  it('returns nextCursor when there are more results than the limit', async () => {
    const contacts2 = { ...fakeContact, id: 'contact-2', created_at: new Date('2024-01-01T09:00:00Z') };
    // Return limit+1 items to trigger cursor generation
    mockTx.select = vi.fn(() => makeSelectChain([fakeContact, contacts2]));

    const { listContacts } = await import('./contacts');
    const result = await listContacts('org-1', {}, { limit: 1 });

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeDefined();
    expect(typeof result.nextCursor).toBe('string');
  });

  it('returns empty items when no contacts found', async () => {
    mockTx.select = vi.fn(() => makeSelectChain([]));

    const { listContacts } = await import('./contacts');
    const result = await listContacts('org-1', {}, { limit: 10 });

    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeUndefined();
  });

  it('accepts a cursor for subsequent pages', async () => {
    mockTx.select = vi.fn(() => makeSelectChain([]));

    // Generate a cursor by running first query
    const { listContacts } = await import('./contacts');

    mockTx.select = vi.fn(() => makeSelectChain([fakeContact, { ...fakeContact, id: 'contact-2' }]));
    const firstPage = await listContacts('org-1', {}, { limit: 1 });
    const cursor = firstPage.nextCursor!;

    // Use the cursor for the next page
    mockTx.select = vi.fn(() => makeSelectChain([]));
    const secondPage = await listContacts('org-1', {}, { limit: 1, cursor });

    expect(withOrgContext).toHaveBeenCalledTimes(2);
    expect(secondPage.items).toEqual([]);
  });

  it('applies listId filter', async () => {
    const whereConditions: unknown[] = [];
    mockTx.select = vi.fn(() => {
      const chain = makeSelectChain([]) as Record<string, unknown>;
      const originalWhere = chain['where'] as (...args: unknown[]) => unknown;
      chain['where'] = vi.fn((...args: unknown[]) => {
        whereConditions.push(...args);
        return originalWhere(...args);
      });
      return chain;
    });

    const { listContacts } = await import('./contacts');
    await listContacts('org-1', { listId: 'list-abc' }, { limit: 10 });

    expect(withOrgContext).toHaveBeenCalledWith('org-1', expect.any(Function));
  });
});

// ─── softDeleteContact ────────────────────────────────────────────────────────

describe('softDeleteContact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets deleted_at and records audit', async () => {
    mockTx.update = vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve([{ id: 'contact-1' }])),
        })),
      })),
    }));

    const { softDeleteContact } = await import('./contacts');
    await softDeleteContact('org-1', 'user-1', 'contact-1');

    expect(withOrgContext).toHaveBeenCalledWith('org-1', expect.any(Function));
    expect(mockTx.update).toHaveBeenCalledOnce();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        action: 'contact.deleted',
        subjectType: 'contact',
        subjectId: 'contact-1',
        orgId: 'org-1',
        actorUserId: 'user-1',
      }),
    );
  });

  it('throws contact_not_found when contact does not exist', async () => {
    mockTx.update = vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve([])),
        })),
      })),
    }));

    const { softDeleteContact } = await import('./contacts');
    await expect(softDeleteContact('org-1', 'user-1', 'missing-id')).rejects.toThrow(
      'contact_not_found',
    );
  });

  it('does not call recordAudit when contact not found', async () => {
    mockTx.update = vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve([])),
        })),
      })),
    }));

    const { softDeleteContact } = await import('./contacts');
    await expect(softDeleteContact('org-1', 'user-1', 'missing-id')).rejects.toThrow();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});

// ─── countContactsForOrg ─────────────────────────────────────────────────────

describe('countContactsForOrg', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the count of active contacts for the org', async () => {
    mockTx.select = vi.fn(() => makeSelectChain([{ total: 42 }]));

    const { countContactsForOrg } = await import('./contacts');
    const result = await countContactsForOrg('org-1');

    expect(withOrgContext).toHaveBeenCalledWith('org-1', expect.any(Function));
    expect(result).toBe(42);
  });

  it('returns 0 when no contacts exist', async () => {
    mockTx.select = vi.fn(() => makeSelectChain([{ total: 0 }]));

    const { countContactsForOrg } = await import('./contacts');
    const result = await countContactsForOrg('org-1');

    expect(result).toBe(0);
  });

  it('returns 0 when query returns empty result', async () => {
    mockTx.select = vi.fn(() => makeSelectChain([]));

    const { countContactsForOrg } = await import('./contacts');
    const result = await countContactsForOrg('org-1');

    expect(result).toBe(0);
  });
});

// ─── markOptOut ───────────────────────────────────────────────────────────────

describe('markOptOut', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts into opt_out_registry and updates contacts', async () => {
    const onConflictDoNothing = vi.fn(() => Promise.resolve(undefined));
    mockTx.insert = vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing,
        onConflictDoUpdate: vi.fn(() => Promise.resolve(undefined)),
        returning: vi.fn(() => Promise.resolve([])),
      })),
    }));
    mockTx.update = vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(undefined)),
      })),
    }));

    const { markOptOut } = await import('./contacts');
    await markOptOut('org-1', '+393331234567', 'dealer_input', 'Customer request');

    expect(withOrgContext).toHaveBeenCalledWith('org-1', expect.any(Function));
    expect(mockTx.insert).toHaveBeenCalledOnce();
    expect(onConflictDoNothing).toHaveBeenCalledOnce();
    expect(mockTx.update).toHaveBeenCalledOnce();
  });

  it('updates opt_out_reason on contacts when reason provided', async () => {
    const setArgs: unknown[] = [];
    mockTx.insert = vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => Promise.resolve(undefined)),
      })),
    }));
    mockTx.update = vi.fn(() => ({
      set: vi.fn((...args: unknown[]) => {
        setArgs.push(...args);
        return { where: vi.fn(() => Promise.resolve(undefined)) };
      }),
    }));

    const { markOptOut } = await import('./contacts');
    await markOptOut('org-1', '+393331234567', 'gdpr_request', 'GDPR erasure');

    expect(setArgs[0]).toMatchObject({ opt_out: true, opt_out_reason: 'GDPR erasure' });
  });

  it('sets opt_out_reason to null when reason is omitted', async () => {
    const setArgs: unknown[] = [];
    mockTx.insert = vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => Promise.resolve(undefined)),
      })),
    }));
    mockTx.update = vi.fn(() => ({
      set: vi.fn((...args: unknown[]) => {
        setArgs.push(...args);
        return { where: vi.fn(() => Promise.resolve(undefined)) };
      }),
    }));

    const { markOptOut } = await import('./contacts');
    await markOptOut('org-1', '+393331234567', 'call_outcome');

    expect(setArgs[0]).toMatchObject({ opt_out: true, opt_out_reason: null });
  });

  it('is idempotent — uses onConflictDoNothing for registry insert', async () => {
    const onConflictDoNothing = vi.fn(() => Promise.resolve(undefined));
    mockTx.insert = vi.fn(() => ({
      values: vi.fn(() => ({ onConflictDoNothing })),
    }));
    mockTx.update = vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve(undefined)) })),
    }));

    const { markOptOut } = await import('./contacts');
    await markOptOut('org-1', '+393331234567', 'inbound_ivr');
    await markOptOut('org-1', '+393331234567', 'inbound_ivr');

    expect(onConflictDoNothing).toHaveBeenCalledTimes(2);
  });
});

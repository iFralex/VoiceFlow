import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockRecordAudit = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/db/audit', () => ({
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn().mockReturnValue(
    'Buongiorno, sono {{salesperson_first_name}}, assistente vocale per {{dealership_name}}, concessionario {{brand}}.',
  ),
}));

vi.mock('@/lib/db/context', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
  withSystemContext: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
}));

// Sequence-based select result — callers push values for successive .select() calls.
const selectResultQueue: unknown[][] = [];

function makeSelectChain(result: unknown[]): unknown {
  const thenable = {
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(result)),
    from: vi.fn(() => thenable),
    innerJoin: vi.fn(() => thenable),
    where: vi.fn(() => thenable),
    orderBy: vi.fn(() => thenable),
    limit: vi.fn(() => Promise.resolve(result)),
  };
  return thenable;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockTx: any = {
  select: vi.fn(() => {
    const result = selectResultQueue.shift() ?? [];
    return makeSelectChain(result);
  }),
  insert: vi.fn(() => ({
    values: vi.fn(() => ({
      returning: vi.fn(() => Promise.resolve(insertResultQueue.shift() ?? [])),
    })),
  })),
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve(updateResultQueue.shift() ?? [])),
      })),
    })),
  })),
  delete: vi.fn(() => ({
    where: vi.fn(() => ({
      returning: vi.fn(() => Promise.resolve(deleteResultQueue.shift() ?? [])),
    })),
  })),
  execute: vi.fn().mockResolvedValue(undefined),
};

const insertResultQueue: unknown[][] = [];
const updateResultQueue: unknown[][] = [];
const deleteResultQueue: unknown[][] = [];

const { withOrgContext } = await import('@/lib/db/context');

// ─── Fixtures ────────────────────────────────────────────────────────────────

const fakeTemplate = {
  id: 'template-1',
  slug: 'lead-reactivation',
  name: 'Riattivazione Lead',
  version: 1,
  system_prompt: 'Sei {{salesperson_first_name}} per {{dealership_name}}, concessionario {{brand}}. Contesto: {{lead_origin_context}}. Slot: {{available_slots}}.',
  variable_schema: {},
  default_voice_id: 'it-IT-placeholder',
  default_language: 'it-IT',
  published_at: new Date('2024-01-01'),
  created_at: new Date('2024-01-01'),
};

const fakeVariables = {
  dealership_name: 'AutoRoma',
  brand: 'Volkswagen',
  salesperson_first_name: 'Luca',
  available_slots: ['15/06 10:00', '16/06 14:00'],
  lead_origin_context: 'Interesse Golf GTI',
};

const fakeScript = {
  id: 'script-1',
  org_id: 'org-1',
  template_id: 'template-1',
  name: 'Riattivazione Lead VW',
  variables: fakeVariables,
  voice_id: null,
  created_at: new Date('2024-06-01'),
  updated_at: new Date('2024-06-01'),
};

// ─── Helper to reset queues ──────────────────────────────────────────────────

function resetQueues() {
  selectResultQueue.length = 0;
  insertResultQueue.length = 0;
  updateResultQueue.length = 0;
  deleteResultQueue.length = 0;
}

// ─── listScripts ─────────────────────────────────────────────────────────────

describe('listScripts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQueues();
    mockTx.select.mockImplementation(() => {
      const result = selectResultQueue.shift() ?? [];
      return makeSelectChain(result);
    });
  });

  it('uses withOrgContext and returns scripts', async () => {
    selectResultQueue.push([fakeScript]);
    const { listScripts } = await import('./scripts');

    const result = await listScripts('org-1');

    expect(withOrgContext).toHaveBeenCalledWith('org-1', expect.any(Function));
    expect(result).toEqual([fakeScript]);
  });

  it('returns empty array when no scripts exist', async () => {
    selectResultQueue.push([]);
    const { listScripts } = await import('./scripts');

    const result = await listScripts('org-1');
    expect(result).toEqual([]);
  });
});

// ─── getScript ───────────────────────────────────────────────────────────────

describe('getScript', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQueues();
    mockTx.select.mockImplementation(() => {
      const result = selectResultQueue.shift() ?? [];
      return makeSelectChain(result);
    });
  });

  it('returns null when script not found', async () => {
    selectResultQueue.push([]);
    const { getScript } = await import('./scripts');

    const result = await getScript('org-1', 'script-missing');
    expect(result).toBeNull();
  });

  it('returns script with template when found', async () => {
    selectResultQueue.push([{ script: fakeScript, template: fakeTemplate }]);
    const { getScript } = await import('./scripts');

    const result = await getScript('org-1', 'script-1');
    expect(result).toEqual({ ...fakeScript, template: fakeTemplate });
  });
});

// ─── createScript ─────────────────────────────────────────────────────────────

describe('createScript', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQueues();
    mockTx.select.mockImplementation(() => {
      const result = selectResultQueue.shift() ?? [];
      return makeSelectChain(result);
    });
    mockTx.insert.mockImplementation(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve(insertResultQueue.shift() ?? [])),
      })),
    }));
  });

  it('throws when template slug is valid but variables fail Zod validation', async () => {
    const { createScript } = await import('./scripts');

    await expect(
      createScript('org-1', 'user-1', {
        templateSlug: 'lead-reactivation',
        name: 'Test',
        variables: { dealership_name: '', brand: 'VW' }, // missing required fields
      }),
    ).rejects.toThrow('Variable validation failed');
  });

  it('throws when template not found in DB', async () => {
    // The Zod validation passes but template lookup returns nothing
    selectResultQueue.push([]); // template not found
    const { createScript } = await import('./scripts');

    await expect(
      createScript('org-1', 'user-1', {
        templateSlug: 'lead-reactivation',
        name: 'Test',
        variables: fakeVariables,
      }),
    ).rejects.toThrow('Template not found');
  });

  it('creates script and records audit for valid input', async () => {
    selectResultQueue.push([fakeTemplate]); // template lookup
    insertResultQueue.push([fakeScript]); // script insert returning

    const { createScript } = await import('./scripts');
    const result = await createScript('org-1', 'user-1', {
      templateSlug: 'lead-reactivation',
      name: 'Riattivazione Lead VW',
      variables: fakeVariables,
    });

    expect(result).toEqual(fakeScript);
    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        action: 'script.created',
        subjectId: fakeScript.id,
      }),
    );
  });

  it('uses voiceIdOverride when provided', async () => {
    selectResultQueue.push([fakeTemplate]);
    insertResultQueue.push([{ ...fakeScript, voice_id: 'voice-xyz' }]);

    const valuesMock = vi.fn(() => ({
      returning: vi.fn(() =>
        Promise.resolve([{ ...fakeScript, voice_id: 'voice-xyz' }]),
      ),
    }));
    mockTx.insert.mockReturnValue({ values: valuesMock });

    const { createScript } = await import('./scripts');
    await createScript('org-1', 'user-1', {
      templateSlug: 'lead-reactivation',
      name: 'Test',
      variables: fakeVariables,
      voiceIdOverride: 'voice-xyz',
    });

    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ voice_id: 'voice-xyz' }),
    );
  });
});

// ─── updateScript ─────────────────────────────────────────────────────────────

describe('updateScript', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQueues();
    mockTx.select.mockImplementation(() => {
      const result = selectResultQueue.shift() ?? [];
      return makeSelectChain(result);
    });
    mockTx.update.mockImplementation(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve(updateResultQueue.shift() ?? [])),
        })),
      })),
    }));
  });

  it('throws script_not_found when update returns empty', async () => {
    updateResultQueue.push([]);
    const { updateScript } = await import('./scripts');

    await expect(
      updateScript('org-1', 'user-1', 'script-missing', { name: 'New Name' }),
    ).rejects.toThrow('script_not_found');
  });

  it('updates name without variable validation', async () => {
    updateResultQueue.push([{ ...fakeScript, name: 'New Name' }]);
    const { updateScript } = await import('./scripts');

    const result = await updateScript('org-1', 'user-1', 'script-1', {
      name: 'New Name',
    });

    expect(result.name).toBe('New Name');
    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ action: 'script.updated', subjectId: 'script-1' }),
    );
  });

  it('validates variables when patch includes variables', async () => {
    // getScript (withOrgContext call 1) returns the existing script+template
    selectResultQueue.push([{ script: fakeScript, template: fakeTemplate }]);
    updateResultQueue.push([{ ...fakeScript, variables: fakeVariables }]);

    const { updateScript } = await import('./scripts');
    const result = await updateScript('org-1', 'user-1', 'script-1', {
      variables: fakeVariables,
    });

    expect(result.variables).toEqual(fakeVariables);
  });

  it('throws variable validation error when patching with invalid variables', async () => {
    selectResultQueue.push([{ script: fakeScript, template: fakeTemplate }]);

    const { updateScript } = await import('./scripts');
    await expect(
      updateScript('org-1', 'user-1', 'script-1', {
        variables: { dealership_name: '' }, // fails Zod: missing required fields
      }),
    ).rejects.toThrow('Variable validation failed');
  });

  it('throws script_not_found when getScript returns null during variable patch', async () => {
    selectResultQueue.push([]); // getScript returns null
    const { updateScript } = await import('./scripts');

    await expect(
      updateScript('org-1', 'user-1', 'script-missing', {
        variables: fakeVariables,
      }),
    ).rejects.toThrow('script_not_found');
  });
});

// ─── deleteScript ─────────────────────────────────────────────────────────────

describe('deleteScript', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQueues();
    mockTx.select.mockImplementation(() => {
      const result = selectResultQueue.shift() ?? [];
      return makeSelectChain(result);
    });
    mockTx.delete.mockImplementation(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve(deleteResultQueue.shift() ?? [])),
      })),
    }));
  });

  it('throws ScriptReferencedByCampaignError when active campaigns exist', async () => {
    selectResultQueue.push([{ id: 'campaign-1' }, { id: 'campaign-2' }]); // campaigns query
    const { deleteScript, ScriptReferencedByCampaignError } = await import('./scripts');

    const err = await deleteScript('org-1', 'user-1', 'script-1').catch((e) => e);
    expect(err).toBeInstanceOf(ScriptReferencedByCampaignError);
    expect(err.campaignIds).toEqual(['campaign-1', 'campaign-2']);
  });

  it('throws script_not_found when delete returns empty', async () => {
    selectResultQueue.push([]); // no active campaigns
    deleteResultQueue.push([]); // delete returns nothing (script not found)
    const { deleteScript } = await import('./scripts');

    await expect(deleteScript('org-1', 'user-1', 'script-missing')).rejects.toThrow(
      'script_not_found',
    );
  });

  it('deletes script and records audit when no active campaigns', async () => {
    selectResultQueue.push([]); // no active campaigns
    deleteResultQueue.push([{ id: 'script-1' }]);
    const { deleteScript } = await import('./scripts');

    await deleteScript('org-1', 'user-1', 'script-1');

    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ action: 'script.deleted', subjectId: 'script-1' }),
    );
  });
});

// ─── previewSystemPrompt ──────────────────────────────────────────────────────

describe('previewSystemPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQueues();
    mockTx.select.mockImplementation(() => {
      const result = selectResultQueue.shift() ?? [];
      return makeSelectChain(result);
    });
  });

  it('throws script_not_found when script does not exist', async () => {
    selectResultQueue.push([]); // getScript returns null
    const { previewSystemPrompt } = await import('./scripts');

    await expect(previewSystemPrompt('org-1', 'script-missing')).rejects.toThrow(
      'script_not_found',
    );
  });

  it('assembles system prompt with AI Act preamble', async () => {
    selectResultQueue.push([{ script: fakeScript, template: fakeTemplate }]);
    const { previewSystemPrompt } = await import('./scripts');

    const result = await previewSystemPrompt('org-1', 'script-1');

    // The assembled prompt must start with the AI Act preamble
    expect(result.systemPrompt).toContain(
      'assistente vocale automatico',
    );
    // It must contain the interpolated template body
    expect(result.systemPrompt).toContain('AutoRoma');
    expect(result.systemPrompt).toContain('Volkswagen');
  });

  it('returns interpolated first message', async () => {
    selectResultQueue.push([{ script: fakeScript, template: fakeTemplate }]);
    const { previewSystemPrompt } = await import('./scripts');

    const result = await previewSystemPrompt('org-1', 'script-1');

    expect(result.firstMessage).toContain('Luca'); // salesperson_first_name
    expect(result.firstMessage).toContain('AutoRoma'); // dealership_name
    expect(result.firstMessage).toContain('Volkswagen'); // brand
  });

  it('coerces array variables to comma-separated string', async () => {
    selectResultQueue.push([{ script: fakeScript, template: fakeTemplate }]);
    const { previewSystemPrompt } = await import('./scripts');

    const result = await previewSystemPrompt('org-1', 'script-1');

    // available_slots array should be joined
    expect(result.systemPrompt).toContain('15/06 10:00, 16/06 14:00');
  });
});

// ─── coerceVariablesToStrings (via previewSystemPrompt) ──────────────────────

describe('ScriptReferencedByCampaignError', () => {
  it('sets name and campaignIds correctly', async () => {
    const { ScriptReferencedByCampaignError } = await import('./scripts');
    const err = new ScriptReferencedByCampaignError(['c1', 'c2']);
    expect(err.name).toBe('ScriptReferencedByCampaignError');
    expect(err.campaignIds).toEqual(['c1', 'c2']);
    expect(err.message).toContain('2 active campaign');
  });
});

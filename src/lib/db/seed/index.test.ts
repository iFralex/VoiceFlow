import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the db client before importing seed functions.
// transaction must be mocked because seed functions use withSystemContext, which
// calls db.transaction. We pass insert and select mocks as the tx so that
// assertion helpers still work.
vi.mock('../client', () => {
  const insert = vi.fn();
  // select chain used by bumpScriptTemplate to look up the current max version
  const selectWhere = vi.fn().mockResolvedValue([{ maxVersion: 1 }]);
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  const select = vi.fn().mockReturnValue({ from: selectFrom });
  const transaction = vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn({ insert, select }));
  return { db: { insert, select, transaction } };
});

import { db } from '../client';
import { creditPackageSeedData } from './credit_packages';
import { bumpScriptTemplate, seed, seedCreditPackages, seedScriptTemplates } from './index';
import { scriptTemplateSeedData } from './script_templates';

function makeInsertChain() {
  const chain = {
    values: vi.fn(),
    onConflictDoUpdate: vi.fn().mockResolvedValue([]),
  };
  chain.values.mockReturnValue(chain);
  return chain;
}

describe('seed/index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('seedScriptTemplates', () => {
    it('inserts all five script templates', async () => {
      const chain = makeInsertChain();
      vi.mocked(db.insert).mockReturnValue(chain as never);

      await seedScriptTemplates();

      expect(db.insert).toHaveBeenCalledOnce();
      expect(chain.values).toHaveBeenCalledWith(scriptTemplateSeedData);
      expect(chain.onConflictDoUpdate).toHaveBeenCalledOnce();
    });

    it('uses onConflictDoUpdate (idempotent upsert)', async () => {
      const chain = makeInsertChain();
      vi.mocked(db.insert).mockReturnValue(chain as never);

      await seedScriptTemplates();

      const [conflictArg] = chain.onConflictDoUpdate.mock.calls[0] as [{ target: unknown; set: unknown }];
      expect(conflictArg).toHaveProperty('target');
      expect(conflictArg).toHaveProperty('set');
    });
  });

  describe('bumpScriptTemplate', () => {
    it('inserts a single bumped-version row for the given slug', async () => {
      const chain = makeInsertChain();
      vi.mocked(db.insert).mockReturnValue(chain as never);

      await bumpScriptTemplate('lead-reactivation');

      expect(db.insert).toHaveBeenCalledOnce();
      const [insertedRows] = chain.values.mock.calls[0] as [Array<{ slug: string; version: number }>];
      expect(insertedRows).toHaveLength(1);
      expect(insertedRows[0]!.slug).toBe('lead-reactivation');
      // Bumped version = base (1) + 1 = 2
      expect(insertedRows[0]!.version).toBe(2);
    });

    it('uses onConflictDoUpdate so bumping again is idempotent', async () => {
      const chain = makeInsertChain();
      vi.mocked(db.insert).mockReturnValue(chain as never);

      await bumpScriptTemplate('csi-survey');

      const [conflictArg] = chain.onConflictDoUpdate.mock.calls[0] as [{ target: unknown; set: unknown }];
      expect(conflictArg).toHaveProperty('target');
      expect(conflictArg).toHaveProperty('set');
    });

    it('throws for an unknown slug', async () => {
      await expect(bumpScriptTemplate('does-not-exist')).rejects.toThrow(
        'Unknown template slug "does-not-exist"',
      );
    });
  });

  describe('seedCreditPackages', () => {
    it('inserts all five credit packages', async () => {
      const chain = makeInsertChain();
      vi.mocked(db.insert).mockReturnValue(chain as never);

      await seedCreditPackages();

      expect(db.insert).toHaveBeenCalledOnce();
      expect(chain.values).toHaveBeenCalledWith(creditPackageSeedData);
      expect(chain.onConflictDoUpdate).toHaveBeenCalledOnce();
    });

    it('uses onConflictDoUpdate (idempotent upsert)', async () => {
      const chain = makeInsertChain();
      vi.mocked(db.insert).mockReturnValue(chain as never);

      await seedCreditPackages();

      const [conflictArg] = chain.onConflictDoUpdate.mock.calls[0] as [{ target: unknown; set: unknown }];
      expect(conflictArg).toHaveProperty('target');
      expect(conflictArg).toHaveProperty('set');
    });
  });

  describe('seed (orchestrator)', () => {
    it('calls seedScriptTemplates, seedCreditPackages, and seedVoiceCatalogue', async () => {
      const chain = makeInsertChain();
      vi.mocked(db.insert).mockReturnValue(chain as never);

      await seed();

      // insert is called once each for script_templates, credit_packages, and voice_catalogue
      expect(db.insert).toHaveBeenCalledTimes(3);
    });
  });
});

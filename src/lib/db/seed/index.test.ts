import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the db client before importing seed functions
vi.mock('../client', () => ({
  db: {
    insert: vi.fn(),
  },
}));

import { db } from '../client';
import { seed, seedCreditPackages, seedScriptTemplates } from './index';
import { creditPackageSeedData } from './credit_packages';
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
    it('calls both seedScriptTemplates and seedCreditPackages', async () => {
      const chain = makeInsertChain();
      vi.mocked(db.insert).mockReturnValue(chain as never);

      await seed();

      // insert is called once for script_templates and once for credit_packages
      expect(db.insert).toHaveBeenCalledTimes(2);
    });
  });
});

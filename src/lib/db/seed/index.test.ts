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
import {
  bumpScriptTemplate,
  seed,
  seedCreditPackages,
  seedPhoneNumbers,
  seedScriptTemplates,
} from './index';
import { phoneNumberSeedData } from './phone_numbers';
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

  describe('seedPhoneNumbers', () => {
    it('inserts the full CLI pool', async () => {
      const chain = makeInsertChain();
      vi.mocked(db.insert).mockReturnValue(chain as never);

      await seedPhoneNumbers();

      expect(db.insert).toHaveBeenCalledOnce();
      expect(chain.values).toHaveBeenCalledWith(phoneNumberSeedData);
      expect(chain.onConflictDoUpdate).toHaveBeenCalledOnce();
    });

    it('upserts on e164 and only refreshes provisioning metadata (not usage state)', async () => {
      const chain = makeInsertChain();
      vi.mocked(db.insert).mockReturnValue(chain as never);

      await seedPhoneNumbers();

      const [conflictArg] = chain.onConflictDoUpdate.mock.calls[0] as [
        { target: unknown; set: Record<string, unknown> },
      ];
      expect(conflictArg).toHaveProperty('target');
      const updatedKeys = Object.keys(conflictArg.set);
      expect(updatedKeys).toContain('provider');
      expect(updatedKeys).toContain('provider_external_id');
      expect(updatedKeys).toContain('region');
      expect(updatedKeys).toContain('capabilities');
      // Usage / lifecycle state must NOT be touched on re-seed.
      expect(updatedKeys).not.toContain('status');
      expect(updatedKeys).not.toContain('daily_call_count');
      expect(updatedKeys).not.toContain('spam_score');
      expect(updatedKeys).not.toContain('last_used_at');
    });

    it('preserves a founder-populated provider_external_id when re-seeding (COALESCE)', async () => {
      const chain = makeInsertChain();
      vi.mocked(db.insert).mockReturnValue(chain as never);

      await seedPhoneNumbers();

      const [conflictArg] = chain.onConflictDoUpdate.mock.calls[0] as [
        { target: unknown; set: Record<string, unknown> },
      ];
      // The set clause for provider_external_id must be a SQL fragment
      // referencing COALESCE so an existing non-null value is preserved.
      // Drizzle SQL fragments have circular references, so traverse the
      // queryChunks array directly and look for the COALESCE token.
      const expr = conflictArg.set['provider_external_id'] as {
        queryChunks?: Array<unknown>;
      };
      const chunks = expr?.queryChunks ?? [];
      const flat = chunks
        .map((c) =>
          typeof c === 'string'
            ? c
            : (c as { value?: string[] }).value?.join(' ') ?? '',
        )
        .join(' ');
      expect(flat.toUpperCase()).toContain('COALESCE');
    });
  });

  describe('seed (orchestrator)', () => {
    it('calls seedScriptTemplates, seedCreditPackages, seedVoiceCatalogue, and seedPhoneNumbers', async () => {
      const chain = makeInsertChain();
      vi.mocked(db.insert).mockReturnValue(chain as never);

      await seed();

      // insert is called once each for script_templates, credit_packages,
      // voice_catalogue, and phone_numbers.
      expect(db.insert).toHaveBeenCalledTimes(4);
    });
  });
});

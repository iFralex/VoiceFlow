import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockGetAuthContext = vi.fn().mockResolvedValue({
  userId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
  orgId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',
  role: 'owner',
});

vi.mock('@/lib/auth/context', () => ({
  getAuthContext: () => mockGetAuthContext(),
}));

const mockCreatePat = vi.fn();
const mockRevokePat = vi.fn();
const mockListPats = vi.fn().mockResolvedValue([]);

vi.mock('@/lib/services/pat', () => ({
  createPat: (...args: unknown[]) => mockCreatePat(...args),
  revokePat: (...args: unknown[]) => mockRevokePat(...args),
  listPats: (...args: unknown[]) => mockListPats(...args),
}));

const mockRevalidatePath = vi.fn();
vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';
const PAT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003';

import { createPatAction, revokePatAction } from './pat';

describe('PAT server actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthContext.mockResolvedValue({ userId: USER_ID, orgId: ORG_ID, role: 'owner' });
  });

  // ── createPatAction ───────────────────────────────────────────────────────

  describe('createPatAction', () => {
    it('returns ok with rawToken on success', async () => {
      const pat = {
        id: PAT_ID,
        name: 'My Token',
        prefix: 'vx_abc123',
        scopes: ['api'],
        created_at: new Date(),
        user_id: USER_ID,
        org_id: ORG_ID,
        token_hash: 'hash',
        last_used_at: null,
        expires_at: null,
        revoked_at: null,
      };
      mockCreatePat.mockResolvedValue({ pat, rawToken: 'vx_abc123456789012345678901234567890abc' });

      const result = await createPatAction({ name: 'My Token', scopes: ['api'] });

      expect(result.ok).toBe(true);
      expect(result.rawToken).toBe('vx_abc123456789012345678901234567890abc');
      expect(mockRevalidatePath).toHaveBeenCalledWith('/settings/integrations');
    });

    it('returns error for empty name', async () => {
      const result = await createPatAction({ name: '', scopes: ['api'] });

      expect(result.ok).toBe(false);
      expect(mockCreatePat).not.toHaveBeenCalled();
    });

    it('returns error for empty scopes', async () => {
      const result = await createPatAction({ name: 'My Token', scopes: [] });

      expect(result.ok).toBe(false);
      expect(mockCreatePat).not.toHaveBeenCalled();
    });

    it('returns error when service throws', async () => {
      mockCreatePat.mockRejectedValue(new Error('db_error'));

      const result = await createPatAction({ name: 'Token', scopes: ['api'] });

      expect(result.ok).toBe(false);
      expect(result.message).toBe('db_error');
    });
  });

  // ── revokePatAction ───────────────────────────────────────────────────────

  describe('revokePatAction', () => {
    it('returns ok on successful revocation', async () => {
      mockRevokePat.mockResolvedValue(undefined);

      const result = await revokePatAction({ patId: PAT_ID });

      expect(result.ok).toBe(true);
      expect(mockRevokePat).toHaveBeenCalledWith(PAT_ID, USER_ID, ORG_ID);
      expect(mockRevalidatePath).toHaveBeenCalledWith('/settings/integrations');
    });

    it('returns error for invalid UUID', async () => {
      const result = await revokePatAction({ patId: 'not-a-uuid' });

      expect(result.ok).toBe(false);
      expect(mockRevokePat).not.toHaveBeenCalled();
    });

    it('returns error when service throws', async () => {
      mockRevokePat.mockRejectedValue(new Error('pat_not_found'));

      const result = await revokePatAction({ patId: PAT_ID });

      expect(result.ok).toBe(false);
      expect(result.message).toBe('pat_not_found');
    });
  });
});

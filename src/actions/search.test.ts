import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetAuthContext,
  mockHasCapability,
  mockSearchPalette,
} = vi.hoisted(() => ({
  mockGetAuthContext: vi.fn(),
  mockHasCapability: vi.fn(),
  mockSearchPalette: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  getAuthContext: mockGetAuthContext,
  hasCapability: mockHasCapability,
}));

vi.mock('@/lib/services/search', () => ({
  searchPalette: mockSearchPalette,
}));

import { searchPaletteAction } from './search';

const ORG_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';

beforeEach(() => {
  mockGetAuthContext.mockReset();
  mockHasCapability.mockReset();
  mockSearchPalette.mockReset();
  mockGetAuthContext.mockResolvedValue({ userId: 'u-1', orgId: ORG_ID, role: 'owner' });
  mockHasCapability.mockReturnValue(true);
  mockSearchPalette.mockResolvedValue({ contacts: [], campaigns: [], scripts: [] });
});

describe('searchPaletteAction', () => {
  it('rejects an empty query', async () => {
    const res = await searchPaletteAction({ query: '' });
    expect(res.ok).toBe(false);
    expect(mockSearchPalette).not.toHaveBeenCalled();
  });

  it('rejects an over-long query', async () => {
    const res = await searchPaletteAction({ query: 'a'.repeat(101) });
    expect(res.ok).toBe(false);
    expect(mockSearchPalette).not.toHaveBeenCalled();
  });

  it('forwards every group when the role has all capabilities', async () => {
    mockHasCapability.mockReturnValue(true);

    const res = await searchPaletteAction({ query: 'mario' });

    expect(res.ok).toBe(true);
    expect(mockSearchPalette).toHaveBeenCalledWith(ORG_ID, 'mario', {
      contacts: true,
      campaigns: true,
      scripts: true,
    });
  });

  it('disables groups whose capability is missing', async () => {
    mockHasCapability.mockImplementation((_role: unknown, capability: string) => {
      // Simulate a viewer: only campaigns.view is available.
      return capability === 'campaigns.view';
    });

    await searchPaletteAction({ query: 'mario' });

    expect(mockSearchPalette).toHaveBeenCalledWith(ORG_ID, 'mario', {
      contacts: false,
      campaigns: true,
      scripts: false,
    });
  });

  it('returns a failed result when the auth context throws', async () => {
    mockGetAuthContext.mockRejectedValueOnce(new Error('no auth'));
    const res = await searchPaletteAction({ query: 'mario' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toBe('no auth');
    }
  });

  it('returns the service results unchanged on success', async () => {
    mockSearchPalette.mockResolvedValueOnce({
      contacts: [
        {
          id: 'c-1',
          firstName: 'Mario',
          lastName: 'Rossi',
          phone: '+393331234567',
          contactListId: 'list-1',
        },
      ],
      campaigns: [{ id: 'cmp-1', name: 'Lead reactivation', status: 'running' }],
      scripts: [{ id: 's-1', name: 'Lead reactivation' }],
    });

    const res = await searchPaletteAction({ query: 'mario' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.results.contacts).toHaveLength(1);
      expect(res.results.campaigns).toHaveLength(1);
      expect(res.results.scripts).toHaveLength(1);
    }
  });
});

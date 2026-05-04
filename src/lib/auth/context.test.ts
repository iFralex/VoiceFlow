/**
 * Unit tests for role → capability mapping and auth context helpers.
 *
 * Tests cover every role × capability combination so regressions in the
 * permission table are caught immediately.
 */

import { headers } from 'next/headers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MemberRole } from '@/types';

import type { Capability } from './context';
import { getAuthContext, hasCapability, requireCapability } from './context';

vi.mock('next/headers', () => ({
  headers: vi.fn(),
}));

// ─── hasCapability ────────────────────────────────────────────────────────────

describe('hasCapability', () => {
  // All capabilities that exist
  const ALL: Capability[] = [
    'org.manage',
    'org.update',
    'members.invite',
    'members.update_role',
    'billing.topup',
    'billing.view',
    'campaigns.launch',
    'campaigns.view',
    'contacts.upload',
    'contacts.delete',
    'scripts.edit',
    'compliance.export',
    'compliance.erase',
    'audit.view',
  ];

  describe('owner', () => {
    it('has all capabilities', () => {
      for (const cap of ALL) {
        expect(hasCapability('owner', cap), `owner missing ${cap}`).toBe(true);
      }
    });
  });

  describe('admin', () => {
    it('has all capabilities except org.manage', () => {
      for (const cap of ALL) {
        if (cap === 'org.manage') {
          expect(hasCapability('admin', cap), `admin should NOT have ${cap}`).toBe(false);
        } else {
          expect(hasCapability('admin', cap), `admin missing ${cap}`).toBe(true);
        }
      }
    });
  });

  describe('operator', () => {
    const OPERATOR_CAPS: Capability[] = [
      'campaigns.launch',
      'campaigns.view',
      'contacts.upload',
      'scripts.edit',
      'billing.view',
    ];

    it('has the expected capabilities', () => {
      for (const cap of OPERATOR_CAPS) {
        expect(hasCapability('operator', cap), `operator missing ${cap}`).toBe(true);
      }
    });

    it('does not have privileged capabilities', () => {
      const denied: Capability[] = [
        'org.manage',
        'org.update',
        'members.invite',
        'members.update_role',
        'billing.topup',
        'contacts.delete',
        'compliance.export',
        'compliance.erase',
        'audit.view',
      ];
      for (const cap of denied) {
        expect(hasCapability('operator', cap), `operator should NOT have ${cap}`).toBe(false);
      }
    });
  });

  describe('viewer', () => {
    const VIEWER_CAPS: Capability[] = ['billing.view', 'campaigns.view', 'audit.view'];

    it('has read-only view capabilities', () => {
      for (const cap of VIEWER_CAPS) {
        expect(hasCapability('viewer', cap), `viewer missing ${cap}`).toBe(true);
      }
    });

    it('does not have any mutating capabilities', () => {
      const denied: Capability[] = [
        'org.manage',
        'org.update',
        'members.invite',
        'members.update_role',
        'billing.topup',
        'campaigns.launch',
        'contacts.upload',
        'contacts.delete',
        'scripts.edit',
        'compliance.export',
        'compliance.erase',
      ];
      for (const cap of denied) {
        expect(hasCapability('viewer', cap), `viewer should NOT have ${cap}`).toBe(false);
      }
    });
  });

  it('exhaustive: every role × capability combination is deterministic', () => {
    const roles: MemberRole[] = ['owner', 'admin', 'operator', 'viewer'];
    for (const role of roles) {
      for (const cap of ALL) {
        // hasCapability should always return a boolean, never undefined/null
        const result = hasCapability(role, cap);
        expect(typeof result).toBe('boolean');
      }
    }
  });
});

// ─── getAuthContext ───────────────────────────────────────────────────────────

describe('getAuthContext', () => {
  const mockHeaders = vi.mocked(headers);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns userId, orgId and role from request headers', async () => {
    mockHeaders.mockResolvedValue({
      get: (key: string) => {
        const map: Record<string, string> = {
          'x-user-id': 'user-123',
          'x-org-id': 'org-456',
          'x-member-role': 'admin',
        };
        return map[key] ?? null;
      },
    } as ReturnType<typeof headers> extends Promise<infer T> ? T : never);

    const ctx = await getAuthContext();
    expect(ctx).toEqual({ userId: 'user-123', orgId: 'org-456', role: 'admin' });
  });

  it('throws when x-user-id header is missing', async () => {
    mockHeaders.mockResolvedValue({
      get: (key: string) => {
        if (key === 'x-org-id') return 'org-456';
        if (key === 'x-member-role') return 'viewer';
        return null;
      },
    } as ReturnType<typeof headers> extends Promise<infer T> ? T : never);

    await expect(getAuthContext()).rejects.toThrow('Auth context headers are missing');
  });

  it('throws when x-org-id header is missing', async () => {
    mockHeaders.mockResolvedValue({
      get: (key: string) => {
        if (key === 'x-user-id') return 'user-123';
        if (key === 'x-member-role') return 'owner';
        return null;
      },
    } as ReturnType<typeof headers> extends Promise<infer T> ? T : never);

    await expect(getAuthContext()).rejects.toThrow('Auth context headers are missing');
  });

  it('throws when x-member-role header is missing', async () => {
    mockHeaders.mockResolvedValue({
      get: (key: string) => {
        if (key === 'x-user-id') return 'user-123';
        if (key === 'x-org-id') return 'org-456';
        return null;
      },
    } as ReturnType<typeof headers> extends Promise<infer T> ? T : never);

    await expect(getAuthContext()).rejects.toThrow('Auth context headers are missing');
  });
});

// ─── requireCapability ────────────────────────────────────────────────────────

describe('requireCapability', () => {
  const mockHeaders = vi.mocked(headers);

  function makeHeaders(role: MemberRole) {
    return {
      get: (key: string) => {
        const map: Record<string, string> = {
          'x-user-id': 'user-123',
          'x-org-id': 'org-456',
          'x-member-role': role,
        };
        return map[key] ?? null;
      },
    } as ReturnType<typeof headers> extends Promise<infer T> ? T : never;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves when the role has the capability', async () => {
    mockHeaders.mockResolvedValue(makeHeaders('owner'));
    await expect(requireCapability('org.manage')).resolves.toBeUndefined();
  });

  it('throws when the role lacks the capability', async () => {
    mockHeaders.mockResolvedValue(makeHeaders('viewer'));
    await expect(requireCapability('org.manage')).rejects.toThrow(
      "role 'viewer' does not have capability 'org.manage'",
    );
  });

  it('admin cannot use org.manage', async () => {
    mockHeaders.mockResolvedValue(makeHeaders('admin'));
    await expect(requireCapability('org.manage')).rejects.toThrow('Forbidden');
  });

  it('operator can launch campaigns', async () => {
    mockHeaders.mockResolvedValue(makeHeaders('operator'));
    await expect(requireCapability('campaigns.launch')).resolves.toBeUndefined();
  });

  it('viewer cannot launch campaigns', async () => {
    mockHeaders.mockResolvedValue(makeHeaders('viewer'));
    await expect(requireCapability('campaigns.launch')).rejects.toThrow('Forbidden');
  });
});

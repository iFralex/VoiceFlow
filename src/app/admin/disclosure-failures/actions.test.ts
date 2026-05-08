import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockUpdateDisclosureTriage, mockRevalidatePath, VALID_TOKEN } = vi.hoisted(() => {
  const mockUpdateDisclosureTriage = vi.fn();
  const mockRevalidatePath = vi.fn();
  const VALID_TOKEN = 'test-admin-token-32-chars-minimum!!';
  return { mockUpdateDisclosureTriage, mockRevalidatePath, VALID_TOKEN };
});

vi.mock('@/lib/env', () => ({
  env: { INTERNAL_ADMIN_TOKEN: VALID_TOKEN },
}));

vi.mock('@/lib/compliance/aiact/triage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/compliance/aiact/triage')>(
    '@/lib/compliance/aiact/triage',
  );
  return {
    ...actual,
    updateDisclosureTriage: mockUpdateDisclosureTriage,
  };
});

vi.mock('next/cache', () => ({
  revalidatePath: mockRevalidatePath,
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { triageDisclosureFailureAction } from './actions';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CALL_ID = 'cccccccc-cccc-4ccc-8ccc-000000000001';
const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';

function makeForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set('token', VALID_TOKEN);
  fd.set('callId', CALL_ID);
  fd.set('status', 'reviewed');
  fd.set('note', 'looked good');
  fd.set('actor', 'founder');
  fd.set('filterStatus', 'pending');
  for (const [k, v] of Object.entries(overrides)) {
    fd.set(k, v);
  }
  return fd;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('triageDisclosureFailureAction', () => {
  beforeEach(() => {
    mockUpdateDisclosureTriage.mockReset();
    mockRevalidatePath.mockReset();
  });

  it('rejects when the admin token is missing', async () => {
    const fd = makeForm();
    fd.delete('token');
    const result = await triageDisclosureFailureAction(fd);
    expect(result.ok).toBe(false);
    expect(result.message).toBe('Unauthorized');
    expect(mockUpdateDisclosureTriage).not.toHaveBeenCalled();
  });

  it('rejects when the admin token is wrong', async () => {
    const result = await triageDisclosureFailureAction(makeForm({ token: 'nope' }));
    expect(result.ok).toBe(false);
    expect(result.message).toBe('Unauthorized');
    expect(mockUpdateDisclosureTriage).not.toHaveBeenCalled();
  });

  it('rejects when status is not in the allowed set', async () => {
    const result = await triageDisclosureFailureAction(makeForm({ status: 'archived' }));
    expect(result.ok).toBe(false);
    expect(result.message).toBe('Invalid status');
    expect(mockUpdateDisclosureTriage).not.toHaveBeenCalled();
  });

  it('rejects when callId is empty', async () => {
    const result = await triageDisclosureFailureAction(makeForm({ callId: '' }));
    expect(result.ok).toBe(false);
    expect(result.message).toBe('Missing callId');
    expect(mockUpdateDisclosureTriage).not.toHaveBeenCalled();
  });

  it('forwards to updateDisclosureTriage and revalidates the page on success', async () => {
    mockUpdateDisclosureTriage.mockResolvedValueOnce({ ok: true, orgId: ORG_ID });

    const result = await triageDisclosureFailureAction(makeForm());
    expect(result).toEqual({ ok: true, message: 'Updated' });
    expect(mockUpdateDisclosureTriage).toHaveBeenCalledWith({
      callId: CALL_ID,
      status: 'reviewed',
      note: 'looked good',
      actor: 'founder',
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith('/admin/disclosure-failures');
  });

  it('surfaces a not-found result from the helper', async () => {
    mockUpdateDisclosureTriage.mockResolvedValueOnce({ ok: false, reason: 'not_found' });

    const result = await triageDisclosureFailureAction(makeForm());
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not found/i);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});

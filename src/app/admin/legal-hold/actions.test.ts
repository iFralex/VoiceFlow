import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockSetLegalHold, VALID_TOKEN } = vi.hoisted(() => {
  const mockSetLegalHold = vi.fn();
  const VALID_TOKEN = 'test-admin-token-32-chars-minimum!!';
  return { mockSetLegalHold, VALID_TOKEN };
});

vi.mock('@/lib/env', () => ({
  env: { INTERNAL_ADMIN_TOKEN: VALID_TOKEN },
}));

vi.mock('@/lib/compliance/legal-hold', async () => {
  const actual = await vi.importActual<typeof import('@/lib/compliance/legal-hold')>(
    '@/lib/compliance/legal-hold',
  );
  return {
    ...actual,
    setLegalHold: mockSetLegalHold,
  };
});

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { ContactNotFoundError } from '@/lib/compliance/legal-hold';

import { setLegalHoldAction } from './actions';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const CONTACT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
const UNTIL_ISO = '2027-01-01T00:00:00.000Z';

function makeForm(overrides: Record<string, string | null> = {}): FormData {
  const fd = new FormData();
  fd.set('token', VALID_TOKEN);
  fd.set('orgId', ORG_ID);
  fd.set('contactId', CONTACT_ID);
  fd.set('untilDate', UNTIL_ISO);
  fd.set('reason', 'Litigation hold #2026-04-12 — DPO request');
  fd.set('actor', 'founder@example.com');
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) {
      fd.delete(k);
    } else {
      fd.set(k, v);
    }
  }
  return fd;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('setLegalHoldAction', () => {
  beforeEach(() => {
    mockSetLegalHold.mockReset();
  });

  it('rejects when the admin token is missing', async () => {
    const result = await setLegalHoldAction(makeForm({ token: null }));
    expect(result.ok).toBe(false);
    expect(result.message).toBe('Unauthorized');
    expect(mockSetLegalHold).not.toHaveBeenCalled();
  });

  it('rejects when the admin token does not match', async () => {
    const result = await setLegalHoldAction(makeForm({ token: 'wrong-token' }));
    expect(result.ok).toBe(false);
    expect(result.message).toBe('Unauthorized');
    expect(mockSetLegalHold).not.toHaveBeenCalled();
  });

  it('rejects when orgId is missing', async () => {
    const result = await setLegalHoldAction(makeForm({ orgId: '' }));
    expect(result.ok).toBe(false);
    expect(result.message).toBe('Missing orgId');
  });

  it('rejects when contactId is missing', async () => {
    const result = await setLegalHoldAction(makeForm({ contactId: '' }));
    expect(result.ok).toBe(false);
    expect(result.message).toBe('Missing contactId');
  });

  it('rejects when reason is blank', async () => {
    const result = await setLegalHoldAction(makeForm({ reason: '   ' }));
    expect(result.ok).toBe(false);
    expect(result.message).toBe('Missing reason');
  });

  it('rejects when untilDate is unparseable', async () => {
    const result = await setLegalHoldAction(makeForm({ untilDate: 'not-a-date' }));
    expect(result.ok).toBe(false);
    expect(result.message).toBe('Invalid untilDate');
  });

  it('applies a hold and returns the new value when given a future date', async () => {
    const until = new Date(UNTIL_ISO);
    mockSetLegalHold.mockResolvedValueOnce({
      contactId: CONTACT_ID,
      orgId: ORG_ID,
      previousLegalHoldUntil: null,
      legalHoldUntil: until,
    });

    const result = await setLegalHoldAction(makeForm());

    expect(result.ok).toBe(true);
    expect(result.message).toBe('Hold applied');
    expect(result.data).toEqual({
      contactId: CONTACT_ID,
      orgId: ORG_ID,
      legalHoldUntil: UNTIL_ISO,
      previousLegalHoldUntil: null,
    });
    expect(mockSetLegalHold).toHaveBeenCalledWith({
      orgId: ORG_ID,
      contactId: CONTACT_ID,
      untilDate: until,
      reason: 'Litigation hold #2026-04-12 — DPO request',
      actor: 'founder@example.com',
    });
  });

  it('clears a hold when untilDate is empty', async () => {
    mockSetLegalHold.mockResolvedValueOnce({
      contactId: CONTACT_ID,
      orgId: ORG_ID,
      previousLegalHoldUntil: new Date(UNTIL_ISO),
      legalHoldUntil: null,
    });

    const result = await setLegalHoldAction(makeForm({ untilDate: '' }));

    expect(result.ok).toBe(true);
    expect(result.message).toBe('Hold cleared');
    expect(mockSetLegalHold).toHaveBeenCalledWith(
      expect.objectContaining({ untilDate: null }),
    );
  });

  it('surfaces ContactNotFoundError as a not-found message', async () => {
    mockSetLegalHold.mockRejectedValueOnce(new ContactNotFoundError(ORG_ID, CONTACT_ID));
    const result = await setLegalHoldAction(makeForm());
    expect(result.ok).toBe(false);
    expect(result.message).toBe('Contact not found');
  });
});

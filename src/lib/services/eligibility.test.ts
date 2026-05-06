import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── DB mock ──────────────────────────────────────────────────────────────────

let selectResults: unknown[][] = [];

function makeSelectChain(result: unknown[]) {
  const chain: Record<string, (...args: unknown[]) => typeof chain> & {
    then?: unknown;
  } = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    groupBy: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
  };
  (chain as Record<string, unknown>).then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

const mockTx = {
  select: vi.fn(),
};

function resetMockTx() {
  mockTx.select.mockImplementation(() => {
    const result = selectResults.shift() ?? [];
    return makeSelectChain(result);
  });
}

vi.mock('@/lib/db/context', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn(mockTx),
  ),
}));

// ─── Import under test ────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  selectResults = [];
  resetMockTx();
});

const ORG_ID = 'org-1';
const CAMPAIGN_ID = 'campaign-1';
const LIST_ID = 'list-1';

const CONTACT = {
  id: 'contact-1',
  phone_e164: '+39012345678',
};

describe('findEligibleContactsForCampaign', () => {
  it('returns empty array when campaign not found', async () => {
    selectResults = [[]]; // campaign select returns nothing

    const { findEligibleContactsForCampaign } = await import('./eligibility');
    const result = await findEligibleContactsForCampaign(ORG_ID, CAMPAIGN_ID);
    expect(result).toEqual([]);
  });

  it('returns eligible contacts on first launch (attemptNumber=1)', async () => {
    selectResults = [
      [{ contact_list_id: LIST_ID }], // campaign
      [],                              // recent terminal calls (none)
      [CONTACT],                       // eligible contacts
      [],                              // call count rows (no previous calls)
    ];

    const { findEligibleContactsForCampaign } = await import('./eligibility');
    const result = await findEligibleContactsForCampaign(ORG_ID, CAMPAIGN_ID);

    expect(result).toEqual([
      {
        contactId: 'contact-1',
        phoneE164: '+39012345678',
        attemptNumber: 1,
      },
    ]);
  });

  it('returns attemptNumber=2 when one previous call exists', async () => {
    selectResults = [
      [{ contact_list_id: LIST_ID }],
      [],                              // no recent terminal calls
      [CONTACT],                       // eligible contacts
      [{ contact_id: 'contact-1', cnt: 1 }], // 1 previous call
    ];

    const { findEligibleContactsForCampaign } = await import('./eligibility');
    const result = await findEligibleContactsForCampaign(ORG_ID, CAMPAIGN_ID);

    expect(result).toHaveLength(1);
    expect(result[0]!.attemptNumber).toBe(2);
  });

  it('filters out contacts with recent terminal calls (48h cooldown)', async () => {
    selectResults = [
      [{ contact_list_id: LIST_ID }],
      // recent terminal call row → this contact will be excluded
      [{ contact_id: 'contact-1' }],
      // eligible contacts (after exclusion applied) — empty because contact-1 was excluded
      [],
    ];

    const { findEligibleContactsForCampaign } = await import('./eligibility');
    const result = await findEligibleContactsForCampaign(ORG_ID, CAMPAIGN_ID);

    // No call-count query because eligibleRows is empty
    expect(result).toEqual([]);
  });

  it('returns empty array when no contacts pass the eligibility filter', async () => {
    selectResults = [
      [{ contact_list_id: LIST_ID }],
      [],       // no recent terminal calls
      [],       // no eligible contacts (all filtered by SQL conditions)
    ];

    const { findEligibleContactsForCampaign } = await import('./eligibility');
    const result = await findEligibleContactsForCampaign(ORG_ID, CAMPAIGN_ID);

    expect(result).toEqual([]);
    // call-count query should NOT run when there are no eligible contacts
    expect(mockTx.select).toHaveBeenCalledTimes(3);
  });

  it('returns multiple contacts ordered by the result order', async () => {
    const contact2 = { id: 'contact-2', phone_e164: '+39099999999' };
    selectResults = [
      [{ contact_list_id: LIST_ID }],
      [],                   // no recent terminal calls
      [CONTACT, contact2],  // two eligible contacts
      [],                   // no previous calls → both at attempt 1
    ];

    const { findEligibleContactsForCampaign } = await import('./eligibility');
    const result = await findEligibleContactsForCampaign(ORG_ID, CAMPAIGN_ID);

    expect(result).toHaveLength(2);
    expect(result[0]!.contactId).toBe('contact-1');
    expect(result[1]!.contactId).toBe('contact-2');
    expect(result[0]!.attemptNumber).toBe(1);
    expect(result[1]!.attemptNumber).toBe(1);
  });

  it('excludes contacts that have already used all 3 attempts (spec §10.2)', async () => {
    const contact2 = { id: 'contact-2', phone_e164: '+39099999999' };
    selectResults = [
      [{ contact_list_id: LIST_ID }],
      [],
      [CONTACT, contact2],
      [
        { contact_id: 'contact-1', cnt: 3 }, // already at MAX_RETRY_ATTEMPTS
        { contact_id: 'contact-2', cnt: 0 }, // first attempt
      ],
    ];

    const { findEligibleContactsForCampaign } = await import('./eligibility');
    const result = await findEligibleContactsForCampaign(ORG_ID, CAMPAIGN_ID);

    expect(result).toHaveLength(1);
    expect(result[0]!.contactId).toBe('contact-2');
    expect(result[0]!.attemptNumber).toBe(1);
  });

  it('assigns different attempt numbers per contact based on existing call counts', async () => {
    const contact2 = { id: 'contact-2', phone_e164: '+39099999999' };
    selectResults = [
      [{ contact_list_id: LIST_ID }],
      [],
      [CONTACT, contact2],
      [
        { contact_id: 'contact-1', cnt: 2 }, // contact-1 had 2 previous calls
        { contact_id: 'contact-2', cnt: 0 }, // contact-2 had 0
      ],
    ];

    const { findEligibleContactsForCampaign } = await import('./eligibility');
    const result = await findEligibleContactsForCampaign(ORG_ID, CAMPAIGN_ID);

    expect(result).toHaveLength(2);
    const c1 = result.find((r) => r.contactId === 'contact-1');
    const c2 = result.find((r) => r.contactId === 'contact-2');
    expect(c1!.attemptNumber).toBe(3);
    expect(c2!.attemptNumber).toBe(1);
  });
});

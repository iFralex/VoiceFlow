import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRecordAudit = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/db/audit', () => ({
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

let selectResults: unknown[][] = [];
const insertOnConflictDoUpdate = vi.fn();

const mockTx = {
  select: vi.fn(),
  insert: vi.fn(),
};

function resetMockTx() {
  mockTx.select.mockImplementation(() => {
    const result = selectResults.shift() ?? [];
    return {
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(result),
      })),
    };
  });

  mockTx.insert.mockImplementation(() => ({
    values: vi.fn(() => ({
      onConflictDoUpdate: insertOnConflictDoUpdate.mockResolvedValue(undefined),
    })),
  }));
}

vi.mock('@/lib/db/context', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
  withSystemContext: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
}));

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  filterRecipientsByPreference,
  getNotificationPreferences,
  updateNotificationPreferences,
} from './notification-preferences';

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';

beforeEach(() => {
  vi.clearAllMocks();
  selectResults = [];
  insertOnConflictDoUpdate.mockReset();
  resetMockTx();
});

describe('getNotificationPreferences', () => {
  it('returns defaults when no row exists', async () => {
    selectResults.push([]);

    const prefs = await getNotificationPreferences(USER_ID, ORG_ID);

    expect(prefs).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it('reads stored prefs from the row', async () => {
    selectResults.push([
      {
        user_id: USER_ID,
        org_id: ORG_ID,
        daily_report: false,
        appointment_booked: true,
        qualified_lead: false,
        low_credit: true,
        campaign_completed: false,
        weekly_summary: true,
      },
    ]);

    const prefs = await getNotificationPreferences(USER_ID, ORG_ID);

    expect(prefs).toEqual({
      daily_report: false,
      appointment_booked: true,
      qualified_lead: false,
      low_credit: true,
      campaign_completed: false,
      weekly_summary: true,
    });
  });
});

describe('updateNotificationPreferences', () => {
  it('upserts merged prefs and audits the change', async () => {
    selectResults.push([]); // no existing row → defaults

    const result = await updateNotificationPreferences(USER_ID, ORG_ID, {
      daily_report: false,
    });

    expect(result.daily_report).toBe(false);
    // Other keys stay at defaults
    expect(result.appointment_booked).toBe(DEFAULT_NOTIFICATION_PREFERENCES.appointment_booked);
    expect(insertOnConflictDoUpdate).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        action: 'notification_preferences.updated',
        actorUserId: USER_ID,
        metadata: { changed: ['daily_report'] },
      }),
    );
  });

  it('preserves existing stored values when update is partial', async () => {
    selectResults.push([
      {
        user_id: USER_ID,
        org_id: ORG_ID,
        daily_report: true,
        appointment_booked: false,
        qualified_lead: true,
        low_credit: false,
        campaign_completed: true,
        weekly_summary: false,
      },
    ]);

    const result = await updateNotificationPreferences(USER_ID, ORG_ID, {
      weekly_summary: true,
    });

    expect(result).toEqual({
      daily_report: true,
      appointment_booked: false,
      qualified_lead: true,
      low_credit: false,
      campaign_completed: true,
      weekly_summary: true,
    });
  });
});

describe('filterRecipientsByPreference', () => {
  it('returns the candidate list when none have stored prefs (defaults apply)', async () => {
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([]),
        })),
      })),
    };

    const result = await filterRecipientsByPreference(
      tx as unknown as Parameters<typeof filterRecipientsByPreference>[0],
      ORG_ID,
      ['u1', 'u2', 'u3'],
      'daily_report',
    );

    expect(result).toEqual(['u1', 'u2', 'u3']);
  });

  it('filters out users whose stored pref is false', async () => {
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([
            { user_id: 'u1', enabled: false },
            { user_id: 'u2', enabled: true },
          ]),
        })),
      })),
    };

    const result = await filterRecipientsByPreference(
      tx as unknown as Parameters<typeof filterRecipientsByPreference>[0],
      ORG_ID,
      ['u1', 'u2', 'u3'],
      'daily_report',
    );

    // u1 opted out, u2 explicitly opted in, u3 has no row → defaults to true
    expect(result).toEqual(['u2', 'u3']);
  });

  it('uses the default false for weekly_summary when no row exists', async () => {
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([]),
        })),
      })),
    };

    const result = await filterRecipientsByPreference(
      tx as unknown as Parameters<typeof filterRecipientsByPreference>[0],
      ORG_ID,
      ['u1', 'u2'],
      'weekly_summary',
    );

    expect(result).toEqual([]);
  });

  it('returns empty when candidate list is empty without hitting the db', async () => {
    const tx = { select: vi.fn() };

    const result = await filterRecipientsByPreference(
      tx as unknown as Parameters<typeof filterRecipientsByPreference>[0],
      ORG_ID,
      [],
      'daily_report',
    );

    expect(result).toEqual([]);
    expect(tx.select).not.toHaveBeenCalled();
  });
});

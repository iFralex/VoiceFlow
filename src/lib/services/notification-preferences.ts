/**
 * Per-user notification preferences (plan 12 task 10).
 *
 * Each user has one row per organisation toggling which notifications they
 * want to receive about that org. The defaults match the daily-report cron's
 * pre-existing behaviour: every notification is opt-in by default except
 * the `weekly_summary` digest, which we ship later.
 *
 * Reads/writes the row through `withOrgContext` so RLS pins the row to the
 * current org and the user's own user_id. The cron dispatcher reads via
 * `listOrgRecipientsWithPrefs` (system context) since it crosses orgs.
 */
import { and, eq, sql } from 'drizzle-orm';

import { recordAudit } from '@/lib/db/audit';
import { type DbTx, withOrgContext } from '@/lib/db/context';
import { userNotificationPreferences } from '@/lib/db/schema';

export const NOTIFICATION_KEYS = [
  'daily_report',
  'appointment_booked',
  'qualified_lead',
  'low_credit',
  'campaign_completed',
  'weekly_summary',
] as const;

export type NotificationKey = (typeof NOTIFICATION_KEYS)[number];

export type NotificationPreferences = Record<NotificationKey, boolean>;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  daily_report: true,
  appointment_booked: true,
  qualified_lead: true,
  low_credit: true,
  campaign_completed: true,
  weekly_summary: false,
};

function rowToPrefs(
  row: typeof userNotificationPreferences.$inferSelect | undefined,
): NotificationPreferences {
  if (!row) return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  return {
    daily_report: row.daily_report,
    appointment_booked: row.appointment_booked,
    qualified_lead: row.qualified_lead,
    low_credit: row.low_credit,
    campaign_completed: row.campaign_completed,
    weekly_summary: row.weekly_summary,
  };
}

/**
 * Returns the user's preferences for the given org. If no row exists yet,
 * returns {@link DEFAULT_NOTIFICATION_PREFERENCES}.
 */
export async function getNotificationPreferences(
  userId: string,
  orgId: string,
): Promise<NotificationPreferences> {
  return withOrgContext(orgId, async (tx) => {
    const [row] = await tx
      .select()
      .from(userNotificationPreferences)
      .where(
        and(
          eq(userNotificationPreferences.user_id, userId),
          eq(userNotificationPreferences.org_id, orgId),
        ),
      );
    return rowToPrefs(row);
  });
}

/**
 * Upserts the user's preferences for the given org. Audits the change.
 * Only writes the keys present in `update`; missing keys keep their stored
 * value (or fall back to the default if the row didn't exist).
 */
export async function updateNotificationPreferences(
  userId: string,
  orgId: string,
  update: Partial<NotificationPreferences>,
): Promise<NotificationPreferences> {
  return withOrgContext(orgId, async (tx) => {
    const merged: NotificationPreferences = {
      ...(await readPrefsForUpdate(tx, userId, orgId)),
      ...update,
    };

    await tx
      .insert(userNotificationPreferences)
      .values({
        user_id: userId,
        org_id: orgId,
        ...merged,
        updated_at: new Date(),
      })
      .onConflictDoUpdate({
        target: [userNotificationPreferences.user_id, userNotificationPreferences.org_id],
        set: {
          daily_report: merged.daily_report,
          appointment_booked: merged.appointment_booked,
          qualified_lead: merged.qualified_lead,
          low_credit: merged.low_credit,
          campaign_completed: merged.campaign_completed,
          weekly_summary: merged.weekly_summary,
          updated_at: new Date(),
        },
      });

    await recordAudit(tx, {
      orgId,
      actorUserId: userId,
      actorType: 'user',
      action: 'notification_preferences.updated',
      subjectType: 'user',
      subjectId: userId,
      metadata: { changed: Object.keys(update) },
    });

    return merged;
  });
}

async function readPrefsForUpdate(
  tx: DbTx,
  userId: string,
  orgId: string,
): Promise<NotificationPreferences> {
  const [row] = await tx
    .select()
    .from(userNotificationPreferences)
    .where(
      and(
        eq(userNotificationPreferences.user_id, userId),
        eq(userNotificationPreferences.org_id, orgId),
      ),
    );
  return rowToPrefs(row);
}

/**
 * Within an existing transaction (typically system-context, used by the
 * daily-report cron), filters a list of candidate user IDs down to those
 * whose stored preference for `key` is `true` *or* who have no row yet
 * (defaults apply). Returns the user IDs that should still receive the
 * notification.
 */
export async function filterRecipientsByPreference(
  tx: DbTx,
  orgId: string,
  candidateUserIds: string[],
  key: NotificationKey,
): Promise<string[]> {
  if (candidateUserIds.length === 0) return [];

  const rows = await tx
    .select({
      user_id: userNotificationPreferences.user_id,
      enabled: sql<boolean>`(${userNotificationPreferences[key]})`,
    })
    .from(userNotificationPreferences)
    .where(eq(userNotificationPreferences.org_id, orgId));

  const stored = new Map(rows.map((r) => [r.user_id, r.enabled]));
  const defaultValue = DEFAULT_NOTIFICATION_PREFERENCES[key];

  return candidateUserIds.filter((uid) => stored.get(uid) ?? defaultValue);
}

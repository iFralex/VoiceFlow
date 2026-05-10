import { and, gt, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { emailLog } from '@/lib/db/schema/email_log';

/**
 * Returns true if an email of the given template was successfully sent for the
 * given org within the last `windowHours` hours.
 *
 * Tags must include `{name:'template', value: template}` and
 * `{name:'org_id', value: orgId}`. Rows with a non-null error are ignored so
 * a previous failed attempt does not block a retry.
 */
export async function hasRecentEmailSent(
  orgId: string,
  template: string,
  windowHours: number,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const rows = await db
    .select({ id: emailLog.id })
    .from(emailLog)
    .where(
      and(
        gt(emailLog.sent_at, cutoff),
        sql`${emailLog.tags} @> ${JSON.stringify([
          { name: 'template', value: template },
          { name: 'org_id', value: orgId },
        ])}::jsonb`,
        sql`${emailLog.error} IS NULL`,
      ),
    )
    .limit(1);

  return rows.length > 0;
}

/**
 * Returns true if an email of the given template was successfully sent for the
 * given ref_id within the last `windowHours` hours.
 *
 * Used to deduplicate event-driven emails (appointment-booked, qualified-lead,
 * campaign-completed) on `(template, ref_id)` to handle event replays.
 *
 * Tags must include `{name:'template', value: template}` and
 * `{name:'ref_id', value: refId}`. Rows with a non-null error are ignored.
 */
export async function hasRecentEmailSentForRef(
  template: string,
  refId: string,
  windowHours: number,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const rows = await db
    .select({ id: emailLog.id })
    .from(emailLog)
    .where(
      and(
        gt(emailLog.sent_at, cutoff),
        sql`${emailLog.tags} @> ${JSON.stringify([
          { name: 'template', value: template },
          { name: 'ref_id', value: refId },
        ])}::jsonb`,
        sql`${emailLog.error} IS NULL`,
      ),
    )
    .limit(1);

  return rows.length > 0;
}

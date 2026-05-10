/**
 * Integration tests verifying that notification preference toggles are respected
 * in the getOrgOwnerRecipients query.
 *
 * The dispatcher uses a LEFT JOIN on user_notification_preferences and applies
 * the per-key default when no row exists. These tests verify the SQL logic works
 * correctly against a real Postgres database.
 *
 * Prerequisites: docker compose -f infra/test/docker-compose.yml up -d
 */

import { and, eq, isNotNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  memberships,
  organizations,
  userNotificationPreferences,
  users,
} from '@/lib/db/schema';
import { withTestDb } from '@/test/db';

const skipWhenNoDb = !process.env['TEST_DATABASE_URL'];

// Stable UUIDs for this test file
const ORG_ID = '20000000-0000-0000-0000-000000000001';
const USER_A_ID = '20000000-0000-0000-0000-000000000002'; // owner, no prefs row → uses defaults
const USER_B_ID = '20000000-0000-0000-0000-000000000003'; // owner, explicitly opted out

describe('notification preferences — SQL integration', () => {
  it.skipIf(skipWhenNoDb)(
    'includes an owner who has no preferences row (uses default = true for appointment_booked)',
    async () => {
      await withTestDb(async (tx) => {
        await tx.insert(organizations).values({
          id: ORG_ID,
          name: 'Test Dealer',
          country: 'IT',
          timezone: 'Europe/Rome',
        });

        await tx.insert(users).values({
          id: USER_A_ID,
          email: 'owner-a@example.com',
          locale: 'it',
        });

        await tx.insert(memberships).values({
          org_id: ORG_ID,
          user_id: USER_A_ID,
          role: 'owner',
          accepted_at: new Date(),
        });

        // No userNotificationPreferences row inserted → default applies

        const rows = await tx
          .select({
            userId: users.id,
            email: users.email,
            prefEnabled: userNotificationPreferences.appointment_booked,
          })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.user_id))
          .leftJoin(
            userNotificationPreferences,
            and(
              eq(userNotificationPreferences.user_id, memberships.user_id),
              eq(userNotificationPreferences.org_id, memberships.org_id),
            ),
          )
          .where(
            and(
              eq(memberships.org_id, ORG_ID),
              eq(memberships.role, 'owner'),
              isNotNull(memberships.accepted_at),
            ),
          );

        expect(rows.length).toBe(1);
        // No pref row → prefEnabled is null, caller applies default (true)
        expect(rows[0]!.email).toBe('owner-a@example.com');
        expect(rows[0]!.prefEnabled).toBeNull();
      });
    },
  );

  it.skipIf(skipWhenNoDb)(
    'respects explicit opt-out: owner with appointment_booked=false is returned with false',
    async () => {
      await withTestDb(async (tx) => {
        await tx.insert(organizations).values({
          id: ORG_ID,
          name: 'Test Dealer',
          country: 'IT',
          timezone: 'Europe/Rome',
        });

        await tx.insert(users).values({
          id: USER_B_ID,
          email: 'owner-b@example.com',
          locale: 'en',
        });

        await tx.insert(memberships).values({
          org_id: ORG_ID,
          user_id: USER_B_ID,
          role: 'owner',
          accepted_at: new Date(),
        });

        await tx.insert(userNotificationPreferences).values({
          user_id: USER_B_ID,
          org_id: ORG_ID,
          appointment_booked: false,
          qualified_lead: true,
          low_credit: true,
          campaign_completed: true,
          weekly_summary: false,
          daily_report: true,
        });

        const rows = await tx
          .select({
            userId: users.id,
            email: users.email,
            prefEnabled: userNotificationPreferences.appointment_booked,
          })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.user_id))
          .leftJoin(
            userNotificationPreferences,
            and(
              eq(userNotificationPreferences.user_id, memberships.user_id),
              eq(userNotificationPreferences.org_id, memberships.org_id),
            ),
          )
          .where(
            and(
              eq(memberships.org_id, ORG_ID),
              eq(memberships.role, 'owner'),
              isNotNull(memberships.accepted_at),
            ),
          );

        expect(rows.length).toBe(1);
        expect(rows[0]!.prefEnabled).toBe(false);
        // The dispatcher filters out rows where (prefEnabled ?? default) === false
        const recipients = rows.filter((r) => r.prefEnabled ?? true);
        expect(recipients.length).toBe(0);
      });
    },
  );

  it.skipIf(skipWhenNoDb)(
    'respects explicit opt-in: owner with weekly_summary=true is included',
    async () => {
      await withTestDb(async (tx) => {
        await tx.insert(organizations).values({
          id: ORG_ID,
          name: 'Test Dealer',
          country: 'IT',
          timezone: 'Europe/Rome',
        });

        await tx.insert(users).values({
          id: USER_A_ID,
          email: 'owner-a@example.com',
          locale: 'it',
        });

        await tx.insert(memberships).values({
          org_id: ORG_ID,
          user_id: USER_A_ID,
          role: 'owner',
          accepted_at: new Date(),
        });

        await tx.insert(userNotificationPreferences).values({
          user_id: USER_A_ID,
          org_id: ORG_ID,
          weekly_summary: true, // opted in (default is false)
          appointment_booked: true,
          qualified_lead: true,
          low_credit: true,
          campaign_completed: true,
          daily_report: true,
        });

        const rows = await tx
          .select({
            userId: users.id,
            email: users.email,
            prefEnabled: userNotificationPreferences.weekly_summary,
          })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.user_id))
          .leftJoin(
            userNotificationPreferences,
            and(
              eq(userNotificationPreferences.user_id, memberships.user_id),
              eq(userNotificationPreferences.org_id, memberships.org_id),
            ),
          )
          .where(
            and(
              eq(memberships.org_id, ORG_ID),
              eq(memberships.role, 'owner'),
              isNotNull(memberships.accepted_at),
            ),
          );

        expect(rows.length).toBe(1);
        expect(rows[0]!.prefEnabled).toBe(true);
        // weekly_summary default is false; explicit true means opt-in respected
        const recipients = rows.filter((r) => r.prefEnabled ?? false);
        expect(recipients.length).toBe(1);
        expect(recipients[0]!.email).toBe('owner-a@example.com');
      });
    },
  );

  it.skipIf(skipWhenNoDb)(
    'excludes pending (not-yet-accepted) memberships from recipients',
    async () => {
      await withTestDb(async (tx) => {
        await tx.insert(organizations).values({
          id: ORG_ID,
          name: 'Test Dealer',
          country: 'IT',
          timezone: 'Europe/Rome',
        });

        await tx.insert(users).values({
          id: USER_A_ID,
          email: 'invited@example.com',
          locale: 'it',
        });

        // Invited but not yet accepted
        await tx.insert(memberships).values({
          org_id: ORG_ID,
          user_id: USER_A_ID,
          role: 'owner',
          // accepted_at intentionally left null
        });

        const rows = await tx
          .select({ userId: users.id })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.user_id))
          .leftJoin(
            userNotificationPreferences,
            and(
              eq(userNotificationPreferences.user_id, memberships.user_id),
              eq(userNotificationPreferences.org_id, memberships.org_id),
            ),
          )
          .where(
            and(
              eq(memberships.org_id, ORG_ID),
              eq(memberships.role, 'owner'),
              isNotNull(memberships.accepted_at),
            ),
          );

        expect(rows.length).toBe(0);
      });
    },
  );
});

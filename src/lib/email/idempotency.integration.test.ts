/**
 * Integration tests for the email idempotency SQL queries.
 *
 * These tests verify the JSONB containment queries used by hasRecentEmailSent
 * and hasRecentEmailSentForRef work correctly against a real Postgres database.
 * They bypass the exported functions (which use the global db singleton) and
 * test the query pattern directly via the test transaction.
 *
 * Prerequisites: docker compose -f infra/test/docker-compose.yml up -d
 */

import { and, gt, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { emailLog } from '@/lib/db/schema/email_log';
import { withTestDb } from '@/test/db';

const skipWhenNoDb = !process.env['TEST_DATABASE_URL'];

// ─── hasRecentEmailSent (org-scoped dedup) ────────────────────────────────────

describe('idempotency SQL — org-scoped dedup (low-balance / once per 24h)', () => {
  it.skipIf(skipWhenNoDb)(
    'finds a recent row with matching template and org_id tags',
    async () => {
      await withTestDb(async (tx) => {
        const orgId = 'org-idem-int-001';
        const template = 'low-balance';
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

        await tx.insert(emailLog).values({
          to_address: 'owner@example.com',
          subject: 'Credito basso',
          tags: [
            { name: 'template', value: template },
            { name: 'org_id', value: orgId },
          ],
        });

        const rows = await tx
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

        expect(rows.length).toBe(1);
      });
    },
  );

  it.skipIf(skipWhenNoDb)(
    'does not find a row whose error column is non-null (failed send does not block retry)',
    async () => {
      await withTestDb(async (tx) => {
        const orgId = 'org-idem-int-002';
        const template = 'low-balance';
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

        await tx.insert(emailLog).values({
          to_address: 'owner@example.com',
          subject: 'Credito basso',
          tags: [
            { name: 'template', value: template },
            { name: 'org_id', value: orgId },
          ],
          error: 'Resend API 500 Internal Server Error',
        });

        const rows = await tx
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

        expect(rows.length).toBe(0);
      });
    },
  );

  it.skipIf(skipWhenNoDb)(
    'does not match a row for a different org_id — dedup is org-scoped',
    async () => {
      await withTestDb(async (tx) => {
        const orgA = 'org-idem-int-003-A';
        const orgB = 'org-idem-int-003-B';
        const template = 'low-balance';
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

        await tx.insert(emailLog).values({
          to_address: 'owner@example.com',
          subject: 'Credito basso',
          tags: [
            { name: 'template', value: template },
            { name: 'org_id', value: orgA },
          ],
        });

        const rows = await tx
          .select({ id: emailLog.id })
          .from(emailLog)
          .where(
            and(
              gt(emailLog.sent_at, cutoff),
              sql`${emailLog.tags} @> ${JSON.stringify([
                { name: 'template', value: template },
                { name: 'org_id', value: orgB },
              ])}::jsonb`,
              sql`${emailLog.error} IS NULL`,
            ),
          )
          .limit(1);

        expect(rows.length).toBe(0);
      });
    },
  );

  it.skipIf(skipWhenNoDb)(
    'dedup blocks second low-balance send within 24h for the same org',
    async () => {
      await withTestDb(async (tx) => {
        const orgId = 'org-idem-int-lowbal';
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

        // Simulate the first successful send already logged
        await tx.insert(emailLog).values({
          to_address: 'owner@example.com',
          subject: 'Credito basso',
          tags: [
            { name: 'template', value: 'low-balance' },
            { name: 'org_id', value: orgId },
          ],
        });

        const rows = await tx
          .select({ id: emailLog.id })
          .from(emailLog)
          .where(
            and(
              gt(emailLog.sent_at, cutoff),
              sql`${emailLog.tags} @> ${JSON.stringify([
                { name: 'template', value: 'low-balance' },
                { name: 'org_id', value: orgId },
              ])}::jsonb`,
              sql`${emailLog.error} IS NULL`,
            ),
          )
          .limit(1);

        // dedup returns true → second send skipped
        expect(rows.length).toBe(1);
      });
    },
  );
});

// ─── hasRecentEmailSentForRef (ref-scoped dedup) ──────────────────────────────

describe('idempotency SQL — ref-scoped dedup (appointment-booked / once per hour)', () => {
  it.skipIf(skipWhenNoDb)(
    'finds a recent row with matching template and ref_id tags',
    async () => {
      await withTestDb(async (tx) => {
        const refId = 'appt-idem-int-001';
        const template = 'appointment-booked';
        const cutoff = new Date(Date.now() - 1 * 60 * 60 * 1000);

        await tx.insert(emailLog).values({
          to_address: 'owner@example.com',
          subject: 'Appuntamento fissato',
          tags: [
            { name: 'template', value: template },
            { name: 'ref_id', value: refId },
          ],
        });

        const rows = await tx
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

        expect(rows.length).toBe(1);
      });
    },
  );

  it.skipIf(skipWhenNoDb)(
    'does not find a row with a different ref_id — dedup is ref-scoped',
    async () => {
      await withTestDb(async (tx) => {
        const template = 'appointment-booked';
        const cutoff = new Date(Date.now() - 1 * 60 * 60 * 1000);

        await tx.insert(emailLog).values({
          to_address: 'owner@example.com',
          subject: 'Appuntamento fissato',
          tags: [
            { name: 'template', value: template },
            { name: 'ref_id', value: 'appt-idem-int-002-A' },
          ],
        });

        const rows = await tx
          .select({ id: emailLog.id })
          .from(emailLog)
          .where(
            and(
              gt(emailLog.sent_at, cutoff),
              sql`${emailLog.tags} @> ${JSON.stringify([
                { name: 'template', value: template },
                { name: 'ref_id', value: 'appt-idem-int-002-B' },
              ])}::jsonb`,
              sql`${emailLog.error} IS NULL`,
            ),
          )
          .limit(1);

        expect(rows.length).toBe(0);
      });
    },
  );

  it.skipIf(skipWhenNoDb)(
    'dedup prevents duplicate appointment-booked email when event arrives twice for same ref',
    async () => {
      await withTestDb(async (tx) => {
        const refId = 'appt-idem-int-dup';
        const template = 'appointment-booked';
        const cutoff = new Date(Date.now() - 1 * 60 * 60 * 1000);

        // Simulate first send already logged
        await tx.insert(emailLog).values({
          to_address: 'owner@example.com',
          subject: 'Appuntamento fissato',
          tags: [
            { name: 'template', value: template },
            { name: 'ref_id', value: refId },
          ],
        });

        // Check if the query would return a result (meaning second send is blocked)
        const rows = await tx
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

        // dedup returns true → duplicate send blocked
        expect(rows.length).toBe(1);
      });
    },
  );

  it.skipIf(skipWhenNoDb)(
    'failed send (error row) does not block a retry for the same ref_id',
    async () => {
      await withTestDb(async (tx) => {
        const refId = 'appt-idem-int-failed';
        const template = 'appointment-booked';
        const cutoff = new Date(Date.now() - 1 * 60 * 60 * 1000);

        await tx.insert(emailLog).values({
          to_address: 'owner@example.com',
          subject: 'Appuntamento fissato',
          tags: [
            { name: 'template', value: template },
            { name: 'ref_id', value: refId },
          ],
          error: 'Resend rate limit exceeded',
        });

        const rows = await tx
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

        // No successful send found → retry is allowed
        expect(rows.length).toBe(0);
      });
    },
  );
});

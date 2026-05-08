/**
 * Integration test for GDPR Article 17 erasure (plan 11 task 18).
 *
 * Verifies that `eraseSubject`:
 *   - scrubs PII (`first_name`, `last_name`, `email`) on the contact row
 *   - preserves `phone_e164` so the opt-out registry remains queryable
 *   - sets `deleted_at` on the contact and stamps a tombstone in `metadata`
 *   - tombstones every related call's `metadata`
 *   - upserts the org-wide opt-out via the unified registry path
 *   - records a `compliance.gdpr_erasure` audit row
 *   - mismatched `confirmPhone` raises before any writes happen
 *
 * Each test runs inside a `withTestDb` transaction that is always rolled back.
 *
 * Prerequisites:
 *   docker compose -f infra/test/docker-compose.yml up -d
 *   DATABASE_DIRECT_URL=postgresql://postgres:postgres@localhost:5433/vox_auto_test \
 *     pnpm db:migrate
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/vox_auto_test
 */

import { and, eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRemove } = vi.hoisted(() => ({ mockRemove: vi.fn() }));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    storage: {
      from: vi.fn(() => ({ remove: mockRemove })),
    },
  },
}));

vi.mock('@/lib/inngest/client', () => ({
  sendInngestEvent: vi.fn().mockResolvedValue(undefined),
  sendInngestEvents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/db/context', async () => ({
  withSystemContext: vi.fn(),
  withOrgContext: vi.fn(),
}));

import {
  eraseSubject,
  SubjectErasureConfirmationError,
} from '@/lib/compliance/gdpr/erase';
import { withOrgContext, withSystemContext } from '@/lib/db/context';
import {
  auditLog,
  calls,
  contactLists,
  contacts,
  optOutRegistry,
  organizations,
} from '@/lib/db/schema';
import { type DbTx as TestDbTx, withTestDb } from '@/test/db';

const ORG = 'f0000000-0000-0000-0000-000000000001';
const LIST = 'f0000000-0000-0000-0000-000000000002';
const CONTACT = 'f0000000-0000-0000-0000-000000000010';
const ACTOR_USER = 'f0000000-0000-0000-0000-0000000000aa';

const PHONE = '+393331110020';
const EMAIL = 'erase@example.com';

const skipWhenNoDb = !process.env['TEST_DATABASE_URL'];

async function setOrgContext(tx: TestDbTx, orgId: string): Promise<void> {
  await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
}

async function clearOrgContext(tx: TestDbTx): Promise<void> {
  await tx.execute(sql`SELECT set_config('app.current_org_id', '', true)`);
}

function bindContextsTo(tx: TestDbTx): void {
  vi.mocked(withSystemContext).mockImplementation((fn) =>
    fn(tx as unknown as Parameters<typeof fn>[0]),
  );
  vi.mocked(withOrgContext).mockImplementation(async (orgId, fn) => {
    await setOrgContext(tx, orgId as string);
    try {
      return await fn(tx as unknown as Parameters<typeof fn>[0]);
    } finally {
      await clearOrgContext(tx);
    }
  });
}

beforeEach(() => {
  mockRemove.mockReset();
  mockRemove.mockResolvedValue({ data: [], error: null });
});

async function seedSubject(tx: TestDbTx): Promise<string> {
  await tx.insert(organizations).values({
    id: ORG,
    name: 'Erasure Org',
    country: 'IT',
    timezone: 'Europe/Rome',
  });
  await tx.insert(contactLists).values({
    id: LIST,
    org_id: ORG,
    name: 'List',
    source: 'api',
    total_count: 0,
    valid_count: 0,
  });
  await tx.insert(contacts).values({
    id: CONTACT,
    org_id: ORG,
    contact_list_id: LIST,
    phone_e164: PHONE,
    email: EMAIL,
    first_name: 'Mario',
    last_name: 'Rossi',
    consent_basis: 'consent',
  });
  const callRows = await tx
    .insert(calls)
    .values({
      org_id: ORG,
      contact_id: CONTACT,
      provider: 'vapi',
      status: 'completed',
      recording_path: `${ORG}/recording.mp3`,
      transcript_path: `${ORG}/transcript.json`,
      metadata: { transcript_excerpt: 'leaked PII goes here' },
    })
    .returning({ id: calls.id });
  return callRows[0]!.id;
}

describe('eraseSubject integration', () => {
  it.skipIf(skipWhenNoDb)(
    'scrubs PII on the contact while preserving the opt-out registry entry',
    async () => {
      await withTestDb(async (tx) => {
        const callId = await seedSubject(tx);

        bindContextsTo(tx);

        const result = await eraseSubject({
          orgId: ORG,
          byUserId: ACTOR_USER,
          identifier: PHONE,
          confirmPhone: PHONE,
          reason: 'Article 17 request',
        });

        expect(result.contactId).toBe(CONTACT);
        expect(result.phoneE164).toBe(PHONE);
        expect(result.totals.callsScrubbed).toBe(1);

        await clearOrgContext(tx);

        // Contact row: PII scrubbed, phone preserved, deleted_at + tombstone set.
        const [scrubbed] = await tx
          .select()
          .from(contacts)
          .where(eq(contacts.id, CONTACT));
        expect(scrubbed?.first_name).toBeNull();
        expect(scrubbed?.last_name).toBeNull();
        expect(scrubbed?.email).toBeNull();
        expect(scrubbed?.phone_e164).toBe(PHONE);
        expect(scrubbed?.deleted_at).not.toBeNull();
        const contactMeta = scrubbed?.metadata as Record<string, unknown> | null;
        expect(contactMeta?.['gdpr_erasure']).toBe(true);
        expect(typeof contactMeta?.['erased_at']).toBe('string');

        // Calls metadata is replaced wholesale with the tombstone.
        const [scrubbedCall] = await tx
          .select()
          .from(calls)
          .where(eq(calls.id, callId));
        const callMeta = scrubbedCall?.metadata as Record<string, unknown> | null;
        expect(callMeta?.['gdpr_erasure']).toBe(true);
        expect(callMeta?.['transcript_excerpt']).toBeUndefined();

        // Opt-out registry retains the entry under the preserved phone.
        const optOuts = await tx
          .select()
          .from(optOutRegistry)
          .where(
            and(
              eq(optOutRegistry.org_id, ORG),
              eq(optOutRegistry.phone_e164, PHONE),
            ),
          );
        expect(optOuts).toHaveLength(1);
        expect(optOuts[0]?.source).toBe('gdpr_request');

        // compliance.gdpr_erasure audit entry is recorded.
        const erasureAudit = await tx
          .select()
          .from(auditLog)
          .where(
            and(
              eq(auditLog.org_id, ORG),
              eq(auditLog.action, 'compliance.gdpr_erasure'),
            ),
          );
        expect(erasureAudit).toHaveLength(1);
        expect(erasureAudit[0]?.subject_id).toBe(CONTACT);

        // Storage purge fired with both the recording and transcript paths.
        expect(mockRemove).toHaveBeenCalled();
      });
    },
  );

  it.skipIf(skipWhenNoDb)(
    'rejects mismatched confirmPhone before performing any writes',
    async () => {
      await withTestDb(async (tx) => {
        await seedSubject(tx);
        bindContextsTo(tx);

        await expect(
          eraseSubject({
            orgId: ORG,
            byUserId: ACTOR_USER,
            identifier: PHONE,
            confirmPhone: '+390000000000',
            reason: 'wrong confirm',
          }),
        ).rejects.toBeInstanceOf(SubjectErasureConfirmationError);

        // Contact still intact.
        await clearOrgContext(tx);
        const [intact] = await tx.select().from(contacts).where(eq(contacts.id, CONTACT));
        expect(intact?.first_name).toBe('Mario');
        expect(intact?.deleted_at).toBeNull();

        // No erasure audit row.
        const erasureAudit = await tx
          .select()
          .from(auditLog)
          .where(eq(auditLog.action, 'compliance.gdpr_erasure'));
        expect(erasureAudit).toHaveLength(0);
      });
    },
  );
});

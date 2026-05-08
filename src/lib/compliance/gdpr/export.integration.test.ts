/**
 * Integration test for GDPR Article 15 export (plan 11 task 18).
 *
 * Verifies that `buildSubjectExport`:
 *   - resolves the contact by phone or email within an org
 *   - bundles contact, calls, appointments, opt-outs and audit_log into a ZIP
 *   - bundles recording / transcript bytes when the storage adapter returns them
 *   - uploads with content-type application/zip and signs a 7-day URL
 *   - records a `compliance.gdpr_export` audit entry
 *
 * The supabase admin client is mocked at module level — Storage has no
 * transactional semantics so a real upload would persist beyond the rollback.
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
import JSZip from 'jszip';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockUpload, mockCreateSignedUrl, mockDownload } = vi.hoisted(() => ({
  mockUpload: vi.fn(),
  mockCreateSignedUrl: vi.fn(),
  mockDownload: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    storage: {
      from: vi.fn(() => ({
        upload: mockUpload,
        createSignedUrl: mockCreateSignedUrl,
        download: mockDownload,
      })),
    },
  },
}));

// Redirect production DB context helpers to the per-test transaction.
vi.mock('@/lib/db/context', async () => ({
  withSystemContext: vi.fn(),
  withOrgContext: vi.fn(),
}));

import { buildSubjectExport } from '@/lib/compliance/gdpr/export';
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

const ORG = 'e0000000-0000-0000-0000-000000000001';
const LIST = 'e0000000-0000-0000-0000-000000000002';
const CONTACT = 'e0000000-0000-0000-0000-000000000010';

const PHONE = '+393331110010';
const EMAIL = 'mario@example.com';

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
  mockUpload.mockReset();
  mockCreateSignedUrl.mockReset();
  mockDownload.mockReset();
  mockUpload.mockResolvedValue({ data: { path: 'p' }, error: null });
  mockCreateSignedUrl.mockResolvedValue({
    data: { signedUrl: 'https://storage.example/signed' },
    error: null,
  });
  // Recording / transcript downloads return tiny placeholder blobs.
  mockDownload.mockResolvedValue({
    data: { arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer) },
    error: null,
  });
});

describe('buildSubjectExport integration', () => {
  it.skipIf(skipWhenNoDb)(
    'bundles contact, calls, opt-outs, audit, recordings and transcripts into a single ZIP',
    async () => {
      await withTestDb(async (tx) => {
        await tx.insert(organizations).values({
          id: ORG,
          name: 'GDPR Org',
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
          })
          .returning({ id: calls.id });
        const callId = callRows[0]!.id;

        await tx.insert(optOutRegistry).values({
          org_id: ORG,
          phone_e164: PHONE,
          source: 'dealer_input',
        });
        await tx.insert(auditLog).values({
          org_id: ORG,
          actor_type: 'user',
          action: 'contact.created',
          subject_type: 'contact',
          subject_id: CONTACT,
        });

        bindContextsTo(tx);

        const result = await buildSubjectExport({
          orgId: ORG,
          identifier: PHONE,
        });

        expect(result.contactId).toBe(CONTACT);
        expect(result.signedUrl).toBe('https://storage.example/signed');
        expect(result.totals.calls).toBe(1);
        expect(result.totals.optOuts).toBe(1);
        expect(result.totals.recordingsBundled).toBe(1);
        expect(result.totals.transcriptsBundled).toBe(1);
        expect(result.totals.auditEntries).toBeGreaterThanOrEqual(1);

        // Inspect the upload payload — the ZIP must contain the canonical files.
        expect(mockUpload).toHaveBeenCalledTimes(1);
        const [uploadPath, uploadBytes, uploadOpts] = mockUpload.mock.calls[0]!;
        expect(uploadPath).toMatch(new RegExp(`^${ORG}/exports/gdpr-${CONTACT}-\\d+\\.zip$`));
        expect(uploadOpts).toMatchObject({
          contentType: 'application/zip',
          upsert: true,
        });

        const archive = await JSZip.loadAsync(uploadBytes as Buffer);
        const fileNames = Object.keys(archive.files);
        expect(fileNames).toEqual(
          expect.arrayContaining([
            'contact.json',
            'calls.json',
            'appointments.json',
            'opt_outs.json',
            'audit_log.json',
            `recordings/${callId}.mp3`,
            `transcripts/${callId}.json`,
          ]),
        );

        // Spot-check the contact JSON round-trips the right phone.
        const contactJson = JSON.parse(
          await archive.file('contact.json')!.async('string'),
        );
        expect(contactJson.phone_e164).toBe(PHONE);

        // Verify the audit row landed.
        await clearOrgContext(tx);
        const auditRows = await tx
          .select()
          .from(auditLog)
          .where(
            and(
              eq(auditLog.org_id, ORG),
              eq(auditLog.action, 'compliance.gdpr_export'),
            ),
          );
        expect(auditRows).toHaveLength(1);
        expect(auditRows[0]?.subject_id).toBe(CONTACT);
      });
    },
  );

  it.skipIf(skipWhenNoDb)(
    'resolves the contact by email when the identifier looks like an email',
    async () => {
      await withTestDb(async (tx) => {
        await tx.insert(organizations).values({
          id: ORG,
          name: 'GDPR Org',
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
          consent_basis: 'consent',
        });

        bindContextsTo(tx);

        const result = await buildSubjectExport({
          orgId: ORG,
          identifier: EMAIL,
        });
        expect(result.contactId).toBe(CONTACT);
      });
    },
  );
});

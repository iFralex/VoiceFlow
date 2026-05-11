/**
 * Logical database backup service — plan 14 task 7.
 *
 * Exports every application table as NDJSON, gzip-compresses the result,
 * encrypts with AES-256-GCM (key from BACKUP_ENCRYPTION_KEY env var), and
 * uploads the ciphertext to a Backblaze B2 bucket.
 *
 * Invoked by the `/api/cron/backup` route which runs nightly at 03:30
 * Europe/Rome (02:30 UTC, 01:30 UTC during CEST — Vercel cron is UTC-fixed
 * so the actual wall-clock offset drifts one hour each DST transition).
 *
 * B2 retention lifecycle (30-day) must be configured on the bucket via the
 * Backblaze UI; the SDK only writes new objects, it does not manage lifecycle.
 *
 * Encryption format (all big-endian):
 *   [4 bytes: IV length = 12] [12 bytes: IV] [16 bytes: GCM authTag] [ciphertext]
 *
 * Decryption (openssl):
 *   # strip 32-byte header, split IV / tag / ciphertext, then:
 *   openssl enc -d -aes-256-gcm -K $KEY_HEX -iv $IV_HEX
 * See docs/runbooks/disaster-recovery.md for the full restore procedure.
 *
 * NOTE: this uses Node.js crypto + zlib (no external binaries) so it works
 * in Vercel serverless runtimes. For maximum fidelity, a dedicated backup
 * server running the real pg_dump + age tool is preferred; this implementation
 * is the serverless-compatible fallback for MVP.
 */

import { createCipheriv, createHash, randomBytes } from 'crypto';
import { promisify } from 'util';
import { gzip } from 'zlib';

import postgres from 'postgres';

import { env } from '@/lib/env';
import { logger } from '@/lib/observability/logger';

const gzipAsync = promisify(gzip);

// All application tables in dependency order (parents before children).
const BACKUP_TABLES = [
  'organizations',
  'users',
  'memberships',
  'voice_catalogue',
  'script_templates',
  'scripts',
  'contact_lists',
  'contacts',
  'campaigns',
  'calls',
  'appointments',
  'credit_packages',
  'credit_ledger',
  'payments',
  'opt_out_registry',
  'rpo_snapshots',
  'audit_log',
  'webhook_events',
  'phone_numbers',
  'cli_cooldown_history',
  'webhooks_outgoing',
  'webhook_deliveries',
  'personal_access_tokens',
  'auth_signins',
  'campaign_stats',
  'system_flags',
  'user_notification_preferences',
  'email_log',
] as const;

export interface BackupResult {
  ok: boolean;
  filename?: string;
  sizeBytes?: number;
  tablesExported?: number;
  error?: string;
}

export async function runDatabaseBackup(): Promise<BackupResult> {
  const { BACKUP_B2_KEY_ID, BACKUP_B2_APP_KEY, BACKUP_B2_BUCKET_ID, BACKUP_ENCRYPTION_KEY } = env;

  if (!BACKUP_B2_KEY_ID || !BACKUP_B2_APP_KEY || !BACKUP_B2_BUCKET_ID || !BACKUP_ENCRYPTION_KEY) {
    void logger.warn('[backup] B2 credentials or encryption key not configured — skipping backup');
    return { ok: false, error: 'backup_not_configured' };
  }

  // Use direct connection (not pooler) for bulk SELECT
  const sql = postgres(env.DATABASE_DIRECT_URL, { max: 1 });

  try {
    const lines: string[] = [
      `-- VoxAuto logical backup`,
      `-- Created: ${new Date().toISOString()}`,
      `-- Tables: ${BACKUP_TABLES.join(', ')}`,
      '',
    ];

    for (const table of BACKUP_TABLES) {
      const rows = await sql`SELECT * FROM ${sql(table)}`;
      lines.push(`-- TABLE: ${table} (${rows.length} rows)`);
      for (const row of rows) {
        lines.push(JSON.stringify({ _table: table, ...row }));
      }
      lines.push('');
    }

    const rawData = Buffer.from(lines.join('\n'), 'utf8');
    const compressed = await gzipAsync(rawData);

    const key = Buffer.from(BACKUP_ENCRYPTION_KEY, 'hex');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Header: [4-byte IV length = 12][IV][authTag][ciphertext]
    const ivLenBuf = Buffer.alloc(4);
    ivLenBuf.writeUInt32BE(12, 0);
    const payload = Buffer.concat([ivLenBuf, iv, authTag, encrypted]);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `voxauto-backup-${timestamp}.ndjson.gz.enc`;
    const sha1 = createHash('sha1').update(payload).digest('hex');

    await uploadToB2(filename, payload, sha1, BACKUP_B2_KEY_ID, BACKUP_B2_APP_KEY, BACKUP_B2_BUCKET_ID);

    void logger.info('[backup] daily backup completed', {
      filename,
      sizeBytes: payload.length,
      tablesExported: BACKUP_TABLES.length,
    });

    return { ok: true, filename, sizeBytes: payload.length, tablesExported: BACKUP_TABLES.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void logger.error('[backup] backup failed', { error: message });
    return { ok: false, error: message };
  } finally {
    await sql.end();
  }
}

// ---------------------------------------------------------------------------
// B2 native API helpers
// ---------------------------------------------------------------------------

interface B2AuthResult {
  apiUrl: string;
  authorizationToken: string;
}

interface B2UploadUrlResult {
  uploadUrl: string;
  authorizationToken: string;
}

async function b2Authorize(keyId: string, appKey: string): Promise<B2AuthResult> {
  const credentials = Buffer.from(`${keyId}:${appKey}`).toString('base64');
  const res = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: { Authorization: `Basic ${credentials}` },
  });
  if (!res.ok) {
    throw new Error(`B2 authorize_account failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<B2AuthResult>;
}

async function uploadToB2(
  filename: string,
  data: Buffer,
  sha1: string,
  keyId: string,
  appKey: string,
  bucketId: string,
): Promise<void> {
  const { apiUrl, authorizationToken } = await b2Authorize(keyId, appKey);

  const urlRes = await fetch(`${apiUrl}/b2api/v2/b2_get_upload_url`, {
    method: 'POST',
    headers: { Authorization: authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketId }),
  });
  if (!urlRes.ok) {
    throw new Error(`B2 get_upload_url failed: ${urlRes.status} ${await urlRes.text()}`);
  }
  const { uploadUrl, authorizationToken: uploadToken } =
    (await urlRes.json()) as B2UploadUrlResult;

  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: uploadToken,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(data.length),
      'X-Bz-File-Name': encodeURIComponent(filename),
      'X-Bz-Content-Sha1': sha1,
    },
    body: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
  });
  if (!uploadRes.ok) {
    throw new Error(`B2 upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
  }
}

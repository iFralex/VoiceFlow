/**
 * Storage signed-URL helpers.
 *
 * All paths in Supabase Storage are prefixed with the owning org's ID:
 *   `<org_id>/<subpath...>`
 *
 * Both helpers enforce that the caller belongs to the org that owns the path
 * by parsing the first path segment and comparing it to the auth-context orgId.
 */

import { getAuthContext } from '@/lib/auth/context';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { CALL_MEDIA_BUCKET } from '@/lib/voice/persistence';

export const CSV_UPLOADS_BUCKET = 'csv-uploads';
const BUCKET = CSV_UPLOADS_BUCKET;

/**
 * Returns the org ID encoded as the first segment of a storage path.
 * Throws if the path is malformed.
 */
function extractOrgId(path: string): string {
  const orgId = path.split('/')[0];
  if (!orgId) {
    throw new Error(`Invalid storage path: '${path}' — expected '<org_id>/<subpath>'`);
  }
  return orgId;
}

/**
 * Generates a signed download URL for a file in the csv-uploads bucket.
 *
 * Enforces org membership: the caller's orgId from the auth context must
 * match the first path segment of `path`.
 *
 * @param path       Storage object path, e.g. `<org_id>/exports/contacts-123.csv`
 * @param ttlSeconds Seconds until the signed URL expires
 * @returns          A temporary signed URL for downloading the file
 */
export async function getDownloadUrl(path: string, ttlSeconds: number): Promise<string> {
  const pathOrgId = extractOrgId(path);
  const { orgId } = await getAuthContext();

  if (orgId !== pathOrgId) {
    throw new Error(`Forbidden: path belongs to org '${pathOrgId}', caller is in org '${orgId}'`);
  }

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(path, ttlSeconds);

  if (error || !data?.signedUrl) {
    throw new Error(`Failed to create download URL: ${error?.message ?? 'unknown error'}`);
  }

  return data.signedUrl;
}

/**
 * Generates a signed upload URL for writing a new file to the csv-uploads bucket.
 *
 * Enforces org membership: the caller's orgId from the auth context must
 * match the first path segment of `path`.
 *
 * @param path       Storage object path, e.g. `<org_id>/uploads/<uuid>-file.csv`
 * @returns          A temporary signed URL for uploading the file (TTL is controlled by bucket config)
 */
export async function getUploadUrl(path: string): Promise<string> {
  const pathOrgId = extractOrgId(path);
  const { orgId } = await getAuthContext();

  if (orgId !== pathOrgId) {
    throw new Error(`Forbidden: path belongs to org '${pathOrgId}', caller is in org '${orgId}'`);
  }

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUploadUrl(path, { upsert: false });

  if (error || !data?.signedUrl) {
    throw new Error(`Failed to create upload URL: ${error?.message ?? 'unknown error'}`);
  }

  return data.signedUrl;
}

/**
 * Generates a signed download URL for a recording or transcript in the
 * `call-media` bucket.
 *
 * Call-media paths are laid out as `<kind>/<org_id>/<call_id>.<ext>` where
 * `<kind>` is either `recordings` or `transcripts` (see
 * `src/lib/voice/persistence.ts`). The org_id is therefore the *second*
 * segment, not the first.
 *
 * @param path       Storage object path, e.g. `recordings/<org_id>/<call_id>.mp3`
 * @param ttlSeconds Seconds until the signed URL expires
 */
export async function getCallMediaDownloadUrl(
  path: string,
  ttlSeconds: number,
): Promise<string> {
  const segments = path.split('/');
  const kind = segments[0];
  const pathOrgId = segments[1];

  if ((kind !== 'recordings' && kind !== 'transcripts') || !pathOrgId) {
    throw new Error(
      `Invalid call-media path: '${path}' — expected '(recordings|transcripts)/<org_id>/<call_id>.<ext>'`,
    );
  }

  const { orgId } = await getAuthContext();
  if (orgId !== pathOrgId) {
    throw new Error(
      `Forbidden: path belongs to org '${pathOrgId}', caller is in org '${orgId}'`,
    );
  }

  const { data, error } = await supabaseAdmin.storage
    .from(CALL_MEDIA_BUCKET)
    .createSignedUrl(path, ttlSeconds);

  if (error || !data?.signedUrl) {
    throw new Error(
      `Failed to create call-media download URL: ${error?.message ?? 'unknown error'}`,
    );
  }

  return data.signedUrl;
}

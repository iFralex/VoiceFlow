import { randomUUID } from 'crypto';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getAuthContext, hasCapability } from '@/lib/auth/context';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createContactList } from '@/lib/services/contact_lists';

const BUCKET = 'csv-uploads';
const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
const ALLOWED_CONTENT_TYPES = ['text/csv', 'application/vnd.ms-excel', 'text/plain'] as const;
const SIGNED_URL_TTL_SECONDS = 5 * 60; // 5 minutes

const BodySchema = z.object({
  filename: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive().max(MAX_SIZE_BYTES, {
    message: `File size must not exceed ${MAX_SIZE_BYTES} bytes (50 MB)`,
  }),
  contentType: z.enum(ALLOWED_CONTENT_TYPES),
});

/** Removes characters that are unsafe for storage paths, keeping alphanumerics, dots, dashes, and underscores. */
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
}

export async function POST(request: Request): Promise<Response> {
  // Auth check via middleware-injected headers
  let auth: Awaited<ReturnType<typeof getAuthContext>>;
  try {
    auth = await getAuthContext();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!hasCapability(auth.role, 'contacts.upload')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Parse body
  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { filename, contentType } = parsed.data;

  // Build storage path
  const fileId = randomUUID();
  const safeName = sanitizeFilename(filename);
  const storagePath = `${auth.orgId}/uploads/${fileId}-${safeName}`;

  // Generate signed upload URL (service-role bypasses RLS)
  const { data: signedData, error: storageError } =
    await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(storagePath, {
      upsert: false,
    });

  if (storageError || !signedData) {
    return NextResponse.json(
      { error: 'Failed to create upload URL', details: storageError?.message },
      { status: 500 },
    );
  }

  // Insert placeholder contact_list row (import_status defaults to 'pending')
  let list: Awaited<ReturnType<typeof createContactList>>;
  try {
    list = await createContactList(auth.orgId, auth.userId, {
      name: filename,
      source: 'csv-upload',
      sourceFilePath: storagePath,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({
    uploadUrl: signedData.signedUrl,
    token: signedData.token,
    listId: list.id,
    storagePath,
    contentType,
  });
}

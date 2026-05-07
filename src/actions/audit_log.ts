'use server';

import { z } from 'zod';

import { getAuthContext, requireCapability } from '@/lib/auth/context';
import {
  buildAuditLogCsv,
  listAuditLog,
  type AuditLogCursor,
  type AuditLogListEntry,
  type ListAuditLogFilters,
} from '@/lib/services/audit_log';
import { CSV_UPLOADS_BUCKET } from '@/lib/storage/signed';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { ActionResult } from '@/lib/utils/action-toast';

// ─── Shared serialization ─────────────────────────────────────────────────────

export interface SerializedAuditLogEntry {
  id: string;
  createdAt: string;
  actorType: 'user' | 'system' | 'webhook';
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  subjectType: string;
  subjectId: string;
  metadata: Record<string, unknown> | null;
}

export interface SerializedAuditLogPage {
  entries: SerializedAuditLogEntry[];
  nextCursor: AuditLogCursor | null;
}

function serialize(entry: AuditLogListEntry): SerializedAuditLogEntry {
  return {
    id: entry.id,
    createdAt: entry.createdAt.toISOString(),
    actorType: entry.actorType,
    actorUserId: entry.actorUserId,
    actorEmail: entry.actorEmail,
    action: entry.action,
    subjectType: entry.subjectType,
    subjectId: entry.subjectId,
    metadata: entry.metadata,
  };
}

// ─── Filter parsing ───────────────────────────────────────────────────────────

const filtersSchema = z.object({
  actionPrefix: z.string().trim().max(120).optional(),
  fromIso: z.string().datetime().optional(),
  toIso: z.string().datetime().optional(),
  actorUserId: z.string().uuid().optional(),
});

function parseFilters(input: z.infer<typeof filtersSchema>): ListAuditLogFilters {
  const out: ListAuditLogFilters = {};
  if (input.actionPrefix && input.actionPrefix.length > 0) out.actionPrefix = input.actionPrefix;
  if (input.fromIso) out.from = new Date(input.fromIso);
  if (input.toIso) out.to = new Date(input.toIso);
  if (input.actorUserId) out.actorUserId = input.actorUserId;
  return out;
}

const cursorSchema = z
  .object({
    createdAt: z.string().datetime(),
    id: z.string().regex(/^\d+$/),
  })
  .nullish();

const listInputSchema = z.object({
  filters: filtersSchema.optional(),
  cursor: cursorSchema.optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

// ─── List action ─────────────────────────────────────────────────────────────

/**
 * Server Action — paginated audit log listing for the active org. Requires
 * capability `audit.view` (owner / admin / viewer per spec §4.4).
 */
export async function listAuditLogEntries(
  input: z.infer<typeof listInputSchema>,
): Promise<ActionResult & { data?: SerializedAuditLogPage }> {
  const parsed = listInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'validation_error' };
  }

  try {
    const { orgId } = await getAuthContext();
    await requireCapability('audit.view');

    const filters = parsed.data.filters ? parseFilters(parsed.data.filters) : {};
    const result = await listAuditLog({
      orgId,
      ...filters,
      ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
      ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {}),
    });

    return {
      ok: true,
      data: {
        entries: result.entries.map(serialize),
        nextCursor: result.nextCursor,
      },
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'audit_list_failed' };
  }
}

// ─── CSV export action ───────────────────────────────────────────────────────

const exportSchema = z.object({
  filters: filtersSchema.optional(),
});

const ONE_HOUR_SECONDS = 60 * 60;

export interface AuditLogCsvExportData {
  url: string;
  expiresAt: string;
  rowCount: number;
  truncated: boolean;
}

/**
 * Server Action — builds a CSV of audit log entries for the active org and
 * uploads it to Storage with a 1-hour signed URL. Requires capability
 * `audit.view`.
 */
export async function exportAuditLogCsv(
  input: z.infer<typeof exportSchema>,
): Promise<ActionResult & { data?: AuditLogCsvExportData }> {
  const parsed = exportSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'validation_error' };
  }

  try {
    const { orgId } = await getAuthContext();
    await requireCapability('audit.view');

    const filters = parsed.data.filters ? parseFilters(parsed.data.filters) : {};
    const result = await buildAuditLogCsv({ orgId, ...filters });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const path = `${orgId}/exports/audit-log-${stamp}.csv`;

    const { error: uploadErr } = await supabaseAdmin.storage
      .from(CSV_UPLOADS_BUCKET)
      .upload(path, Buffer.from(result.csv, 'utf-8'), {
        contentType: 'text/csv; charset=utf-8',
        upsert: true,
      });
    if (uploadErr) {
      return { ok: false, message: `audit_export_upload_failed: ${uploadErr.message}` };
    }

    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(CSV_UPLOADS_BUCKET)
      .createSignedUrl(path, ONE_HOUR_SECONDS);
    if (signErr || !signed?.signedUrl) {
      return {
        ok: false,
        message: `audit_export_sign_failed: ${signErr?.message ?? 'unknown'}`,
      };
    }

    return {
      ok: true,
      data: {
        url: signed.signedUrl,
        expiresAt: new Date(Date.now() + ONE_HOUR_SECONDS * 1000).toISOString(),
        rowCount: result.rowCount,
        truncated: result.truncated,
      },
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'audit_export_failed' };
  }
}

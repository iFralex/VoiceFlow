/**
 * Audit log query service (plan 11 task 15).
 *
 * Provides cursor-paginated reads over `audit_log` for the in-app viewer and a
 * CSV export builder. The audit log is a system-owned, append-only table —
 * rows have no RLS GUC and must be queried via `withSystemContext` with an
 * explicit `org_id` filter. This service is the single read path; nothing else
 * should query `audit_log` directly for UI purposes.
 *
 * Cursor semantics: pages are ordered by `(created_at DESC, id DESC)` with the
 * `audit_log_org_created_at_idx` covering index. Pagination uses a (createdAt,
 * id) tuple; the tie-break on id keeps results stable when many rows share a
 * timestamp.
 */

import { and, desc, eq, gte, inArray, like, lt, lte, or } from 'drizzle-orm';

import { withSystemContext } from '@/lib/db/context';
import { auditLog, users } from '@/lib/db/schema';
import type { AuditLogEntry } from '@/lib/db/schema';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActorType = 'user' | 'system' | 'webhook';

export interface AuditLogListEntry {
  id: string;
  createdAt: Date;
  actorType: ActorType;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  subjectType: string;
  subjectId: string;
  metadata: Record<string, unknown> | null;
}

export interface AuditLogCursor {
  createdAt: string; // ISO timestamp
  id: string; // bigint serialized as string
}

export interface ListAuditLogFilters {
  /** Action prefix match — e.g. `compliance.` matches `compliance.gdpr_export` etc. */
  actionPrefix?: string;
  /** Inclusive lower bound on `created_at`. */
  from?: Date;
  /** Inclusive upper bound on `created_at`. */
  to?: Date;
  /** Filter by a specific actor user id (only matches actor_type='user'). */
  actorUserId?: string;
}

export interface ListAuditLogParams extends ListAuditLogFilters {
  orgId: string;
  limit?: number;
  cursor?: AuditLogCursor;
}

export interface ListAuditLogResult {
  entries: AuditLogListEntry[];
  nextCursor: AuditLogCursor | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const CSV_MAX_ROWS = 10_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildWhere(orgId: string, filters: ListAuditLogFilters, cursor?: AuditLogCursor) {
  const conditions = [eq(auditLog.org_id, orgId)];

  if (filters.actionPrefix && filters.actionPrefix.length > 0) {
    conditions.push(like(auditLog.action, `${filters.actionPrefix}%`));
  }
  if (filters.from) conditions.push(gte(auditLog.created_at, filters.from));
  if (filters.to) conditions.push(lte(auditLog.created_at, filters.to));
  if (filters.actorUserId) conditions.push(eq(auditLog.actor_user_id, filters.actorUserId));

  if (cursor) {
    const cursorDate = new Date(cursor.createdAt);
    const cursorId = BigInt(cursor.id);
    // Tuple-comparison-equivalent over (created_at, id):
    //   created_at < cursor.createdAt
    //   OR (created_at = cursor.createdAt AND id < cursor.id)
    const olderThanCursor = or(
      lt(auditLog.created_at, cursorDate),
      and(eq(auditLog.created_at, cursorDate), lt(auditLog.id, cursorId)),
    );
    if (olderThanCursor) conditions.push(olderThanCursor);
  }

  return and(...conditions);
}

async function resolveActorEmails(
  tx: Parameters<Parameters<typeof withSystemContext>[0]>[0],
  rows: Pick<AuditLogEntry, 'actor_user_id'>[],
): Promise<Map<string, string>> {
  const ids = Array.from(
    new Set(rows.map((r) => r.actor_user_id).filter((v): v is string => v !== null)),
  );
  if (ids.length === 0) return new Map();

  const found = await tx
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.id, ids));
  return new Map(found.map((u) => [u.id, u.email]));
}

function toListEntry(row: AuditLogEntry, actorEmail: string | null): AuditLogListEntry {
  return {
    id: String(row.id),
    createdAt: row.created_at,
    actorType: row.actor_type as ActorType,
    actorUserId: row.actor_user_id,
    actorEmail,
    action: row.action,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    metadata: (row.metadata ?? null) as Record<string, unknown> | null,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Lists audit log entries for an organization with cursor pagination. Pages
 * are ordered by `(created_at DESC, id DESC)`. The returned `nextCursor`, when
 * non-null, can be passed back to fetch the next page.
 */
export async function listAuditLog(params: ListAuditLogParams): Promise<ListAuditLogResult> {
  const { orgId, cursor, ...filters } = params;
  const limit = Math.min(Math.max(params.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);

  return withSystemContext(async (tx) => {
    const rows = await tx
      .select()
      .from(auditLog)
      .where(buildWhere(orgId, filters, cursor))
      .orderBy(desc(auditLog.created_at), desc(auditLog.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const emailById = await resolveActorEmails(tx, page);
    const entries = page.map((r) =>
      toListEntry(r, r.actor_user_id ? emailById.get(r.actor_user_id) ?? null : null),
    );

    const last = entries[entries.length - 1];
    const nextCursor: AuditLogCursor | null =
      hasMore && last ? { createdAt: last.createdAt.toISOString(), id: last.id } : null;

    return { entries, nextCursor };
  });
}

// ─── CSV export ───────────────────────────────────────────────────────────────

const CSV_HEADERS = [
  'created_at',
  'actor_type',
  'actor_user_id',
  'actor_email',
  'action',
  'subject_type',
  'subject_id',
  'metadata',
];

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  // CSV-injection (CWE-1236) hardening: cells whose first byte is a spreadsheet
  // formula sigil (`=`, `+`, `-`, `@`, tab, CR) are interpreted as formulas by
  // Excel / LibreOffice / Sheets. Phone numbers exported as `subject_id` always
  // start with `+`, so this prefix triggers on every audit-log CSV. Prepending
  // a tab keeps the displayed value intact while disabling formula evaluation.
  const s = raw.length > 0 && /^[=+\-@\t\r]/.test(raw) ? `\t${raw}` : raw;
  // RFC 4180: enclose in quotes when the cell contains a delimiter, quote or newline.
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export interface BuildAuditLogCsvParams extends ListAuditLogFilters {
  orgId: string;
  /** Hard cap on rows. Defaults to {@link CSV_MAX_ROWS}. */
  maxRows?: number;
}

export interface BuildAuditLogCsvResult {
  csv: string;
  rowCount: number;
  truncated: boolean;
}

/**
 * Builds a CSV string of audit log entries matching the given filters. Pulls
 * up to `maxRows` (default 10 000) rows in `(created_at DESC, id DESC)` order.
 * The CSV header row is always present, even when zero data rows match.
 */
export async function buildAuditLogCsv(
  params: BuildAuditLogCsvParams,
): Promise<BuildAuditLogCsvResult> {
  const { orgId, maxRows = CSV_MAX_ROWS, ...filters } = params;
  const cap = Math.min(Math.max(maxRows, 1), CSV_MAX_ROWS);

  const { rows, emailById } = await withSystemContext(async (tx) => {
    const data = await tx
      .select()
      .from(auditLog)
      .where(buildWhere(orgId, filters))
      .orderBy(desc(auditLog.created_at), desc(auditLog.id))
      .limit(cap + 1);

    const emails = await resolveActorEmails(tx, data);
    return { rows: data, emailById: emails };
  });

  const truncated = rows.length > cap;
  const dataRows = truncated ? rows.slice(0, cap) : rows;

  const lines: string[] = [CSV_HEADERS.join(',')];
  for (const r of dataRows) {
    const actorEmail = r.actor_user_id ? emailById.get(r.actor_user_id) ?? '' : '';
    lines.push(
      [
        r.created_at.toISOString(),
        r.actor_type,
        r.actor_user_id ?? '',
        actorEmail,
        r.action,
        r.subject_type,
        r.subject_id,
        r.metadata,
      ]
        .map(escapeCsvCell)
        .join(','),
    );
  }
  // RFC 4180 prefers CRLF.
  return { csv: lines.join('\r\n'), rowCount: dataRows.length, truncated };
}

'use server';

import { and, desc, eq, inArray, lte } from 'drizzle-orm';
import { headers } from 'next/headers';
import { z } from 'zod';

import { getAuthContext, requireCapability } from '@/lib/auth/context';
import { CURRENT_DPA_VERSION, recordDpaAcceptance } from '@/lib/compliance/dpa';
import {
  eraseSubject,
  SubjectErasureConfirmationError,
  SubjectNotFoundError as ErasureSubjectNotFoundError,
} from '@/lib/compliance/gdpr/erase';
import {
  buildSubjectExport,
  SubjectNotFoundError,
} from '@/lib/compliance/gdpr/export';
import { withSystemContext } from '@/lib/db/context';
import { auditLog, users } from '@/lib/db/schema';
import { sendEmail } from '@/lib/email';
import type { ActionResult } from '@/lib/utils/action-toast';

const requestSubjectExportSchema = z.object({
  identifier: z.string().min(1).max(254),
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface SubjectExportActionData {
  url: string;
  expiresAt: string;
  exportId: string;
  totals: {
    calls: number;
    appointments: number;
    optOuts: number;
    auditEntries: number;
    recordingsBundled: number;
    transcriptsBundled: number;
  };
}

/**
 * Server Action — fulfils a GDPR Article 15 request for the given identifier
 * (phone E.164 or email). Builds a ZIP with every record we hold about the
 * contact, uploads it to Storage with a 7-day signed URL, returns the URL for
 * immediate download, and emails the link to the requesting member.
 *
 * Requires capability `compliance.export` (owner / admin / viewer).
 */
export async function requestSubjectExport(
  input: z.infer<typeof requestSubjectExportSchema>,
): Promise<ActionResult & { data?: SubjectExportActionData }> {
  const parsed = requestSubjectExportSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'validation_error' };
  }

  try {
    const { orgId, userId } = await getAuthContext();
    await requireCapability('compliance.export');

    const result = await buildSubjectExport({
      orgId,
      identifier: parsed.data.identifier,
      actorUserId: userId,
    });

    // Look up requester email so we can send the link as a backup channel.
    const [requester] = await withSystemContext(async (tx) =>
      tx.select({ email: users.email, fullName: users.full_name }).from(users).where(eq(users.id, userId)).limit(1),
    );

    if (requester?.email) {
      const expiresHuman = result.expiresAt.toUTCString();
      const escapedUrl = escapeHtml(result.signedUrl);
      const escapedName = requester.fullName ? escapeHtml(requester.fullName) : '';
      const html = `
        <p>Buongiorno${escapedName ? ` ${escapedName}` : ''},</p>
        <p>L'export dei dati del contatto richiesto (GDPR Articolo 15) è pronto.</p>
        <p><a href="${escapedUrl}">Scarica l'archivio ZIP</a></p>
        <p>Il link è valido fino al ${expiresHuman} (7 giorni dalla generazione).</p>
        <p>Contenuto: contatto, chiamate, appuntamenti, opt-out, voci di audit log, registrazioni e trascrizioni.</p>
      `;
      // Don't fail the action if email delivery fails — the user already has
      // the URL inline.
      try {
        await sendEmail({
          to: requester.email,
          subject: 'Export dati GDPR pronto',
          html,
        });
      } catch (e) {
        console.error('[requestSubjectExport] email send failed:', e);
      }
    }

    return {
      ok: true,
      data: {
        url: result.signedUrl,
        expiresAt: result.expiresAt.toISOString(),
        exportId: result.exportId,
        totals: result.totals,
      },
    };
  } catch (e) {
    if (e instanceof SubjectNotFoundError) {
      return { ok: false, message: 'subject_not_found' };
    }
    return { ok: false, message: e instanceof Error ? e.message : 'export_failed' };
  }
}

const requestSubjectErasureSchema = z.object({
  identifier: z.string().min(1).max(254),
  confirmPhone: z.string().min(1).max(32),
  reason: z.string().min(1).max(500),
});

export interface SubjectErasureActionData {
  contactId: string;
  phoneE164: string;
  totals: {
    callsScrubbed: number;
    recordingsDeleted: number;
    transcriptsDeleted: number;
    storageErrors: number;
  };
}

/**
 * Server Action — fulfils a GDPR Article 17 erasure request. Resolves the
 * contact by phone or email, scrubs PII, tombstones call metadata, deletes
 * recordings and transcripts from Storage, and registers a permanent opt-out.
 *
 * Requires capability `compliance.erase` (owner / admin only).
 *
 * The caller must also pass `confirmPhone` equal to the contact's phone
 * number — the UI surfaces this as a retype-to-confirm gate. Mismatches
 * surface as `confirmation_mismatch` without performing any writes.
 */
export async function requestSubjectErasure(
  input: z.infer<typeof requestSubjectErasureSchema>,
): Promise<ActionResult & { data?: SubjectErasureActionData }> {
  const parsed = requestSubjectErasureSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'validation_error' };
  }

  try {
    const { orgId, userId } = await getAuthContext();
    await requireCapability('compliance.erase');

    const result = await eraseSubject({
      orgId,
      byUserId: userId,
      identifier: parsed.data.identifier,
      reason: parsed.data.reason,
      confirmPhone: parsed.data.confirmPhone,
    });

    return {
      ok: true,
      data: {
        contactId: result.contactId,
        phoneE164: result.phoneE164,
        totals: result.totals,
      },
    };
  } catch (e) {
    if (e instanceof ErasureSubjectNotFoundError) {
      return { ok: false, message: 'subject_not_found' };
    }
    if (e instanceof SubjectErasureConfirmationError) {
      return { ok: false, message: 'confirmation_mismatch' };
    }
    return { ok: false, message: e instanceof Error ? e.message : 'erasure_failed' };
  }
}

// ─── GDPR history listing ────────────────────────────────────────────────────

export type GdprHistoryEntryAction = 'compliance.gdpr_export' | 'compliance.gdpr_erasure';

export interface GdprHistoryEntry {
  id: string;
  action: GdprHistoryEntryAction;
  createdAt: string;
  actorUserId: string | null;
  actorEmail: string | null;
  subjectId: string;
  metadata: Record<string, unknown> | null;
}

const GDPR_HISTORY_ACTIONS: GdprHistoryEntryAction[] = [
  'compliance.gdpr_export',
  'compliance.gdpr_erasure',
];

/**
 * Lists the most recent GDPR export and erasure audit entries for the active
 * org. Powers the "Storico richieste GDPR" section of the compliance settings
 * page.
 *
 * Requires capability `compliance.export` (read-only listing — anyone who can
 * trigger an export can also see prior requests).
 */
export async function listGdprHistory(
  input: { limit?: number; before?: string } = {},
): Promise<ActionResult & { data?: { entries: GdprHistoryEntry[] } }> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);

  try {
    const { orgId } = await getAuthContext();
    await requireCapability('compliance.export');

    const rows = await withSystemContext(async (tx) => {
      const baseConditions = [
        eq(auditLog.org_id, orgId),
        inArray(auditLog.action, GDPR_HISTORY_ACTIONS),
      ];
      if (input.before) {
        baseConditions.push(lte(auditLog.created_at, new Date(input.before)));
      }

      const entries = await tx
        .select({
          id: auditLog.id,
          action: auditLog.action,
          createdAt: auditLog.created_at,
          actorUserId: auditLog.actor_user_id,
          subjectId: auditLog.subject_id,
          metadata: auditLog.metadata,
        })
        .from(auditLog)
        .where(and(...baseConditions))
        .orderBy(desc(auditLog.created_at))
        .limit(limit);

      // Resolve actor emails in a single query.
      const actorIds = Array.from(
        new Set(entries.map((e) => e.actorUserId).filter((v): v is string => v !== null)),
      );
      const actorRows = actorIds.length
        ? await tx
            .select({ id: users.id, email: users.email })
            .from(users)
            .where(inArray(users.id, actorIds))
        : [];
      const actorEmailById = new Map(actorRows.map((u) => [u.id, u.email]));

      return entries.map((e) => ({
        id: String(e.id),
        action: e.action as GdprHistoryEntryAction,
        createdAt: e.createdAt.toISOString(),
        actorUserId: e.actorUserId,
        actorEmail: e.actorUserId ? actorEmailById.get(e.actorUserId) ?? null : null,
        subjectId: e.subjectId,
        metadata: (e.metadata ?? null) as Record<string, unknown> | null,
      }));
    });

    return { ok: true, data: { entries: rows } };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'history_failed' };
  }
}

// ─── DPA re-acceptance ───────────────────────────────────────────────────────

/**
 * Server Action — records re-acceptance of the current DPA version for the
 * active org. Called by the in-app banner shown to organisations whose latest
 * accepted DPA version is older than {@link CURRENT_DPA_VERSION}.
 *
 * No capability gate beyond a valid auth context: any active member of the org
 * may re-accept on behalf of the organization. The acceptance row records
 * which user, IP and user-agent confirmed.
 */
export async function acceptCurrentDpaVersion(): Promise<
  ActionResult & { data?: { version: string } }
> {
  try {
    const { orgId, userId } = await getAuthContext();

    const h = await headers();
    const ip =
      h.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      h.get('x-real-ip')?.trim() ??
      null;
    const userAgent = h.get('user-agent') ?? null;

    await recordDpaAcceptance({ orgId, userId, ip, userAgent });

    return { ok: true, data: { version: CURRENT_DPA_VERSION } };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'dpa_accept_failed' };
  }
}

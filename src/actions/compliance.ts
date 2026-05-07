'use server';

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { getAuthContext, requireCapability } from '@/lib/auth/context';
import {
  buildSubjectExport,
  SubjectNotFoundError,
} from '@/lib/compliance/gdpr/export';
import { withSystemContext } from '@/lib/db/context';
import { users } from '@/lib/db/schema';
import { sendEmail } from '@/lib/email';
import type { ActionResult } from '@/lib/utils/action-toast';

const requestSubjectExportSchema = z.object({
  identifier: z.string().min(1).max(254),
});

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
      const escapedUrl = result.signedUrl.replace(/"/g, '&quot;');
      const html = `
        <p>Buongiorno${requester.fullName ? ` ${requester.fullName}` : ''},</p>
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

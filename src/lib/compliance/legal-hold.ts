/**
 * Legal hold helpers (plan 11 task 14).
 *
 * A legal hold pins a contact and its associated artefacts (call recordings,
 * transcripts, soft-deleted row) so the retention purge cron does not touch
 * them while litigation, regulatory enquiry, or internal investigation is in
 * progress. Holds are stored on `contacts.legal_hold_until` (timestamptz):
 *
 *   - NULL              → no hold; retention applies normally.
 *   - future timestamp  → hold active; retention skips this contact.
 *   - past timestamp    → hold expired; retention resumes (the next cron run
 *                         simply doesn't pick the row up in `held` set).
 *
 * Founder-only: `setLegalHold` is gated by the admin token pattern used by
 * `/admin/disclosure-failures`; the routine bypasses RLS via
 * `withSystemContext` so the founder can hold contacts across any org. Every
 * change writes a `compliance.legal_hold_changed` audit_log row including
 * prior and new values for traceability.
 */

import { and, eq } from 'drizzle-orm';

import { recordAudit } from '@/lib/db/audit';
import { withSystemContext } from '@/lib/db/context';
import { contacts } from '@/lib/db/schema';

export class ContactNotFoundError extends Error {
  constructor(public readonly orgId: string, public readonly contactId: string) {
    super(`Contact ${contactId} not found in org ${orgId}`);
    this.name = 'ContactNotFoundError';
  }
}

export interface SetLegalHoldInput {
  orgId: string;
  contactId: string;
  /** New `legal_hold_until` value. Pass `null` to clear an existing hold. */
  untilDate: Date | null;
  reason: string;
  /** Free-form actor identifier (e.g. founder email) persisted with the audit row. */
  actor?: string | null;
}

export interface SetLegalHoldResult {
  contactId: string;
  orgId: string;
  previousLegalHoldUntil: Date | null;
  legalHoldUntil: Date | null;
}

/**
 * Sets (or clears) a legal hold on one contact. Idempotent: re-applying the
 * same value is a no-op at the row level but still writes an audit entry so
 * the trail records every operator action.
 *
 * Throws {@link ContactNotFoundError} if the contact does not exist in the
 * specified org. Cross-org operation; runs under `withSystemContext`.
 */
export async function setLegalHold(input: SetLegalHoldInput): Promise<SetLegalHoldResult> {
  const { orgId, contactId, untilDate, reason } = input;
  const actor = input.actor?.trim() || null;

  return withSystemContext(async (tx) => {
    const [existing] = await tx
      .select({
        id: contacts.id,
        org_id: contacts.org_id,
        legal_hold_until: contacts.legal_hold_until,
      })
      .from(contacts)
      .where(and(eq(contacts.org_id, orgId), eq(contacts.id, contactId)))
      .limit(1);

    if (!existing) {
      throw new ContactNotFoundError(orgId, contactId);
    }

    const previous = existing.legal_hold_until ?? null;

    await tx
      .update(contacts)
      .set({ legal_hold_until: untilDate })
      .where(and(eq(contacts.org_id, orgId), eq(contacts.id, contactId)));

    await recordAudit(tx, {
      orgId,
      actorType: 'system',
      action: 'compliance.legal_hold_changed',
      subjectType: 'contact',
      subjectId: contactId,
      metadata: {
        previousLegalHoldUntil: previous?.toISOString() ?? null,
        legalHoldUntil: untilDate?.toISOString() ?? null,
        reason,
        actor,
      },
    });

    return {
      contactId,
      orgId,
      previousLegalHoldUntil: previous,
      legalHoldUntil: untilDate,
    };
  });
}

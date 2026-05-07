'use server';

import { timingSafeEqual } from 'crypto';

import {
  ContactNotFoundError,
  setLegalHold,
  type SetLegalHoldResult,
} from '@/lib/compliance/legal-hold';
import { env } from '@/lib/env';

const MAX_REASON_LENGTH = 2000;
const MAX_ACTOR_LENGTH = 200;

function tokenIsValid(token: string | null): boolean {
  if (!token || token.length === 0) return false;
  const expected = env.INTERNAL_ADMIN_TOKEN;
  if (token.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}

export interface SetLegalHoldActionResult {
  ok: boolean;
  message: string;
  data?: {
    contactId: string;
    orgId: string;
    legalHoldUntil: string | null;
    previousLegalHoldUntil: string | null;
  };
}

/**
 * Founder-only Server Action — pins (or releases) a legal hold on one
 * contact. Token-authorized via `INTERNAL_ADMIN_TOKEN` (same gate as the
 * `/admin/disclosure-failures` dashboard) so it can be invoked across orgs
 * from internal tooling without the dealer-facing capability machinery.
 *
 * Form fields:
 *   token       — required, must match `INTERNAL_ADMIN_TOKEN`
 *   orgId       — required, target organization
 *   contactId   — required, contact within the org
 *   untilDate   — ISO-8601 timestamp; empty string clears an existing hold
 *   reason      — required, persisted on the audit row
 *   actor       — optional free-form (e.g. founder email)
 */
export async function setLegalHoldAction(
  formData: FormData,
): Promise<SetLegalHoldActionResult> {
  const token = formData.get('token');
  if (typeof token !== 'string' || !tokenIsValid(token)) {
    return { ok: false, message: 'Unauthorized' };
  }

  const orgId = formData.get('orgId');
  const contactId = formData.get('contactId');
  const untilDateRaw = formData.get('untilDate');
  const reason = formData.get('reason');
  const actor = formData.get('actor');

  if (typeof orgId !== 'string' || orgId.length === 0) {
    return { ok: false, message: 'Missing orgId' };
  }
  if (typeof contactId !== 'string' || contactId.length === 0) {
    return { ok: false, message: 'Missing contactId' };
  }
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    return { ok: false, message: 'Missing reason' };
  }

  let untilDate: Date | null = null;
  if (typeof untilDateRaw === 'string' && untilDateRaw.length > 0) {
    const parsed = new Date(untilDateRaw);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, message: 'Invalid untilDate' };
    }
    untilDate = parsed;
  }

  const reasonValue = reason.slice(0, MAX_REASON_LENGTH);
  const actorValue = typeof actor === 'string' ? actor.slice(0, MAX_ACTOR_LENGTH) : null;

  let result: SetLegalHoldResult;
  try {
    result = await setLegalHold({
      orgId,
      contactId,
      untilDate,
      reason: reasonValue,
      actor: actorValue,
    });
  } catch (err) {
    if (err instanceof ContactNotFoundError) {
      return { ok: false, message: 'Contact not found' };
    }
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Failed to set legal hold',
    };
  }

  return {
    ok: true,
    message: result.legalHoldUntil ? 'Hold applied' : 'Hold cleared',
    data: {
      contactId: result.contactId,
      orgId: result.orgId,
      legalHoldUntil: result.legalHoldUntil?.toISOString() ?? null,
      previousLegalHoldUntil: result.previousLegalHoldUntil?.toISOString() ?? null,
    },
  };
}

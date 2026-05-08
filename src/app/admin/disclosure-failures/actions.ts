'use server';

import { timingSafeEqual } from 'crypto';

import { revalidatePath } from 'next/cache';

import {
  isDisclosureTriageStatus,
  updateDisclosureTriage,
} from '@/lib/compliance/aiact/triage';
import { env } from '@/lib/env';

const MAX_NOTE_LENGTH = 2000;
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

export interface TriageActionResult {
  ok: boolean;
  message: string;
}

export async function triageDisclosureFailureAction(
  formData: FormData,
): Promise<TriageActionResult> {
  const token = formData.get('token');
  if (typeof token !== 'string' || !tokenIsValid(token)) {
    return { ok: false, message: 'Unauthorized' };
  }

  const callId = formData.get('callId');
  const status = formData.get('status');
  const note = formData.get('note');
  const actor = formData.get('actor');
  const filterStatus = formData.get('filterStatus');

  if (typeof callId !== 'string' || callId.length === 0) {
    return { ok: false, message: 'Missing callId' };
  }
  if (!isDisclosureTriageStatus(status)) {
    return { ok: false, message: 'Invalid status' };
  }
  const noteValue = typeof note === 'string' ? note.slice(0, MAX_NOTE_LENGTH) : null;
  const actorValue = typeof actor === 'string' ? actor.slice(0, MAX_ACTOR_LENGTH) : null;

  const result = await updateDisclosureTriage({
    callId,
    status,
    note: noteValue,
    actor: actorValue,
  });

  if (!result.ok) {
    return { ok: false, message: 'Call not found or not a disclosure failure' };
  }

  // `revalidatePath` keys the cache on path only (search-params aren't part
  // of its key); the form's hidden `filterStatus` carries the active filter
  // through to the next request so the page renders the same view.
  void filterStatus;
  revalidatePath('/admin/disclosure-failures');
  return { ok: true, message: 'Updated' };
}

/**
 * Form-action wrapper around `triageDisclosureFailureAction` for use as a
 * `<form action={...}>`. Returns void so it satisfies the React form-action
 * type contract; the underlying handler still records audit log entries on
 * success and silently no-ops on validation failure (the page re-renders).
 */
export async function triageDisclosureFailureFormAction(
  formData: FormData,
): Promise<void> {
  await triageDisclosureFailureAction(formData);
}

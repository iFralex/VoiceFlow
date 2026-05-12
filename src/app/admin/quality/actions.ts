'use server';

import { timingSafeEqual } from 'crypto';

import { revalidatePath } from 'next/cache';

import { env } from '@/lib/env';
import {
  isQaReviewStatus,
  type QaChecklist,
  type QaReviewStatus,
  updateQaReview,
} from '@/lib/services/quality-reviews';

const MAX_NOTE_LENGTH = 2000;
const MAX_REVIEWER_LENGTH = 200;

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

function parseCheckbox(formData: FormData, name: string): boolean | null {
  const val = formData.get(name);
  if (val === 'true') return true;
  if (val === 'false') return false;
  return null;
}

export async function updateQaReviewFormAction(formData: FormData): Promise<void> {
  const token = formData.get('token');
  if (typeof token !== 'string' || !tokenIsValid(token)) return;

  const reviewIdStr = formData.get('reviewId');
  if (typeof reviewIdStr !== 'string' || reviewIdStr.length === 0) return;
  const reviewId = BigInt(reviewIdStr);

  const statusRaw = formData.get('status');
  if (typeof statusRaw !== 'string' || !isQaReviewStatus(statusRaw)) return;
  const status: QaReviewStatus = statusRaw;

  const rawNote = formData.get('note');
  const note = typeof rawNote === 'string' && rawNote.length > 0 ? rawNote.slice(0, MAX_NOTE_LENGTH) : null;

  const rawReviewer = formData.get('reviewer');
  const reviewedBy =
    typeof rawReviewer === 'string' && rawReviewer.length > 0
      ? rawReviewer.slice(0, MAX_REVIEWER_LENGTH)
      : null;

  const checklist: QaChecklist = {
    disclosure_verified: parseCheckbox(formData, 'disclosure_verified'),
    transcript_readable: parseCheckbox(formData, 'transcript_readable'),
    outcome_correct: parseCheckbox(formData, 'outcome_correct'),
    no_offensive: parseCheckbox(formData, 'no_offensive'),
    no_privacy_leak: parseCheckbox(formData, 'no_privacy_leak'),
  };

  await updateQaReview({ reviewId, status, checklist, note, reviewedBy });
  revalidatePath('/admin/quality');
}

'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthContext } from '@/lib/auth/context';
import {
  NOTIFICATION_KEYS,
  type NotificationPreferences,
  updateNotificationPreferences,
} from '@/lib/services/notification-preferences';
import type { ActionResult } from '@/lib/utils/action-toast';

const schema = z
  .object(
    Object.fromEntries(NOTIFICATION_KEYS.map((k) => [k, z.boolean().optional()])) as Record<
      (typeof NOTIFICATION_KEYS)[number],
      z.ZodOptional<z.ZodBoolean>
    >,
  )
  .strict();

export async function updateNotificationPreferencesAction(
  input: Partial<NotificationPreferences>,
): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: 'validation_error' };
  }

  const { userId, orgId } = await getAuthContext();

  // exactOptionalPropertyTypes: drop the `undefined` values that Zod's
  // .optional() leaves in the parsed object so the service receives a clean
  // partial.
  const update: Partial<NotificationPreferences> = {};
  for (const key of NOTIFICATION_KEYS) {
    const value = parsed.data[key];
    if (typeof value === 'boolean') update[key] = value;
  }

  try {
    await updateNotificationPreferences(userId, orgId, update);
    revalidatePath('/settings/notifications');
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'error_generic';
    return { ok: false, message };
  }
}

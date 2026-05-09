import { getAuthContext } from '@/lib/auth/context';
import { getNotificationPreferences } from '@/lib/services/notification-preferences';

import { NotificationsSettingsClient } from './_components/notifications-settings-client';

export default async function NotificationsSettingsPage() {
  const { userId, orgId } = await getAuthContext();
  const prefs = await getNotificationPreferences(userId, orgId);

  return <NotificationsSettingsClient initialPrefs={prefs} />;
}

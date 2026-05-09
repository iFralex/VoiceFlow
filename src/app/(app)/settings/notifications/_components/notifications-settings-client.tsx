'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { updateNotificationPreferencesAction } from '@/actions/notification-preferences';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  type NotificationKey,
  type NotificationPreferences,
} from '@/lib/services/notification-preferences';
import { toastResult } from '@/lib/utils/action-toast';

interface NotificationsSettingsClientProps {
  initialPrefs: NotificationPreferences;
}

const TOGGLES: Array<{ key: NotificationKey; labelKey: string; descriptionKey: string }> = [
  {
    key: 'daily_report',
    labelKey: 'daily_report_label',
    descriptionKey: 'daily_report_description',
  },
  {
    key: 'appointment_booked',
    labelKey: 'appointment_booked_label',
    descriptionKey: 'appointment_booked_description',
  },
  {
    key: 'qualified_lead',
    labelKey: 'qualified_lead_label',
    descriptionKey: 'qualified_lead_description',
  },
  {
    key: 'low_credit',
    labelKey: 'low_credit_label',
    descriptionKey: 'low_credit_description',
  },
  {
    key: 'campaign_completed',
    labelKey: 'campaign_completed_label',
    descriptionKey: 'campaign_completed_description',
  },
  {
    key: 'weekly_summary',
    labelKey: 'weekly_summary_label',
    descriptionKey: 'weekly_summary_description',
  },
];

export function NotificationsSettingsClient({ initialPrefs }: NotificationsSettingsClientProps) {
  const t = useTranslations('notifications_settings');
  const [prefs, setPrefs] = useState<NotificationPreferences>(initialPrefs);
  const [pendingKey, setPendingKey] = useState<NotificationKey | null>(null);
  const [, startTransition] = useTransition();

  function handleToggle(key: NotificationKey, value: boolean) {
    const previous = prefs[key];
    setPrefs((p) => ({ ...p, [key]: value }));
    setPendingKey(key);

    startTransition(async () => {
      const result = await updateNotificationPreferencesAction({ [key]: value });
      if (!result.ok) {
        // Revert optimistic update on failure
        setPrefs((p) => ({ ...p, [key]: previous }));
        toastResult(result);
      } else {
        toastResult({ ok: true, message: t('save_success') });
      }
      setPendingKey(null);
    });
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      <div className="rounded-lg border divide-y">
        {TOGGLES.map((toggle) => {
          const id = `notif-${toggle.key}`;
          const checked = prefs[toggle.key];
          const isPending = pendingKey === toggle.key;
          return (
            <div
              key={toggle.key}
              className="flex items-start justify-between gap-4 p-4"
            >
              <div className="space-y-1">
                <Label htmlFor={id}>{t(toggle.labelKey)}</Label>
                <p className="text-sm text-muted-foreground">{t(toggle.descriptionKey)}</p>
              </div>
              <Switch
                id={id}
                checked={checked}
                disabled={isPending}
                onCheckedChange={(value) => handleToggle(toggle.key, value)}
                aria-label={t(toggle.labelKey)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

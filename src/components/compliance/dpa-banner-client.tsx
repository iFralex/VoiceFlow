'use client';

import { useTranslations } from 'next-intl';
import { useTransition } from 'react';

import { acceptCurrentDpaVersion } from '@/actions/compliance';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { toastResult } from '@/lib/utils/action-toast';

export interface DpaBannerClientProps {
  state: 'outdated' | 'never_accepted';
  acceptedVersion: string | null;
  currentVersion: string;
}

export function DpaBannerClient({
  state,
  acceptedVersion,
  currentVersion,
}: DpaBannerClientProps) {
  const t = useTranslations('compliance_settings');
  const [isPending, startTransition] = useTransition();

  function handleAccept() {
    startTransition(async () => {
      const result = await acceptCurrentDpaVersion();
      toastResult(result, t('dpa_banner_accept_success'));
      if (result.ok) {
        // Refresh server-rendered DPA status so the banner disappears.
        window.location.reload();
      }
    });
  }

  return (
    <Alert variant="destructive" className="mb-4">
      <AlertTitle>{t('dpa_banner_title')}</AlertTitle>
      <AlertDescription>
        {state === 'never_accepted'
          ? t('dpa_banner_description_never', { currentVersion })
          : t('dpa_banner_description_outdated', {
              acceptedVersion: acceptedVersion ?? '',
              currentVersion,
            })}
      </AlertDescription>
      <AlertAction>
        <Button size="sm" onClick={handleAccept} disabled={isPending}>
          {isPending ? t('dpa_banner_accepting') : t('dpa_banner_accept')}
        </Button>
      </AlertAction>
    </Alert>
  );
}

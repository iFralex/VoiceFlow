'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';

import { revokePatAction } from '@/actions/pat';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { toastResult } from '@/lib/utils/action-toast';

import { CreatePatDialog } from './create-pat-dialog';

export interface SerializedPat {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

interface Props {
  pats: SerializedPat[];
}

function RevokeButton({ patId }: { patId: string }) {
  const t = useTranslations('integrations');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleRevoke() {
    startTransition(async () => {
      const result = await revokePatAction({ patId });
      toastResult(result);
      if (result.ok) {
        router.refresh();
      }
    });
  }

  return (
    <Button
      variant="destructive"
      size="sm"
      disabled={isPending}
      onClick={handleRevoke}
    >
      {t('revoke')}
    </Button>
  );
}

export function IntegrationsPageClient({ pats }: Props) {
  const t = useTranslations('integrations');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t('pat_title')}</h2>
          <p className="text-sm text-muted-foreground">{t('pat_description')}</p>
        </div>
        <CreatePatDialog />
      </div>

      {pats.length === 0 ? (
        <EmptyState title={t('no_tokens')} />
      ) : (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">{t('column_name')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('column_prefix')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('column_scopes')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('column_last_used')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('column_created')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('column_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {pats.map((pat) => (
                <tr key={pat.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium">{pat.name}</td>
                  <td className="px-4 py-3">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{pat.prefix}…</code>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {pat.scopes.map((s) => (
                        <span key={s} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                          {s}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {pat.last_used_at
                      ? new Date(pat.last_used_at).toLocaleDateString('it-IT')
                      : t('never_used')}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(pat.created_at).toLocaleDateString('it-IT')}
                  </td>
                  <td className="px-4 py-3">
                    <RevokeButton patId={pat.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

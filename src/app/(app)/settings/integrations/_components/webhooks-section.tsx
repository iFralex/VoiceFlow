'use client';

import { Copy } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { deleteWebhookAction, rotateSecretAction } from '@/actions/webhooks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { toastResult } from '@/lib/utils/action-toast';

import { CreateWebhookDialog } from './create-webhook-dialog';
import { WebhookDeliveriesDrawer } from './webhook-deliveries-drawer';

export interface SerializedWebhook {
  id: string;
  url: string;
  event_types: string[];
  active: boolean;
  failure_count: number;
  last_delivery_at: string | null;
  created_at: string;
}

function RotateSecretButton({ webhookId }: { webhookId: string }) {
  const t = useTranslations('webhooks');
  const tc = useTranslations('common');
  const [isPending, startTransition] = useTransition();
  const [secret, setSecret] = useState<string | null>(null);

  function handleRotate() {
    startTransition(async () => {
      const result = await rotateSecretAction({ webhookId });
      if (result.ok && result.secretRevealed) {
        setSecret(result.secretRevealed);
      } else {
        toastResult(result);
      }
    });
  }

  function copySecret() {
    if (secret) {
      void navigator.clipboard.writeText(secret);
    }
  }

  return (
    <>
      <ConfirmDialog
        trigger={
          <Button size="sm" variant="outline" disabled={isPending}>
            {t('rotate_secret')}
          </Button>
        }
        title={t('rotate_secret_confirm_title')}
        description={t('rotate_secret_confirm_description')}
        onConfirm={handleRotate}
        loading={isPending}
      />

      <Dialog open={!!secret} onOpenChange={(v) => { if (!v) setSecret(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('secret_rotated_title')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t('webhook_secret_description')}</p>
          <div className="flex items-center gap-2 rounded-md border bg-muted px-3 py-2">
            <code className="flex-1 break-all text-xs">{secret}</code>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={copySecret}
              aria-label={t('copy_secret')}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setSecret(null)}>{tc('confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DeleteWebhookButton({ webhookId }: { webhookId: string }) {
  const t = useTranslations('webhooks');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteWebhookAction({ webhookId });
      toastResult(result);
      if (result.ok) {
        router.refresh();
      }
    });
  }

  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="destructive" disabled={isPending}>
          {t('delete')}
        </Button>
      }
      title={t('delete_confirm_title')}
      description={t('delete_confirm_description')}
      onConfirm={handleDelete}
      loading={isPending}
    />
  );
}

interface Props {
  webhooks: SerializedWebhook[];
}

export function WebhooksSection({ webhooks }: Props) {
  const t = useTranslations('webhooks');

  function getStatusBadge(webhook: SerializedWebhook) {
    if (!webhook.active) {
      return <Badge variant="destructive">{t('status_inactive')}</Badge>;
    }
    if (webhook.failure_count > 0) {
      return <Badge variant="outline">{t('status_cooling', { count: webhook.failure_count })}</Badge>;
    }
    return <Badge variant="secondary">{t('status_active')}</Badge>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <CreateWebhookDialog />
      </div>

      {webhooks.length === 0 ? (
        <EmptyState title={t('no_webhooks')} />
      ) : (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">{t('column_url')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('column_events')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('column_status')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('column_last_delivery')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('column_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {webhooks.map((webhook) => (
                <tr key={webhook.id} className="border-b last:border-0">
                  <td className="max-w-xs px-4 py-3">
                    <span className="block truncate text-xs font-mono" title={webhook.url}>
                      {webhook.url}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {webhook.event_types.map((et) => (
                        <span key={et} className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                          {et}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">{getStatusBadge(webhook)}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {webhook.last_delivery_at
                      ? new Date(webhook.last_delivery_at).toLocaleString('it-IT')
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <WebhookDeliveriesDrawer webhookId={webhook.id} webhookUrl={webhook.url} />
                      <RotateSecretButton webhookId={webhook.id} />
                      <DeleteWebhookButton webhookId={webhook.id} />
                    </div>
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

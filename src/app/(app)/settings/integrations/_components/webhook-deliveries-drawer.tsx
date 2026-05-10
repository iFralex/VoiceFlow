'use client';

import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { listDeliveriesAction, replayDeliveryAction } from '@/actions/webhooks';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { toastResult } from '@/lib/utils/action-toast';

interface SerializedDelivery {
  id: string;
  webhook_id: string;
  event_type: string;
  payload: unknown;
  status_code: number | null;
  attempt: number;
  delivered_at: string | null;
  error: string | null;
}

interface DeliveryRowProps {
  delivery: SerializedDelivery;
}

function DeliveryRow({ delivery }: DeliveryRowProps) {
  const t = useTranslations('webhooks');
  const [expanded, setExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();

  const isSuccess = delivery.status_code !== null && delivery.status_code >= 200 && delivery.status_code < 300;

  function handleReplay() {
    startTransition(async () => {
      const result = await replayDeliveryAction({ deliveryId: delivery.id });
      toastResult(result);
    });
  }

  return (
    <div className="border-b last:border-0">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-muted/50"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="text-muted-foreground">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
        <span className="flex-1 text-xs">
          <code>{delivery.event_type}</code>
        </span>
        <span
          className={`rounded px-1.5 py-0.5 text-xs font-medium ${
            isSuccess
              ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
          }`}
        >
          {delivery.status_code ?? t('delivery_no_response')}
        </span>
        <span className="text-xs text-muted-foreground">
          {delivery.delivered_at
            ? new Date(delivery.delivered_at).toLocaleString('it-IT')
            : '—'}
        </span>
      </button>

      {expanded && (
        <div className="space-y-3 bg-muted/30 px-4 pb-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {t('delivery_attempt')} #{delivery.attempt}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={handleReplay}
            >
              <RotateCcw className="mr-1 h-3 w-3" />
              {t('replay')}
            </Button>
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">{t('delivery_payload')}</p>
            <pre className="max-h-40 overflow-auto rounded bg-muted p-2 text-xs">
              {JSON.stringify(delivery.payload, null, 2)}
            </pre>
          </div>

          {delivery.error && (
            <div>
              <p className="mb-1 text-xs font-medium text-destructive">{t('delivery_error')}</p>
              <pre className="max-h-20 overflow-auto rounded bg-destructive/10 p-2 text-xs text-destructive">
                {delivery.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface Props {
  webhookId: string;
  webhookUrl: string;
}

export function WebhookDeliveriesDrawer({ webhookId, webhookUrl }: Props) {
  const t = useTranslations('webhooks');
  const [open, setOpen] = useState(false);
  const [deliveries, setDeliveries] = useState<SerializedDelivery[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  async function loadDeliveries(cursor?: string) {
    setIsLoading(true);
    try {
      const arg: { webhookId: string; limit: number; cursor?: string } = { webhookId, limit: 20 };
      if (cursor) arg.cursor = cursor;
      const result = await listDeliveriesAction(arg);
      if (result.ok && result.items) {
        if (cursor) {
          setDeliveries((prev) => [...prev, ...(result.items ?? [])]);
        } else {
          setDeliveries(result.items);
        }
        setNextCursor(result.nextCursor);
      } else {
        toastResult(result);
      }
    } finally {
      setIsLoading(false);
      setHasLoaded(true);
    }
  }

  function handleOpenChange(v: boolean) {
    setOpen(v);
    if (v && !hasLoaded) {
      void loadDeliveries();
    }
    if (!v) {
      setDeliveries([]);
      setNextCursor(undefined);
      setHasLoaded(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline">
          {t('view_deliveries')}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle>{t('deliveries_title')}</SheetTitle>
          <p className="text-xs text-muted-foreground break-all">{webhookUrl}</p>
        </SheetHeader>

        {isLoading && deliveries.length === 0 ? (
          <div className="flex justify-center py-8 text-sm text-muted-foreground">
            {t('loading_deliveries')}
          </div>
        ) : deliveries.length === 0 && hasLoaded ? (
          <EmptyState title={t('no_deliveries')} />
        ) : (
          <div className="rounded-md border">
            {deliveries.map((d) => (
              <DeliveryRow key={d.id} delivery={d} />
            ))}
          </div>
        )}

        {nextCursor && (
          <div className="mt-4 flex justify-center">
            <Button
              variant="outline"
              size="sm"
              disabled={isLoading}
              onClick={() => void loadDeliveries(nextCursor)}
            >
              {isLoading ? t('loading_more') : t('load_more')}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

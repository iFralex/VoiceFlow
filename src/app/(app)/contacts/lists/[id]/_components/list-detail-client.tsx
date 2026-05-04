'use client';

import { AlertCircle, ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  getContactListStatus,
  getImportErrorsUrl,
} from '@/actions/contacts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';

import { AddContactDialog } from './add-contact-dialog';
import { ContactsTable } from './contacts-table';

// ---------------------------------------------------------------------------
// Serialized types shared with page.tsx
// ---------------------------------------------------------------------------

export interface SerializedList {
  id: string;
  name: string;
  source: 'csv-upload' | 'zapier' | 'api';
  source_file_path: string | null;
  total_count: number;
  valid_count: number;
  import_status: 'pending' | 'parsing' | 'completed' | 'failed' | null;
  created_at: string;
}

export interface SerializedContact {
  id: string;
  phone_e164: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  opt_out: boolean;
  rpo_status: 'clear' | 'blocked' | 'unchecked';
  metadata: Record<string, unknown> | null;
}

interface Props {
  list: SerializedList;
  contacts: SerializedContact[];
  listId: string;
  orgId: string;
}

const POLL_INTERVAL_MS = 3000;

function sourceLabel(source: SerializedList['source'], t: ReturnType<typeof useTranslations<'contacts'>>): string {
  if (source === 'csv-upload') return t('list_source_csv_upload');
  if (source === 'zapier') return t('list_source_zapier');
  return t('list_source_api');
}

export function ListDetailClient({ list, contacts, listId, orgId }: Props) {
  const t = useTranslations('contacts');
  const router = useRouter();
  const [listState, setListState] = useState<SerializedList>(list);
  const [errorsUrl, setErrorsUrl] = useState<string | null>(null);
  const [loadingErrors, startErrorsTransition] = useTransition();

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function clearPolling() {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }

  function stopPollingAndRefresh() {
    clearPolling();
    router.refresh();
  }

  // Poll for import status changes when in pending/parsing state
  useEffect(() => {
    const currentStatus = listState.import_status;
    if (currentStatus === 'completed' || currentStatus === 'failed') return;

    // Realtime subscription on the contact_lists row
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`contact_lists:${listId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'contact_lists',
          filter: `id=eq.${listId}`,
        },
        (payload: { new: Record<string, unknown> }) => {
          const newStatus = payload.new['import_status'] as string | null;
          const newTotal = typeof payload.new['total_count'] === 'number' ? payload.new['total_count'] : listState.total_count;
          const newValid = typeof payload.new['valid_count'] === 'number' ? payload.new['valid_count'] : listState.valid_count;
          setListState((prev) => ({
            ...prev,
            import_status: newStatus as SerializedList['import_status'],
            total_count: newTotal,
            valid_count: newValid,
          }));
          if (newStatus === 'completed' || newStatus === 'failed') {
            stopPollingAndRefresh();
          }
        },
      )
      .subscribe();

    // Polling fallback every 3 seconds
    pollingRef.current = setInterval(async () => {
      const result = await getContactListStatus(listId);
      if (!result.ok) return;
      setListState((prev) => ({
        ...prev,
        import_status: (result.status as SerializedList['import_status']) ?? prev.import_status,
        total_count: result.totalCount ?? prev.total_count,
        valid_count: result.validCount ?? prev.valid_count,
      }));
      if (result.status === 'completed' || result.status === 'failed') {
        stopPollingAndRefresh();
      }
    }, POLL_INTERVAL_MS);

    return () => {
      clearPolling();
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleLoadErrors() {
    startErrorsTransition(async () => {
      const result = await getImportErrorsUrl(listId);
      if (result.ok && result.url) {
        setErrorsUrl(result.url);
        window.open(result.url, '_blank');
      } else {
        toast.error(result.message ?? t('list_errors_not_found'));
      }
    });
  }

  const status = listState.import_status;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="space-y-1">
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
          <Link href="/contacts">
            <ArrowLeft className="mr-1 size-4" />
            {t('list_detail_back')}
          </Link>
        </Button>

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">{listState.name}</h1>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span>{sourceLabel(listState.source, t)}</span>
              <span>·</span>
              <span>
                {t('list_total_contacts')}: {listState.total_count.toLocaleString('it-IT')}
              </span>
              {status === 'completed' && (
                <>
                  <span>·</span>
                  <span>
                    {t('list_valid_contacts')}: {listState.valid_count.toLocaleString('it-IT')}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <AddContactDialog listId={listId} />
            {status && (
              <StatusBadge
                status={status === 'parsing' ? 'processing' : status === 'pending' ? 'pending' : status as 'completed' | 'failed'}
              />
            )}
          </div>
        </div>
      </div>

      {/* Status-conditional content */}
      {(status === 'pending' || status === 'parsing') && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              {t('list_parsing_title')}
            </CardTitle>
            <CardDescription>{t('list_parsing_description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm text-muted-foreground">
              {listState.total_count > 0 && (
                <p>
                  {t('list_valid_contacts')}: {listState.valid_count.toLocaleString('it-IT')} / {listState.total_count.toLocaleString('it-IT')}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {status === 'failed' && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="size-4" />
              {t('list_failed_title')}
            </CardTitle>
            <CardDescription>{t('list_failed_description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              size="sm"
              disabled={loadingErrors}
              onClick={handleLoadErrors}
            >
              {loadingErrors ? t('list_errors_loading') : t('list_errors_download')}
            </Button>
            {errorsUrl && (
              <p className="mt-2 text-xs text-muted-foreground">
                <a href={errorsUrl} target="_blank" rel="noreferrer" className="underline">
                  {errorsUrl}
                </a>
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {status === 'completed' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-green-600" />
            <span>
              {t('list_contacts_count', { count: String(listState.valid_count) })}
            </span>
          </div>
          <ContactsTable contacts={contacts} listId={listId} orgId={orgId} />
        </div>
      )}
    </div>
  );
}

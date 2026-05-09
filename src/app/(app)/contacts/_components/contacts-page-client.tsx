'use client';

import { Calendar, List, Upload } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { ContactsTable } from '@/app/(app)/contacts/lists/[id]/_components/contacts-table';
import type { SerializedContact } from '@/app/(app)/contacts/lists/[id]/_components/list-detail-client';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';

import { ImportDncDialog } from './import-dnc-dialog';

// ---------------------------------------------------------------------------
// Serialised type for contact lists
// ---------------------------------------------------------------------------

export interface SerializedContactList {
  id: string;
  name: string;
  source: 'csv-upload' | 'zapier' | 'api';
  total_count: number;
  valid_count: number;
  import_status: 'pending' | 'parsing' | 'completed' | 'failed' | null;
  created_at: string;
}

type TabKey = 'lists' | 'all' | 'optout';

interface Props {
  activeTab: TabKey;
  lists: SerializedContactList[];
  allContacts: SerializedContact[];
  optOutContacts: SerializedContact[];
  orgId: string;
}

function sourceLabel(
  source: SerializedContactList['source'],
  t: ReturnType<typeof useTranslations<'contacts'>>,
): string {
  if (source === 'csv-upload') return t('list_source_csv_upload');
  if (source === 'zapier') return t('list_source_zapier');
  return t('list_source_api');
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Lists tab content
// ---------------------------------------------------------------------------

function ListsTab({ lists }: { lists: SerializedContactList[] }) {
  const t = useTranslations('contacts');

  if (lists.length === 0) {
    return (
      <EmptyState
        illustration={<List className="size-10" />}
        title={t('first_list_title')}
        description={t('first_list_desc')}
        action={{ label: t('first_list_cta'), href: '/contacts/upload' }}
      />
    );
  }

  return (
    <div className="rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left font-medium">{t('list_col_name')}</th>
            <th className="px-4 py-3 text-left font-medium">{t('list_col_source')}</th>
            <th className="px-4 py-3 text-right font-medium">{t('list_col_contacts')}</th>
            <th className="px-4 py-3 text-left font-medium">{t('list_col_status')}</th>
            <th className="px-4 py-3 text-left font-medium">{t('list_col_created')}</th>
          </tr>
        </thead>
        <tbody>
          {lists.map((list) => (
            <tr key={list.id} className="border-b last:border-0 hover:bg-muted/30">
              <td className="px-4 py-3">
                <Link
                  href={`/contacts/lists/${list.id}`}
                  className="font-medium text-foreground hover:underline"
                >
                  {list.name}
                </Link>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{sourceLabel(list.source, t)}</td>
              <td className="px-4 py-3 text-right text-muted-foreground">
                {list.import_status === 'completed'
                  ? list.valid_count.toLocaleString('it-IT')
                  : list.total_count.toLocaleString('it-IT')}
              </td>
              <td className="px-4 py-3">
                {list.import_status && (
                  <StatusBadge
                    status={
                      list.import_status === 'parsing'
                        ? 'processing'
                        : list.import_status === 'pending'
                          ? 'pending'
                          : (list.import_status as 'completed' | 'failed')
                    }
                  />
                )}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Calendar className="size-3" />
                  {formatDate(list.created_at)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page client component
// ---------------------------------------------------------------------------

const TABS: { key: TabKey; labelKey: string }[] = [
  { key: 'lists', labelKey: 'tab_lists' },
  { key: 'all', labelKey: 'tab_all' },
  { key: 'optout', labelKey: 'tab_opt_out' },
];

export function ContactsPageClient({
  activeTab,
  lists,
  allContacts,
  optOutContacts,
  orgId,
}: Props) {
  const t = useTranslations('contacts');

  return (
    <div className="space-y-6 p-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <div className="flex items-center gap-2">
          <ImportDncDialog />
          <Button asChild size="sm">
            <Link href="/contacts/upload">
              <Upload className="mr-2 size-4" />
              {t('upload_new_list')}
            </Link>
          </Button>
        </div>
      </div>

      {/* Tab navigation */}
      <nav className="flex gap-1 border-b">
        {TABS.map(({ key, labelKey }) => {
          const isActive = activeTab === key;
          return (
            <Link
              key={key}
              href={`/contacts?tab=${key}`}
              className={[
                'px-4 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'border-b-2 border-primary text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              {t(labelKey as Parameters<typeof t>[0])}
            </Link>
          );
        })}
      </nav>

      {/* Tab content */}
      {activeTab === 'lists' && <ListsTab lists={lists} />}

      {activeTab === 'all' && (
        <ContactsTable contacts={allContacts} listId="" orgId={orgId} />
      )}

      {activeTab === 'optout' && (
        <ContactsTable contacts={optOutContacts} listId="" orgId={orgId} />
      )}
    </div>
  );
}

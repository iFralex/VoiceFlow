'use client';

import { Calendar, Megaphone, MoreHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import {
  cancelCampaignAction,
  duplicateCampaignAction,
  pauseCampaignAction,
  resumeCampaignAction,
} from '@/actions/campaigns';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import type { ActionResult } from '@/lib/utils/action-toast';
import { toastResult } from '@/lib/utils/action-toast';

// ---------------------------------------------------------------------------
// Serialised campaign type passed from the server
// ---------------------------------------------------------------------------

export interface SerializedCampaign {
  id: string;
  name: string;
  status: 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'cancelled';
  scriptId: string;
  scriptName: string;
  contactListId: string;
  contactListName: string;
  totalCalls: number;
  estimatedMaxCents: number | null;
  actualCents: number;
  createdAt: string;
}

type TabKey = 'all' | 'draft' | 'running' | 'completed' | 'cancelled';

interface Props {
  activeTab: TabKey;
  campaigns: SerializedCampaign[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('it-IT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  });
}

// ---------------------------------------------------------------------------
// Row actions
// ---------------------------------------------------------------------------

function CampaignRowActions({ campaign }: { campaign: SerializedCampaign }) {
  const t = useTranslations('campaigns');
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  const canPause = campaign.status === 'running';
  const canResume = campaign.status === 'paused';
  const canCancel = campaign.status === 'running' || campaign.status === 'paused' || campaign.status === 'scheduled';

  function translateResult(result: ActionResult): ActionResult {
    if (result.ok) return result;
    const key = result.message as Parameters<typeof t>[0];
    const translated = t(key);
    return { ok: false, message: translated !== key ? translated : result.message };
  }

  async function handlePause() {
    setPending(true);
    const result = await pauseCampaignAction({ campaignId: campaign.id });
    toastResult(translateResult(result), t('pause_success'));
    setPending(false);
    if (result.ok) router.refresh();
  }

  async function handleResume() {
    setPending(true);
    const result = await resumeCampaignAction({ campaignId: campaign.id });
    toastResult(translateResult(result), t('resume_success'));
    setPending(false);
    if (result.ok) router.refresh();
  }

  async function handleCancel() {
    setPending(true);
    const result = await cancelCampaignAction({ campaignId: campaign.id });
    toastResult(translateResult(result), t('cancel_success'));
    setPending(false);
    if (result.ok) router.refresh();
  }

  async function handleDuplicate() {
    setPending(true);
    const result = await duplicateCampaignAction({ campaignId: campaign.id });
    toastResult(translateResult(result), t('duplicate_success'));
    setPending(false);
    if (result.ok) router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" disabled={pending}>
          <MoreHorizontal className="size-4" />
          <span className="sr-only">Azioni</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/campaigns/${campaign.id}`}>{t('action_view')}</Link>
        </DropdownMenuItem>

        {canPause && (
          <ConfirmDialog
            trigger={
              <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                {t('action_pause')}
              </DropdownMenuItem>
            }
            title={t('pause_confirm_title')}
            description={t('pause_confirm_desc')}
            confirmLabel={t('action_pause')}
            onConfirm={handlePause}
          />
        )}

        {canResume && (
          <DropdownMenuItem onSelect={() => void handleResume()}>
            {t('action_resume')}
          </DropdownMenuItem>
        )}

        {canCancel && (
          <>
            <DropdownMenuSeparator />
            <ConfirmDialog
              trigger={
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={(e) => e.preventDefault()}
                >
                  {t('action_cancel')}
                </DropdownMenuItem>
              }
              title={t('cancel_confirm_title')}
              description={t('cancel_confirm_desc')}
              confirmLabel={t('action_cancel')}
              onConfirm={handleCancel}
            />
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void handleDuplicate()}>
          {t('action_duplicate')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// Campaigns table
// ---------------------------------------------------------------------------

function CampaignsTable({ campaigns }: { campaigns: SerializedCampaign[] }) {
  const t = useTranslations('campaigns');

  return (
    <div className="rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left font-medium">{t('col_name')}</th>
            <th className="px-4 py-3 text-left font-medium">{t('col_script')}</th>
            <th className="px-4 py-3 text-right font-medium">{t('col_contacts')}</th>
            <th className="px-4 py-3 text-left font-medium">{t('col_status')}</th>
            <th className="px-4 py-3 text-right font-medium">{t('col_cost')}</th>
            <th className="px-4 py-3 text-left font-medium">{t('col_created')}</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {campaigns.map((campaign) => (
            <tr key={campaign.id} className="border-b last:border-0 hover:bg-muted/30">
              <td className="px-4 py-3">
                <Link
                  href={`/campaigns/${campaign.id}`}
                  className="font-medium text-foreground hover:underline"
                >
                  {campaign.name}
                </Link>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                <Link
                  href={`/scripts/${campaign.scriptId}`}
                  className="hover:underline"
                >
                  {campaign.scriptName}
                </Link>
              </td>
              <td className="px-4 py-3 text-right text-muted-foreground">
                {campaign.totalCalls.toLocaleString('it-IT')}
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={campaign.status} />
              </td>
              <td className="px-4 py-3 text-right text-muted-foreground">
                {campaign.status === 'draft' || campaign.status === 'scheduled' ? (
                  campaign.estimatedMaxCents != null ? (
                    <span className="text-xs">
                      {t('cost_estimated', { cost: formatCents(campaign.estimatedMaxCents) })}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground/50">—</span>
                  )
                ) : (
                  <span className="text-xs">
                    {t('cost_actual', { cost: formatCents(campaign.actualCents) })}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Calendar className="size-3" />
                  {formatDate(campaign.createdAt)}
                </span>
              </td>
              <td className="px-4 py-3">
                <CampaignRowActions campaign={campaign} />
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
  { key: 'all', labelKey: 'tab_all' },
  { key: 'draft', labelKey: 'tab_draft' },
  { key: 'running', labelKey: 'tab_running' },
  { key: 'completed', labelKey: 'tab_completed' },
  { key: 'cancelled', labelKey: 'tab_cancelled' },
];

export function CampaignsPageClient({ activeTab, campaigns }: Props) {
  const t = useTranslations('campaigns');

  return (
    <div className="space-y-6 p-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <Button asChild size="sm">
          <Link href="/campaigns/new">{t('new_campaign')}</Link>
        </Button>
      </div>

      {/* Tab navigation */}
      <nav className="flex gap-1 border-b">
        {TABS.map(({ key, labelKey }) => {
          const isActive = activeTab === key;
          return (
            <Link
              key={key}
              href={`/campaigns?tab=${key}`}
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
      {campaigns.length === 0 ? (
        activeTab === 'all' ? (
          <EmptyState
            illustration={<Megaphone className="size-10" />}
            title={t('first_campaign_title')}
            description={t('first_campaign_desc')}
            action={{ label: t('first_campaign_cta'), href: '/campaigns/new' }}
          />
        ) : (
          <EmptyState
            illustration={<Megaphone className="size-10" />}
            title={t('no_campaigns_in_tab')}
          />
        )
      ) : (
        <CampaignsTable campaigns={campaigns} />
      )}
    </div>
  );
}

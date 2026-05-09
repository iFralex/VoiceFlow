import { notFound } from 'next/navigation';

import { getAuthContext } from '@/lib/auth/context';
import {
  listCampaignResults,
  type CampaignCallOutcome,
  type CampaignResultsFilters,
  type CampaignResultsPage,
} from '@/lib/services/campaign-results';
import { getCampaign } from '@/lib/services/campaigns';

import { CampaignResultsClient } from './_components/results-client';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const VALID_OUTCOMES: CampaignCallOutcome[] = [
  'interested',
  'not_interested',
  'appointment_booked',
  'wrong_number',
  'callback_requested',
  'voicemail_left',
  'voicemail_no_message',
  'do_not_call',
];

const VALID_SORTS: CampaignResultsPage['sort'][] = [
  'started_desc',
  'started_asc',
  'duration_desc',
  'duration_asc',
  'cost_desc',
  'cost_asc',
];

function parseStringList(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  const raw = Array.isArray(v) ? v.join(',') : v;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseIntParam(v: string | string[] | undefined, fallback: number): number {
  const raw = Array.isArray(v) ? v[0] : v;
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseDateParam(v: string | string[] | undefined): Date | undefined {
  const raw = Array.isArray(v) ? v[0] : v;
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export default async function CampaignResultsPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;

  const { orgId } = await getAuthContext();
  const campaign = await getCampaign(orgId, id);
  if (!campaign) notFound();

  // Parse filters from URL
  const outcomes = parseStringList(sp.outcome).filter((s): s is CampaignCallOutcome =>
    VALID_OUTCOMES.includes(s as CampaignCallOutcome),
  );

  const durationMinSeconds =
    sp.durationMin !== undefined ? parseIntParam(sp.durationMin, NaN) : NaN;
  const durationMaxSeconds =
    sp.durationMax !== undefined ? parseIntParam(sp.durationMax, NaN) : NaN;

  const startedAfter = parseDateParam(sp.dateFrom);
  const startedBefore = parseDateParam(sp.dateTo);

  const filters: CampaignResultsFilters = {
    ...(outcomes.length > 0 ? { outcomes } : {}),
    ...(Number.isFinite(durationMinSeconds) ? { durationMinSeconds } : {}),
    ...(Number.isFinite(durationMaxSeconds) ? { durationMaxSeconds } : {}),
    ...(startedAfter !== undefined ? { startedAfter } : {}),
    ...(startedBefore !== undefined ? { startedBefore } : {}),
  };

  const page = parseIntParam(sp.page, 0);
  const pageSize = parseIntParam(sp.pageSize, 20);
  const sortRaw = Array.isArray(sp.sort) ? sp.sort[0] : sp.sort;
  const sort =
    sortRaw && (VALID_SORTS as string[]).includes(sortRaw)
      ? (sortRaw as CampaignResultsPage['sort'])
      : 'started_desc';

  const { rows, total } = await listCampaignResults(orgId, id, filters, {
    page,
    pageSize,
    ...(sort !== undefined ? { sort } : {}),
  });

  return (
    <CampaignResultsClient
      campaignId={campaign.id}
      campaignName={campaign.name}
      rows={rows}
      total={total}
      page={page}
      pageSize={pageSize}
      sort={sort ?? 'started_desc'}
      outcomes={outcomes}
      durationMinSeconds={Number.isFinite(durationMinSeconds) ? durationMinSeconds : null}
      durationMaxSeconds={Number.isFinite(durationMaxSeconds) ? durationMaxSeconds : null}
      dateFrom={startedAfter ? startedAfter.toISOString().slice(0, 10) : null}
      dateTo={startedBefore ? startedBefore.toISOString().slice(0, 10) : null}
    />
  );
}

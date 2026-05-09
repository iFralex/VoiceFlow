import { notFound } from 'next/navigation';

import { getAuthContext } from '@/lib/auth/context';
import {
  formatBilledDuration,
  getCampaignPrintReport,
} from '@/lib/services/campaign-print-report';

import { PrintReportClient } from './_components/print-report-client';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CampaignPrintReportPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;

  const { orgId } = await getAuthContext();
  const data = await getCampaignPrintReport(orgId, id);
  if (!data) notFound();

  const fullPhonesParam = Array.isArray(sp.fullPhones) ? sp.fullPhones[0] : sp.fullPhones;
  const showFullPhones = fullPhonesParam === '1' || fullPhonesParam === 'true';

  const avgDurationSeconds =
    data.totals.completedCalls > 0
      ? Math.round(data.totals.totalBilledSeconds / data.totals.completedCalls)
      : 0;

  return (
    <PrintReportClient
      campaign={{
        id: data.campaign.id,
        name: data.campaign.name,
        status: data.campaign.status,
        scriptName: data.campaign.scriptName,
        createdAtIso: data.campaign.createdAt.toISOString(),
        startedAtIso: data.campaign.startedAt?.toISOString() ?? null,
        completedAtIso: data.campaign.completedAt?.toISOString() ?? null,
      }}
      totals={{
        ...data.totals,
        durationFormatted: formatBilledDuration(avgDurationSeconds),
      }}
      outcomes={data.outcomes}
      topAppointments={data.topAppointments.map((a) => ({
        id: a.id,
        contactName: a.contactName,
        phoneE164: a.phoneE164,
        scheduledAtIso: a.scheduledAt.toISOString(),
        notes: a.notes,
      }))}
      showFullPhones={showFullPhones}
      generatedAtIso={new Date().toISOString()}
    />
  );
}

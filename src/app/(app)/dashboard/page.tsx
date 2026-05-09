import { ActiveCampaigns } from '@/components/dashboard/active-campaigns';
import { AlertsList } from '@/components/dashboard/alerts-list';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { parsePeriod, resolvePeriodRange } from '@/components/dashboard/period';
import { PeriodSelector } from '@/components/dashboard/period-selector';
import { RecentAppointments } from '@/components/dashboard/recent-appointments';
import { TrendChart } from '@/components/dashboard/trend-chart';
import { t } from '@/i18n/server';
import { dbForRequest } from '@/lib/db/client';

import { loadDashboardData } from './_data';

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DashboardPage({ searchParams }: Props) {
  const sp = await searchParams;
  const period = parsePeriod(sp.period);
  const range = resolvePeriodRange(period);

  const { orgId, withOrgContext } = await dbForRequest();
  const data = await loadDashboardData(orgId, withOrgContext, range);

  const translate = await t('dashboard');

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {translate('greeting')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {translate(`period_summary_${period}`)}
          </p>
        </div>
        <PeriodSelector value={period} />
      </header>

      <section
        aria-label={translate('kpi_section_label')}
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <KpiCard
          label={translate('kpi_calls_completed')}
          value={formatNumber(data.kpis.callsCompleted)}
          trend={data.sparklines.callsCompleted}
          trendLabel={translate('sparkline_aria_calls')}
          hint={translate('kpi_trend_14d')}
        />
        <KpiCard
          label={translate('kpi_qualified_leads')}
          value={formatNumber(data.kpis.qualifiedLeads)}
          trend={data.sparklines.qualifiedLeads}
          trendLabel={translate('sparkline_aria_leads')}
          hint={translate('kpi_trend_14d')}
        />
        <KpiCard
          label={translate('kpi_appointments')}
          value={formatNumber(data.kpis.appointmentsBooked)}
          trend={data.sparklines.appointmentsBooked}
          trendLabel={translate('sparkline_aria_appointments')}
          hint={translate('kpi_trend_14d')}
        />
        <KpiCard
          label={translate('kpi_credit_residual')}
          value={formatEuros(data.kpis.creditBalance.cents)}
          hint={translate('kpi_credit_minutes', {
            minutes: data.kpis.creditBalance.minutes,
          })}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <TrendChart data={data.trends} className="lg:col-span-2" />
        <ActiveCampaigns campaigns={data.activeCampaigns} />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <RecentAppointments
          appointments={data.recentAppointments}
          className="lg:col-span-2"
        />
        <AlertsList alerts={data.alerts} />
      </section>
    </div>
  );
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat('it-IT').format(n);
}

function formatEuros(cents: number): string {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

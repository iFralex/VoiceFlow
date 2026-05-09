'use client';

import { ArrowLeft, Eye, EyeOff, Printer } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { maskPhoneLast4 } from '@/lib/services/campaign-print-report';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface PrintReportClientProps {
  campaign: {
    id: string;
    name: string;
    status: string;
    scriptName: string | null;
    createdAtIso: string;
    startedAtIso: string | null;
    completedAtIso: string | null;
  };
  totals: {
    totalCalls: number;
    completedCalls: number;
    failedCalls: number;
    qualifiedLeads: number;
    appointmentsBooked: number;
    totalBilledSeconds: number;
    totalCostCents: number;
    durationFormatted: string;
  };
  outcomes: {
    appointmentBooked: number;
    interested: number;
    notInterested: number;
    callback: number;
    voicemail: number;
    wrongNumber: number;
    doNotCall: number;
  };
  topAppointments: Array<{
    id: string;
    contactName: string;
    phoneE164: string | null;
    scheduledAtIso: string;
    notes: string | null;
  }>;
  /** When true, full phones are rendered instead of last-4 mask. */
  showFullPhones: boolean;
  /** ISO timestamp the report data was rendered at. */
  generatedAtIso: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

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

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

// ─── Outcome bar (no JS chart lib — pure CSS so print renders fine) ────────────

function OutcomeBar({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const percentage = pct(count, total);
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-3 text-sm">
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between">
          <span className="font-medium">{label}</span>
          <span className="text-muted-foreground tabular-nums">
            {count} ({percentage}%)
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-sm bg-muted">
          <div
            role="progressbar"
            aria-valuenow={percentage}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={label}
            className={`h-full ${color}`}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
      <div className="hidden" />
    </div>
  );
}

// ─── Main client component ─────────────────────────────────────────────────────

export function PrintReportClient(props: PrintReportClientProps) {
  const t = useTranslations('campaigns');
  const tStatus = useTranslations('status');
  const router = useRouter();
  const searchParams = useSearchParams();

  const handlePrint = React.useCallback(() => {
    if (typeof window !== 'undefined') {
      window.print();
    }
  }, []);

  const handleTogglePhones = React.useCallback(() => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (props.showFullPhones) {
      params.delete('fullPhones');
    } else {
      params.set('fullPhones', '1');
    }
    router.replace(`?${params.toString()}`);
  }, [props.showFullPhones, router, searchParams]);

  const renderPhone = (phone: string | null) => {
    if (props.showFullPhones) return phone ?? '—';
    return maskPhoneLast4(phone);
  };

  const totalOutcomes =
    props.outcomes.appointmentBooked +
    props.outcomes.interested +
    props.outcomes.notInterested +
    props.outcomes.callback +
    props.outcomes.voicemail +
    props.outcomes.wrongNumber +
    props.outcomes.doNotCall;

  return (
    <div className="print-container space-y-6 p-6">
      {/* Toolbar — hidden in print */}
      <div
        data-no-print="true"
        className="flex flex-wrap items-center justify-between gap-2 border-b pb-4"
      >
        <Link
          href={`/campaigns/${props.campaign.id}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          {t('print_back_to_campaign')}
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleTogglePhones}>
            {props.showFullPhones ? (
              <>
                <EyeOff className="mr-1 size-3" />
                {t('print_phones_mask')}
              </>
            ) : (
              <>
                <Eye className="mr-1 size-3" />
                {t('print_phones_show')}
              </>
            )}
          </Button>
          <Button size="sm" onClick={handlePrint}>
            <Printer className="mr-1 size-3" />
            {t('print_action_print')}
          </Button>
        </div>
      </div>

      {/* Report header */}
      <header className="print-avoid-break space-y-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {t('print_report_label')}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{props.campaign.name}</h1>
        <p className="text-sm text-muted-foreground">
          {t('print_status_label')}: {tStatus(props.campaign.status)}
          {props.campaign.scriptName && (
            <>
              {' '}
              · {t('detail_script_label')}: {props.campaign.scriptName}
            </>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {t('print_generated_at', { date: formatDateTime(props.generatedAtIso) })}
        </p>
      </header>

      {/* Summary grid */}
      <section className="print-avoid-break space-y-2">
        <h2 className="text-lg font-semibold">{t('print_summary_title')}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryCell label={t('detail_kpi_total')} value={String(props.totals.totalCalls)} />
          <SummaryCell
            label={t('detail_kpi_completed')}
            value={String(props.totals.completedCalls)}
          />
          <SummaryCell
            label={t('detail_kpi_failed')}
            value={String(props.totals.failedCalls)}
          />
          <SummaryCell
            label={t('detail_kpi_qualified_leads')}
            value={String(props.totals.qualifiedLeads)}
          />
          <SummaryCell
            label={t('detail_kpi_appointments')}
            value={String(props.totals.appointmentsBooked)}
          />
          <SummaryCell
            label={t('detail_kpi_avg_duration')}
            value={props.totals.durationFormatted}
          />
          <SummaryCell
            label={t('detail_kpi_credit_used')}
            value={formatCents(props.totals.totalCostCents)}
          />
          <SummaryCell
            label={t('print_summary_started')}
            value={
              props.campaign.startedAtIso
                ? formatDate(props.campaign.startedAtIso)
                : '—'
            }
          />
        </div>
      </section>

      {/* Outcome breakdown */}
      <section className="print-avoid-break space-y-3">
        <h2 className="text-lg font-semibold">{t('print_outcomes_title')}</h2>
        {totalOutcomes === 0 ? (
          <p className="text-sm text-muted-foreground">{t('print_outcomes_empty')}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <OutcomeBar
              label={t('outcome_appointment_booked')}
              count={props.outcomes.appointmentBooked}
              total={totalOutcomes}
              color="bg-status-info"
            />
            <OutcomeBar
              label={t('outcome_interested')}
              count={props.outcomes.interested}
              total={totalOutcomes}
              color="bg-status-success"
            />
            <OutcomeBar
              label={t('outcome_not_interested')}
              count={props.outcomes.notInterested}
              total={totalOutcomes}
              color="bg-status-neutral"
            />
            <OutcomeBar
              label={t('outcome_callback_requested')}
              count={props.outcomes.callback}
              total={totalOutcomes}
              color="bg-status-warning"
            />
            <OutcomeBar
              label={t('outcome_voicemail_left')}
              count={props.outcomes.voicemail}
              total={totalOutcomes}
              color="bg-status-neutral"
            />
            <OutcomeBar
              label={t('outcome_wrong_number')}
              count={props.outcomes.wrongNumber}
              total={totalOutcomes}
              color="bg-status-danger"
            />
            <OutcomeBar
              label={t('outcome_do_not_call')}
              count={props.outcomes.doNotCall}
              total={totalOutcomes}
              color="bg-status-danger"
            />
          </div>
        )}
      </section>

      {/* Top appointments */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">{t('print_appointments_title')}</h2>
          <span className="text-xs text-muted-foreground">
            {props.showFullPhones
              ? t('print_phones_full_notice')
              : t('print_phones_mask_notice')}
          </span>
        </div>

        {props.topAppointments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('print_appointments_empty')}
          </p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4 font-medium">{t('print_appt_col_contact')}</th>
                <th className="py-2 pr-4 font-medium">{t('print_appt_col_phone')}</th>
                <th className="py-2 pr-4 font-medium">{t('print_appt_col_scheduled')}</th>
                <th className="py-2 font-medium">{t('print_appt_col_notes')}</th>
              </tr>
            </thead>
            <tbody>
              {props.topAppointments.map((a) => (
                <tr key={a.id} className="border-b last:border-b-0">
                  <td className="py-2 pr-4 align-top font-medium">{a.contactName}</td>
                  <td className="py-2 pr-4 align-top font-mono-tabular tabular-nums">
                    {renderPhone(a.phoneE164)}
                  </td>
                  <td className="py-2 pr-4 align-top tabular-nums">
                    {formatDateTime(a.scheduledAtIso)}
                  </td>
                  <td className="py-2 align-top text-muted-foreground">{a.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

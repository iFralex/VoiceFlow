'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTransition, useState } from 'react';

import { createCampaignAction } from '@/actions/campaigns';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toastResult } from '@/lib/utils/action-toast';

// ─── Prop types (serialized from Server Component) ────────────────────────────

export type ScriptOption = {
  id: string;
  name: string;
  template_name: string;
};

export type ContactListOption = {
  id: string;
  name: string;
  valid_count: number;
};

type Props = {
  scripts: ScriptOption[];
  contactLists: ContactListOption[];
  /** Current org credit balance in cents. */
  balanceCents: number;
  /** Remaining minutes from credit balance (for display). */
  remainingMinutes: number;
  /** Weighted-average per-minute rate in cents, or null if no packages bought. */
  perMinuteCents: number | null;
  /** Pre-selected script ID (from ?script= query param). */
  initialScriptId?: string;
};

// ─── Wizard steps ─────────────────────────────────────────────────────────────

type WizardStep = 'script' | 'contact_list' | 'schedule';

// ─── Cost estimate helper ─────────────────────────────────────────────────────

/**
 * Estimates campaign cost using the same rounding rules as billing-rules.ts:
 * - Billable seconds rounded up to nearest 6s boundary
 * - Cost rounded up to nearest cent
 * Assumes 90s expected avg and 180s max call duration.
 */
function estimateCost(
  contactCount: number,
  perMinuteCents: number,
): { expectedCents: number; maxCents: number } {
  const billable90 = Math.ceil(90 / 6) * 6; // 90s
  const expectedPerCall = Math.ceil((billable90 / 60) * perMinuteCents);
  const billable180 = Math.ceil(180 / 6) * 6; // 180s
  const maxPerCall = Math.ceil((billable180 / 60) * perMinuteCents);
  return {
    expectedCents: expectedPerCall * contactCount,
    maxCents: maxPerCall * contactCount,
  };
}

function formatEuros(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({
  current,
  t,
}: {
  current: WizardStep;
  t: (key: string) => string;
}) {
  const steps: { key: WizardStep; label: string }[] = [
    { key: 'script', label: t('step_script') },
    { key: 'contact_list', label: t('step_contact_list') },
    { key: 'schedule', label: t('step_schedule') },
  ];
  const currentIndex = steps.findIndex((s) => s.key === current);

  return (
    <div className="flex items-center gap-2">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-2">
          <div
            className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium ${
              s.key === current
                ? 'bg-primary text-primary-foreground'
                : i < currentIndex
                  ? 'bg-primary/20 text-primary'
                  : 'bg-muted text-muted-foreground'
            }`}
          >
            {i + 1}
          </div>
          <span
            className={`text-sm ${s.key === current ? 'font-medium' : 'text-muted-foreground'}`}
          >
            {s.label}
          </span>
          {i < steps.length - 1 && <div className="mx-2 h-px w-8 bg-border" />}
        </div>
      ))}
    </div>
  );
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

export function NewCampaignWizard({
  scripts,
  contactLists,
  balanceCents,
  remainingMinutes,
  perMinuteCents,
  initialScriptId,
}: Props) {
  const t = useTranslations('campaigns');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Wizard state
  const [step, setStep] = useState<WizardStep>(
    initialScriptId && scripts.some((s) => s.id === initialScriptId)
      ? 'contact_list'
      : 'script',
  );
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(
    initialScriptId ?? null,
  );
  const [selectedListId, setSelectedListId] = useState<string | null>(null);

  // Schedule step form state
  const [campaignName, setCampaignName] = useState('');
  const [scheduledStart, setScheduledStart] = useState('');
  const [timeWindowStart, setTimeWindowStart] = useState('09:00');
  const [timeWindowEnd, setTimeWindowEnd] = useState('19:00');
  const [concurrencyLimit, setConcurrencyLimit] = useState(5);
  const [nameError, setNameError] = useState<string | null>(null);

  const selectedScript = scripts.find((s) => s.id === selectedScriptId) ?? null;
  const selectedList = contactLists.find((l) => l.id === selectedListId) ?? null;

  // Cost estimate (computed from selected list's contact count)
  const costEstimate =
    selectedList && perMinuteCents !== null
      ? estimateCost(selectedList.valid_count, perMinuteCents)
      : null;

  const hasSufficientCredit = costEstimate === null || balanceCents >= costEstimate.maxCents;

  function clampTime(value: string, min: string, max: string): string {
    if (value < min) return min;
    if (value > max) return max;
    return value;
  }

  function handleTimeWindowStartChange(value: string) {
    setTimeWindowStart(clampTime(value, '08:00', '22:00'));
  }

  function handleTimeWindowEndChange(value: string) {
    setTimeWindowEnd(clampTime(value, '08:00', '22:00'));
  }

  function handleSubmit(launch: boolean) {
    if (!campaignName.trim()) {
      setNameError(t('field_name_required'));
      return;
    }
    setNameError(null);
    if (!selectedScriptId || !selectedListId) return;

    startTransition(async () => {
      // Convert datetime-local value to ISO string (treats input as local time)
      const scheduledStartISO = scheduledStart
        ? new Date(scheduledStart).toISOString()
        : undefined;

      const result = await createCampaignAction({
        name: campaignName.trim(),
        scriptId: selectedScriptId,
        contactListId: selectedListId,
        scheduledStart: scheduledStartISO,
        concurrencyLimit,
        timeWindowStart,
        timeWindowEnd,
        launch,
      });

      if (result.ok && result.campaignId) {
        toastResult(result, launch ? t('launch_success') : t('create_success'));
        router.push('/campaigns');
      } else {
        // Map error keys to translated messages
        const rawMsg = result.message ?? 'error';
        const msgKey = rawMsg as Parameters<typeof t>[0];
        const translatedMsg = t(msgKey) !== msgKey ? t(msgKey) : rawMsg;
        toastResult({ ok: false, message: translatedMsg });
      }
    });
  }

  const isScheduledInFuture =
    scheduledStart.length > 0 && new Date(scheduledStart) > new Date();

  // ── Step 1: Script selection ───────────────────────────────────────────────

  if (step === 'script') {
    return (
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" asChild>
            <Link href="/campaigns">{t('back_to_campaigns')}</Link>
          </Button>
          <h1 className="text-2xl font-semibold">{t('new_campaign_title')}</h1>
        </div>

        <StepIndicator current="script" t={t} />

        {scripts.length === 0 ? (
          <EmptyState
            title={t('no_scripts_title')}
            description={t('no_scripts_hint')}
            action={{ label: t('create_script_link'), href: '/scripts/new' }}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {scripts.map((script) => (
              <Card key={script.id} className="flex flex-col">
                <CardHeader>
                  <CardTitle className="text-base">{script.name}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {t('script_template_label')}: {script.template_name}
                  </p>
                </CardHeader>
                <CardFooter className="mt-auto">
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      setSelectedScriptId(script.id);
                      setStep('contact_list');
                    }}
                  >
                    {t('select_script_btn')}
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Step 2: Contact list selection ────────────────────────────────────────

  if (step === 'contact_list') {
    return (
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={() => setStep('script')}>
            {t('btn_back')}
          </Button>
          <h1 className="text-2xl font-semibold">{t('new_campaign_title')}</h1>
        </div>

        <StepIndicator current="contact_list" t={t} />

        {selectedScript && (
          <p className="text-sm text-muted-foreground">
            {t('selected_script_label')}: <span className="font-medium text-foreground">{selectedScript.name}</span>
          </p>
        )}

        {contactLists.length === 0 ? (
          <EmptyState
            title={t('no_contact_lists_title')}
            description={t('no_contact_lists_hint')}
            action={{ label: t('upload_contact_list_link'), href: '/contacts' }}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {contactLists.map((list) => (
              <Card key={list.id} className="flex flex-col">
                <CardHeader>
                  <CardTitle className="text-base">{list.name}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {t('valid_contacts_count', { count: list.valid_count })}
                  </p>
                </CardHeader>
                <CardFooter className="mt-auto">
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      setSelectedListId(list.id);
                      setStep('schedule');
                    }}
                  >
                    {t('select_list_btn')}
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Step 3: Schedule & review ─────────────────────────────────────────────

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" onClick={() => setStep('contact_list')}>
          {t('btn_back')}
        </Button>
        <h1 className="text-2xl font-semibold">{t('new_campaign_title')}</h1>
      </div>

      <StepIndicator current="schedule" t={t} />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Left: Form */}
        <div className="space-y-6">
          {/* Selected items summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('review_title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('selected_script_label')}</span>
                <span className="font-medium">{selectedScript?.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('selected_list_label')}</span>
                <span className="font-medium">
                  {selectedList?.name}{' '}
                  <span className="text-muted-foreground">
                    ({t('valid_contacts_count', { count: selectedList?.valid_count ?? 0 })})
                  </span>
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Schedule form */}
          <Card>
            <CardContent className="space-y-5 pt-6">
              {/* Campaign name */}
              <div className="space-y-2">
                <Label htmlFor="campaign-name">{t('field_name_label')} *</Label>
                <Input
                  id="campaign-name"
                  value={campaignName}
                  onChange={(e) => {
                    setCampaignName(e.target.value);
                    if (nameError) setNameError(null);
                  }}
                  placeholder={t('field_name_placeholder')}
                  maxLength={200}
                />
                {nameError && <p className="text-xs text-destructive">{nameError}</p>}
              </div>

              {/* Scheduled start */}
              <div className="space-y-2">
                <Label htmlFor="scheduled-start">{t('field_scheduled_start_label')}</Label>
                <Input
                  id="scheduled-start"
                  type="datetime-local"
                  value={scheduledStart}
                  onChange={(e) => setScheduledStart(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t('field_scheduled_start_hint')}</p>
              </div>

              {/* Time window */}
              <div className="space-y-2">
                <Label>{t('field_time_window_label')}</Label>
                <div className="flex items-center gap-3">
                  <div className="flex-1 space-y-1">
                    <Label htmlFor="tw-start" className="text-xs text-muted-foreground">
                      {t('field_time_window_start_label')}
                    </Label>
                    <Input
                      id="tw-start"
                      type="time"
                      value={timeWindowStart}
                      min="08:00"
                      max="22:00"
                      onChange={(e) => handleTimeWindowStartChange(e.target.value)}
                    />
                  </div>
                  <span className="mt-5 text-muted-foreground">–</span>
                  <div className="flex-1 space-y-1">
                    <Label htmlFor="tw-end" className="text-xs text-muted-foreground">
                      {t('field_time_window_end_label')}
                    </Label>
                    <Input
                      id="tw-end"
                      type="time"
                      value={timeWindowEnd}
                      min="08:00"
                      max="22:00"
                      onChange={(e) => handleTimeWindowEndChange(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Concurrency */}
              <div className="space-y-2">
                <Label htmlFor="concurrency">{t('field_concurrency_label')}</Label>
                <Input
                  id="concurrency"
                  type="number"
                  min={1}
                  max={20}
                  value={concurrencyLimit}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val)) setConcurrencyLimit(Math.min(20, Math.max(1, val)));
                  }}
                />
                <p className="text-xs text-muted-foreground">{t('field_concurrency_hint')}</p>
              </div>
            </CardContent>
            <CardFooter className="flex justify-end gap-3 border-t pt-4">
              {isScheduledInFuture ? (
                <>
                  <Button variant="outline" onClick={() => handleSubmit(false)} disabled={isPending}>
                    {isPending ? t('btn_submitting') : t('btn_save_scheduled')}
                  </Button>
                  <Button onClick={() => handleSubmit(true)} disabled={isPending || !hasSufficientCredit}>
                    {isPending ? t('btn_submitting') : t('btn_launch')}
                  </Button>
                </>
              ) : (
                <Button
                  onClick={() => handleSubmit(true)}
                  disabled={isPending || !hasSufficientCredit}
                >
                  {isPending ? t('btn_submitting') : t('btn_launch')}
                </Button>
              )}
            </CardFooter>
          </Card>
        </div>

        {/* Right: Cost estimate & credit */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('cost_summary_title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {perMinuteCents === null ? (
                <p className="text-muted-foreground">{t('cost_no_billing_rate')}</p>
              ) : costEstimate === null ? (
                <p className="text-muted-foreground">–</p>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('cost_expected_label')}</span>
                    <span className="font-medium">{formatEuros(costEstimate.expectedCents)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('cost_max_label')}</span>
                    <span className="font-medium">{formatEuros(costEstimate.maxCents)}</span>
                  </div>
                </>
              )}

              <div className="border-t pt-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('credit_balance_label')}</span>
                  <span className={`font-medium ${!hasSufficientCredit ? 'text-destructive' : ''}`}>
                    {formatEuros(balanceCents)}
                    {' '}
                    <span className="text-xs text-muted-foreground">({remainingMinutes} min)</span>
                  </span>
                </div>
                {!hasSufficientCredit && (
                  <p className="mt-2 text-xs text-destructive">{t('credit_insufficient_warning')}</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTransition, useState } from 'react';

import { createScriptAction } from '@/actions/scripts';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toastResult } from '@/lib/utils/action-toast';

// ─── Schema types (runtime, for form generation) ──────────────────────────────

type JsonSchemaProperty = {
  type: 'string' | 'integer' | 'array';
  description?: string;
  enum?: string[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  items?: {
    type: string;
    description?: string;
    pattern?: string;
    maxLength?: number;
  };
  minItems?: number;
};

export type TemplateJsonSchema = {
  type: 'object';
  required: string[];
  properties: Record<string, JsonSchemaProperty>;
};

// ─── Public types ─────────────────────────────────────────────────────────────

export type TemplateInfo = {
  slug: string;
  name: string;
  description: string;
  schema: TemplateJsonSchema;
  systemPromptBody: string;
  firstMessageBody: string;
};

type WizardStep = 'template_selection' | 'variables';

type VariableValues = Record<string, string | number | string[]>;

type FieldErrors = Record<string, string>;

// ─── Preview helpers ───────────────────────────────────────────────────────────

function previewInterpolate(template: string, vars: VariableValues): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const val = vars[key];
    if (val === undefined || val === '') return match;
    if (Array.isArray(val)) {
      const filled = val.filter(Boolean);
      return filled.length > 0 ? filled.join(', ') : match;
    }
    return String(val);
  });
}

function buildPreview(
  preamble: string,
  templateBody: string,
  outcomeInstructions: string,
  vars: VariableValues,
): string {
  const interpolated = previewInterpolate(templateBody, vars);
  return [preamble, '---', interpolated, '---', outcomeInstructions].join('\n\n');
}

// ─── Variable field component ─────────────────────────────────────────────────

function VariableField({
  fieldKey,
  prop,
  isRequired,
  value,
  error,
  onChange,
  t,
}: {
  fieldKey: string;
  prop: JsonSchemaProperty;
  isRequired: boolean;
  value: string | number | string[];
  error?: string | undefined;
  onChange: (val: string | number | string[]) => void;
  t: (key: string) => string;
}) {
  const label = (
    <Label htmlFor={`field-${fieldKey}`} className="flex items-center gap-1">
      {fieldKey.replace(/_/g, ' ')}
      {!isRequired && (
        <span className="text-xs text-muted-foreground">{t('optional_label')}</span>
      )}
    </Label>
  );

  const hint = prop.description ? (
    <p className="text-xs text-muted-foreground">{prop.description}</p>
  ) : null;

  const errorEl = error ? <p className="text-xs text-destructive">{error}</p> : null;

  // Array type: repeatable rows
  if (prop.type === 'array') {
    const arr = Array.isArray(value) ? value : [''];
    return (
      <div className="space-y-2">
        {label}
        {hint}
        {arr.map((item, idx) => (
          <div key={idx} className="flex gap-2">
            <Input
              id={idx === 0 ? `field-${fieldKey}` : undefined}
              value={item}
              onChange={(e) => {
                const next = [...arr];
                next[idx] = e.target.value;
                onChange(next);
              }}
              placeholder={prop.items?.description ?? prop.description ?? ''}
              maxLength={prop.items?.maxLength ?? prop.maxLength ?? 256}
            />
            {arr.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  const next = arr.filter((_, i) => i !== idx);
                  onChange(next);
                }}
              >
                {t('remove_slot')}
              </Button>
            )}
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...arr, ''])}
        >
          {t('add_slot')}
        </Button>
        {errorEl}
      </div>
    );
  }

  // Enum type: select
  if (prop.type === 'string' && prop.enum) {
    return (
      <div className="space-y-2">
        {label}
        {hint}
        <Select
          value={typeof value === 'string' ? value : ''}
          onValueChange={(v) => onChange(v)}
        >
          <SelectTrigger id={`field-${fieldKey}`}>
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {prop.enum.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errorEl}
      </div>
    );
  }

  // Integer type: number input
  if (prop.type === 'integer') {
    return (
      <div className="space-y-2">
        {label}
        {hint}
        <Input
          id={`field-${fieldKey}`}
          type="number"
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            onChange(isNaN(n) ? '' : n);
          }}
          min={prop.minimum}
          max={prop.maximum}
        />
        {errorEl}
      </div>
    );
  }

  // Default: string text input
  return (
    <div className="space-y-2">
      {label}
      {hint}
      <Input
        id={`field-${fieldKey}`}
        type="text"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        maxLength={prop.maxLength ?? 256}
        placeholder={prop.description ?? ''}
      />
      {errorEl}
    </div>
  );
}

// ─── Main wizard component ────────────────────────────────────────────────────

type Props = {
  templates: TemplateInfo[];
  initialTemplateSlug?: string | undefined;
  preamble: string;
  outcomeInstructions: string;
};

export function NewScriptWizard({ templates, initialTemplateSlug, preamble, outcomeInstructions }: Props) {
  const t = useTranslations('scripts');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const initialTemplate = templates.find((tpl) => tpl.slug === initialTemplateSlug) ?? null;

  const [step, setStep] = useState<WizardStep>(initialTemplate ? 'variables' : 'template_selection');
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateInfo | null>(initialTemplate);
  const [scriptName, setScriptName] = useState('');
  const [variables, setVariables] = useState<VariableValues>({});
  const [nameError, setNameError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  function selectTemplate(tpl: TemplateInfo) {
    setSelectedTemplate(tpl);
    setVariables({});
    setFieldErrors({});
    setStep('variables');
  }

  function validateForm(): boolean {
    let valid = true;
    const errors: FieldErrors = {};

    if (!scriptName.trim()) {
      setNameError(t('field_required_error'));
      valid = false;
    } else {
      setNameError(null);
    }

    if (!selectedTemplate) return false;

    for (const req of selectedTemplate.schema.required) {
      const val = variables[req];
      if (val === undefined || val === '' || val === null) {
        errors[req] = t('field_required_error');
        valid = false;
      } else if (Array.isArray(val)) {
        const filled = val.filter(Boolean);
        if (filled.length === 0) {
          errors[req] = t('field_required_error');
          valid = false;
        }
      }
    }

    setFieldErrors(errors);
    return valid;
  }

  function handleSave() {
    if (!selectedTemplate) return;
    if (!validateForm()) return;

    startTransition(async () => {
      // Coerce values before submitting
      const coerced: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(variables)) {
        if (Array.isArray(val)) {
          coerced[key] = val.filter(Boolean);
        } else {
          coerced[key] = val;
        }
      }

      const result = await createScriptAction({
        templateSlug: selectedTemplate.slug,
        name: scriptName.trim(),
        variables: coerced,
      });

      toastResult(result, t('save_success'));
      if (result.ok && result.scriptId) {
        router.push(`/scripts/${result.scriptId}`);
      }
    });
  }

  // ── Step 1: Template selection ───────────────────────────────────────────────

  if (step === 'template_selection') {
    return (
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" asChild>
            <Link href="/scripts">{t('back_to_templates')}</Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">{t('new_script_title')}</h1>
          </div>
        </div>

        {/* Step indicator */}
        <StepIndicator current={1} t={t} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((tpl) => (
            <Card key={tpl.slug} className="flex flex-col">
              <CardHeader>
                <CardTitle className="text-base">{tpl.name}</CardTitle>
                <CardDescription>{tpl.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Campi richiesti
                </p>
                <div className="flex flex-wrap gap-1">
                  {tpl.schema.required.map((field) => (
                    <span
                      key={field}
                      className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground"
                    >
                      {field}
                    </span>
                  ))}
                </div>
              </CardContent>
              <CardFooter>
                <Button size="sm" className="w-full" onClick={() => selectTemplate(tpl)}>
                  {t('select_this_template')}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // ── Step 2: Variables + preview ──────────────────────────────────────────────

  const tpl = selectedTemplate!;
  const previewText = buildPreview(preamble, tpl.systemPromptBody, outcomeInstructions, variables);
  const firstMessagePreview = previewInterpolate(tpl.firstMessageBody, variables);

  const schemaProperties = Object.entries(tpl.schema.properties);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" onClick={() => setStep('template_selection')}>
          {t('back_to_templates')}
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">{t('new_script_title')}</h1>
          <p className="text-sm text-muted-foreground">{tpl.name}</p>
        </div>
      </div>

      {/* Step indicator */}
      <StepIndicator current={2} t={t} />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Left: Form */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('step_configure')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Script name */}
              <div className="space-y-2">
                <Label htmlFor="script-name">{t('field_script_name_label')} *</Label>
                <Input
                  id="script-name"
                  value={scriptName}
                  onChange={(e) => {
                    setScriptName(e.target.value);
                    if (nameError) setNameError(null);
                  }}
                  placeholder={t('field_script_name_placeholder')}
                  maxLength={200}
                />
                {nameError && <p className="text-xs text-destructive">{nameError}</p>}
              </div>

              {/* Variable fields */}
              {schemaProperties.map(([key, prop]) => {
                const isRequired = tpl.schema.required.includes(key);
                const val = variables[key] ?? (prop.type === 'array' ? [''] : '');
                return (
                  <VariableField
                    key={key}
                    fieldKey={key}
                    prop={prop}
                    isRequired={isRequired}
                    value={val}
                    error={fieldErrors[key]}
                    onChange={(v) => {
                      setVariables((prev) => ({ ...prev, [key]: v }));
                      if (fieldErrors[key]) {
                        setFieldErrors((prev) => {
                          const next = { ...prev };
                          delete next[key];
                          return next;
                        });
                      }
                    }}
                    t={t}
                  />
                );
              })}
            </CardContent>
            <CardFooter className="flex justify-end gap-3 border-t pt-4">
              <Button variant="outline" onClick={() => setStep('template_selection')}>
                {t('back_to_templates')}
              </Button>
              <Button onClick={handleSave} disabled={isPending}>
                {isPending ? t('saving_script') : t('save_script')}
              </Button>
            </CardFooter>
          </Card>
        </div>

        {/* Right: Preview */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('preview_title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('preview_first_message_label')}
                </p>
                <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs text-foreground">
                  {firstMessagePreview || t('preview_placeholder_hint')}
                </pre>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('preview_system_prompt_label')}
                </p>
                <pre className="max-h-[32rem] overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs text-foreground">
                  {previewText}
                </pre>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ current, t }: { current: 1 | 2; t: (key: string) => string }) {
  const steps = [
    { n: 1, label: t('step_select_template') },
    { n: 2, label: t('step_configure') },
  ];
  return (
    <div className="flex items-center gap-2">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center gap-2">
          <div
            className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium ${
              s.n === current
                ? 'bg-primary text-primary-foreground'
                : s.n < current
                  ? 'bg-primary/20 text-primary'
                  : 'bg-muted text-muted-foreground'
            }`}
          >
            {s.n}
          </div>
          <span className={`text-sm ${s.n === current ? 'font-medium' : 'text-muted-foreground'}`}>
            {s.label}
          </span>
          {i < steps.length - 1 && <div className="mx-2 h-px w-8 bg-border" />}
        </div>
      ))}
    </div>
  );
}

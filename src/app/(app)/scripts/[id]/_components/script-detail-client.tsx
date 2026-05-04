'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { copyScriptAction, deleteScript, updateScriptAction } from '@/actions/scripts';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toastResult } from '@/lib/utils/action-toast';

import type { TemplateInfo } from '../../new/_components/new-script-wizard';
import { VariableField } from '../../_components/variable-field';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SerializedScriptDetail = {
  id: string;
  name: string;
  variables: Record<string, unknown>;
  voice_id: string | null;
  template_slug: string;
  template_name: string;
  updated_at: string;
};

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

// ─── Coerce stored variables to VariableValues ────────────────────────────────

function coerceVariables(raw: Record<string, unknown>): VariableValues {
  const result: VariableValues = {};
  for (const [key, val] of Object.entries(raw)) {
    if (Array.isArray(val)) {
      result[key] = val.map((v) => String(v));
    } else if (typeof val === 'number') {
      result[key] = val;
    } else {
      result[key] = String(val ?? '');
    }
  }
  return result;
}

// ─── Main component ───────────────────────────────────────────────────────────

type Props = {
  script: SerializedScriptDetail;
  templateInfo: TemplateInfo | null;
  preamble: string;
  outcomeInstructions: string;
};

export function ScriptDetailClient({ script, templateInfo, preamble, outcomeInstructions }: Props) {
  const t = useTranslations('scripts');
  const router = useRouter();
  const [isSaving, startSaveTransition] = useTransition();
  const [isCopying, startCopyTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();

  const [scriptName, setScriptName] = useState(script.name);
  const [voiceId, setVoiceId] = useState(script.voice_id ?? '');
  const [variables, setVariables] = useState<VariableValues>(
    coerceVariables(script.variables),
  );
  const [nameError, setNameError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  function validateForm(): boolean {
    let valid = true;
    const errors: FieldErrors = {};

    if (!scriptName.trim()) {
      setNameError(t('field_required_error'));
      valid = false;
    } else {
      setNameError(null);
    }

    if (templateInfo) {
      for (const req of templateInfo.schema.required) {
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
    }

    setFieldErrors(errors);
    return valid;
  }

  function handleSave() {
    if (!validateForm()) return;

    startSaveTransition(async () => {
      const coerced: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(variables)) {
        if (Array.isArray(val)) {
          coerced[key] = val.filter(Boolean);
        } else {
          coerced[key] = val;
        }
      }

      const result = await updateScriptAction({
        scriptId: script.id,
        name: scriptName.trim(),
        variables: coerced,
        voiceId: voiceId.trim() || null,
      });

      toastResult(result, t('save_changes_success'));
      if (result.ok) {
        router.refresh();
      }
    });
  }

  function handleCopy() {
    startCopyTransition(async () => {
      const result = await copyScriptAction({ scriptId: script.id });
      toastResult(result, t('copy_success'));
      if (result.ok && result.scriptId) {
        router.push(`/scripts/${result.scriptId}`);
      }
    });
  }

  function handleDelete() {
    startDeleteTransition(async () => {
      const result = await deleteScript({ scriptId: script.id });
      toastResult(result, t('delete_success'));
      if (result.ok) {
        router.push('/scripts');
      }
    });
  }

  const schemaProperties = templateInfo
    ? Object.entries(templateInfo.schema.properties)
    : [];

  const previewText =
    templateInfo
      ? buildPreview(preamble, templateInfo.systemPromptBody, outcomeInstructions, variables)
      : '';

  const firstMessagePreview = templateInfo
    ? previewInterpolate(templateInfo.firstMessageBody, variables)
    : '';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" asChild>
            <Link href="/scripts">{t('edit_script_back')}</Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">{t('edit_script_title')}</h1>
            <p className="text-sm text-muted-foreground">{script.template_name}</p>
          </div>
        </div>

        {/* Secondary actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            disabled={isCopying}
          >
            {t('copy_script')}
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/campaigns/new?script=${script.id}`}>
              {t('use_in_campaign')}
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Left: Edit form */}
        <div className="space-y-4">
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
                const isRequired = templateInfo!.schema.required.includes(key);
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

              {/* Voice override */}
              <div className="space-y-2">
                <Label htmlFor="voice-id">{t('voice_override_label')}</Label>
                <Input
                  id="voice-id"
                  value={voiceId}
                  onChange={(e) => setVoiceId(e.target.value)}
                  placeholder={t('voice_override_placeholder')}
                  maxLength={256}
                />
                <p className="text-xs text-muted-foreground">{t('voice_override_hint')}</p>
              </div>
            </CardContent>
            <CardFooter className="flex items-center justify-between gap-3 border-t pt-4">
              <ConfirmDialog
                trigger={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={isDeleting}
                  >
                    {t('action_delete')}
                  </Button>
                }
                title={t('delete_title')}
                description={t('delete_description')}
                onConfirm={handleDelete}
              />
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? t('saving_changes') : t('save_changes')}
              </Button>
            </CardFooter>
          </Card>
        </div>

        {/* Right: Preview */}
        {templateInfo && (
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
        )}
      </div>
    </div>
  );
}

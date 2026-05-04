'use client';

import { AlertCircle, CheckCircle2, CloudUpload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import Papa from 'papaparse';
import { useCallback, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { triggerContactsImport } from '@/actions/contacts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { ColumnMapping } from '@/lib/services/csv';

// Client-side phone header detection matching the server-side set in csv.ts
const PHONE_HEADERS = new Set([
  'telefono',
  'cellulare',
  'numero',
  'phone',
  'mobile',
  'tel',
  'telephone',
  'numero_di_telefono',
  'phone_number',
  'cell',
  'phonenumber',
]);

const ALLOWED_TYPES = ['text/csv', 'application/vnd.ms-excel', 'text/plain'];
const ALLOWED_EXTENSIONS = ['csv', 'txt', 'xls'];
const NONE_VALUE = '__none__';

type ConsentBasis = 'consent' | 'legitimate_interest' | 'existing_customer';
type ContactType = 'b2c' | 'b2b';
type WizardStep = 'file' | 'mapping' | 'compliance';

function parseFileHeaders(
  file: File,
): Promise<{ headers: string[]; preview: Record<string, string>[] }> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      preview: 11,
      skipEmptyLines: true,
      complete: (results) => {
        resolve({
          headers: results.meta.fields ?? [],
          preview: results.data,
        });
      },
      error: (err: { message: string }) => reject(new Error(err.message)),
    });
  });
}

export default function ContactsUploadPage() {
  const t = useTranslations('contacts');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const [step, setStep] = useState<WizardStep>('file');

  // File step
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadDone, setUploadDone] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [listId, setListId] = useState<string | null>(null);
  const [storagePath, setStoragePath] = useState<string | null>(null);

  // Column detection
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<Record<string, string>[]>([]);
  const [needsMapping, setNeedsMapping] = useState(false);

  // Mapping step
  const [mapping, setMapping] = useState({ phone: '', firstName: '', lastName: '', email: '' });
  const [mappingError, setMappingError] = useState<string | null>(null);

  // Compliance step
  const [consentBasis, setConsentBasis] = useState<ConsentBasis>('consent');
  const [contactType, setContactType] = useState<ContactType>('b2c');
  const [consentEvidence, setConsentEvidence] = useState('');
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [complianceError, setComplianceError] = useState<string | null>(null);

  const handleFileSelect = useCallback(
    async (selectedFile: File) => {
      const ext = selectedFile.name.split('.').pop()?.toLowerCase() ?? '';
      if (!ALLOWED_TYPES.includes(selectedFile.type) && !ALLOWED_EXTENSIONS.includes(ext)) {
        toast.error(t('accepted_formats'));
        return;
      }

      setFile(selectedFile);
      setUploadProgress(0);
      setUploadDone(false);
      setUploadError(null);

      let headers: string[] = [];
      let preview: Record<string, string>[] = [];
      try {
        ({ headers, preview } = await parseFileHeaders(selectedFile));
      } catch {
        // Continue even if header parsing fails; server will handle it
      }
      setCsvHeaders(headers);
      setPreviewRows(preview);

      const phoneDetected = headers.some((h) => PHONE_HEADERS.has(h.toLowerCase().trim()));
      const mustMap = !phoneDetected && headers.length > 0;
      setNeedsMapping(mustMap);
      if (mustMap) {
        setMapping((prev) => ({ ...prev, phone: headers[0] ?? '' }));
      }

      let contentType = selectedFile.type;
      if (!ALLOWED_TYPES.includes(contentType)) contentType = 'text/csv';

      let uploadUrl: string;
      let newListId: string;
      let newStoragePath: string;
      try {
        const res = await fetch('/api/uploads/contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: selectedFile.name,
            sizeBytes: selectedFile.size,
            contentType,
          }),
        });
        if (!res.ok) {
          const err = (await res.json()) as { error?: string };
          throw new Error(err.error ?? t('upload_error'));
        }
        const data = (await res.json()) as {
          uploadUrl: string;
          listId: string;
          storagePath: string;
        };
        uploadUrl = data.uploadUrl;
        newListId = data.listId;
        newStoragePath = data.storagePath;
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : t('upload_error'));
        return;
      }

      setListId(newListId);
      setStoragePath(newStoragePath);

      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          setUploadProgress(Math.round((event.loaded / event.total) * 100));
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          setUploadProgress(100);
          setUploadDone(true);
        } else {
          setUploadError(t('upload_error'));
        }
      });

      xhr.addEventListener('error', () => {
        setUploadError(t('upload_error'));
      });

      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', contentType);
      xhr.send(selectedFile);
    },
    [t],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const dropped = e.dataTransfer.files[0];
      if (dropped) void handleFileSelect(dropped);
    },
    [handleFileSelect],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (selected) void handleFileSelect(selected);
  }

  function goToNextStep() {
    if (step === 'file') {
      setStep(needsMapping ? 'mapping' : 'compliance');
    } else if (step === 'mapping') {
      setMappingError(null);
      if (!mapping.phone) {
        setMappingError(t('phone_column_required'));
        return;
      }
      setStep('compliance');
    }
  }

  function goBack() {
    if (step === 'compliance') setStep(needsMapping ? 'mapping' : 'file');
    else if (step === 'mapping') setStep('file');
  }

  function handleSubmit() {
    setComplianceError(null);
    if (!disclaimerAccepted) {
      setComplianceError(t('disclaimer_required'));
      return;
    }
    if (!listId || !storagePath || !uploadDone) return;

    startTransition(async () => {
      const columnMapping: ColumnMapping | undefined = needsMapping
        ? {
            phone: mapping.phone,
            ...(mapping.firstName ? { firstName: mapping.firstName } : {}),
            ...(mapping.lastName ? { lastName: mapping.lastName } : {}),
            ...(mapping.email ? { email: mapping.email } : {}),
          }
        : undefined;

      const result = await triggerContactsImport({
        listId,
        storagePath,
        consentBasis,
        contactType,
        ...(consentEvidence ? { consentEvidence } : {}),
        ...(columnMapping ? { columnMapping } : {}),
      });

      if (!result.ok) {
        setComplianceError(result.message);
        return;
      }

      toast.success(t('import_started'));
      router.push(`/contacts/lists/${listId}`);
    });
  }

  const canProceedFromFile = uploadDone && !uploadError;

  const steps: { id: WizardStep; label: string }[] = [
    { id: 'file', label: t('step_file') },
    ...(needsMapping ? [{ id: 'mapping' as WizardStep, label: t('step_mapping') }] : []),
    { id: 'compliance', label: t('step_compliance') },
  ];

  const currentStepIndex = steps.findIndex((s) => s.id === step);

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('upload_title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('upload_description')}</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium ${
                s.id === step
                  ? 'bg-primary text-primary-foreground'
                  : i < currentStepIndex
                    ? 'bg-primary/20 text-primary'
                    : 'bg-muted text-muted-foreground'
              }`}
            >
              {i + 1}
            </div>
            <span
              className={`text-sm ${s.id === step ? 'font-medium' : 'text-muted-foreground'}`}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && <div className="mx-2 h-px w-8 bg-border" />}
          </div>
        ))}
      </div>

      {/* Step 1: File */}
      {step === 'file' && (
        <Card>
          <CardContent className="pt-6">
            <div
              role="button"
              tabIndex={0}
              aria-label={t('drop_file_here')}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors ${
                isDragging
                  ? 'border-primary bg-primary/5'
                  : 'border-muted-foreground/25 hover:border-primary/50'
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
              }}
            >
              <CloudUpload className="mb-4 h-10 w-10 text-muted-foreground" />
              <p className="text-sm font-medium">{t('drop_file_here')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('or_click_to_browse')}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {t('accepted_formats')} &middot; {t('file_size_limit')}
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt,text/csv,application/vnd.ms-excel,text/plain"
              className="hidden"
              onChange={handleFileInputChange}
            />

            {file && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center gap-3">
                  <span className="flex-1 truncate text-sm font-medium">{file.name}</span>
                  {uploadDone && <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />}
                  {uploadError && <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />}
                </div>

                {!uploadDone && !uploadError && (
                  <div className="space-y-1">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary transition-all duration-150"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('uploading')} {uploadProgress}%
                    </p>
                  </div>
                )}

                {uploadDone && (
                  <p className="text-xs text-green-600">{t('upload_complete')}</p>
                )}
                {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
                {uploadDone && csvHeaders.length > 0 && !needsMapping && (
                  <p className="text-xs text-muted-foreground">{t('auto_detected_columns')}</p>
                )}
              </div>
            )}
          </CardContent>
          <div className="flex justify-end border-t p-4">
            <Button onClick={goToNextStep} disabled={!canProceedFromFile}>
              {t('next')}
            </Button>
          </div>
        </Card>
      )}

      {/* Step 2: Column Mapping (optional) */}
      {step === 'mapping' && (
        <Card>
          <CardHeader>
            <CardTitle>{t('map_columns_title')}</CardTitle>
            <CardDescription>{t('map_columns_description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {previewRows.length > 0 && (
              <div className="overflow-x-auto">
                <p className="mb-2 text-sm font-medium">{t('preview_rows')}</p>
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      {csvHeaders.map((h) => (
                        <th key={h} className="border px-2 py-1 text-left font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.slice(0, 5).map((row, i) => (
                      <tr key={i}>
                        {csvHeaders.map((h) => (
                          <td key={h} className="border px-2 py-1 text-muted-foreground">
                            {row[h] ?? ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t('column_phone')} *</Label>
                <Select
                  value={mapping.phone}
                  onValueChange={(v) => setMapping((p) => ({ ...p, phone: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('not_mapped')} />
                  </SelectTrigger>
                  <SelectContent>
                    {csvHeaders.map((h) => (
                      <SelectItem key={h} value={h}>
                        {h}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>{t('column_first_name')}</Label>
                <Select
                  value={mapping.firstName || NONE_VALUE}
                  onValueChange={(v) =>
                    setMapping((p) => ({ ...p, firstName: v === NONE_VALUE ? '' : v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('not_mapped')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>{t('not_mapped')}</SelectItem>
                    {csvHeaders.map((h) => (
                      <SelectItem key={h} value={h}>
                        {h}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>{t('column_last_name')}</Label>
                <Select
                  value={mapping.lastName || NONE_VALUE}
                  onValueChange={(v) =>
                    setMapping((p) => ({ ...p, lastName: v === NONE_VALUE ? '' : v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('not_mapped')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>{t('not_mapped')}</SelectItem>
                    {csvHeaders.map((h) => (
                      <SelectItem key={h} value={h}>
                        {h}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>{t('column_email')}</Label>
                <Select
                  value={mapping.email || NONE_VALUE}
                  onValueChange={(v) =>
                    setMapping((p) => ({ ...p, email: v === NONE_VALUE ? '' : v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('not_mapped')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>{t('not_mapped')}</SelectItem>
                    {csvHeaders.map((h) => (
                      <SelectItem key={h} value={h}>
                        {h}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {mappingError && <p className="text-sm text-destructive">{mappingError}</p>}
          </CardContent>
          <div className="flex justify-between border-t p-4">
            <Button variant="outline" onClick={goBack}>
              {t('back')}
            </Button>
            <Button onClick={goToNextStep}>{t('next')}</Button>
          </div>
        </Card>
      )}

      {/* Step 3: Compliance */}
      {step === 'compliance' && (
        <Card>
          <CardContent className="space-y-6 pt-6">
            <div className="space-y-3">
              <Label>{t('consent_basis_label')}</Label>
              <RadioGroup
                value={consentBasis}
                onValueChange={(v) => setConsentBasis(v as ConsentBasis)}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="consent" id="cb-consent" />
                  <Label htmlFor="cb-consent">{t('consent_basis_consent')}</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="legitimate_interest" id="cb-li" />
                  <Label htmlFor="cb-li">{t('consent_basis_legitimate_interest')}</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="existing_customer" id="cb-ec" />
                  <Label htmlFor="cb-ec">{t('consent_basis_existing_customer')}</Label>
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-3">
              <Label>{t('contact_type_label')}</Label>
              <RadioGroup
                value={contactType}
                onValueChange={(v) => setContactType(v as ContactType)}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="b2c" id="ct-b2c" />
                  <Label htmlFor="ct-b2c">{t('contact_type_b2c')}</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="b2b" id="ct-b2b" />
                  <Label htmlFor="ct-b2b">{t('contact_type_b2b')}</Label>
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <Label htmlFor="consent-evidence">{t('consent_evidence_label')}</Label>
              <Textarea
                id="consent-evidence"
                value={consentEvidence}
                onChange={(e) => setConsentEvidence(e.target.value)}
                placeholder={t('consent_evidence_placeholder')}
                rows={3}
              />
            </div>

            <div className="rounded-md border p-4">
              <div className="flex items-start space-x-3">
                <Checkbox
                  id="disclaimer"
                  checked={disclaimerAccepted}
                  onCheckedChange={(v) => setDisclaimerAccepted(v === true)}
                />
                <Label htmlFor="disclaimer" className="cursor-pointer leading-relaxed">
                  {t('disclaimer_text')}
                </Label>
              </div>
            </div>

            {complianceError && <p className="text-sm text-destructive">{complianceError}</p>}
          </CardContent>
          <div className="flex justify-between border-t p-4">
            <Button variant="outline" onClick={goBack}>
              {t('back')}
            </Button>
            <Button onClick={handleSubmit} disabled={isPending || !uploadDone}>
              {isPending ? t('submitting_import') : t('submit_import')}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

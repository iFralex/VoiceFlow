'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ─── Schema types (runtime, for form generation) ──────────────────────────────

export type JsonSchemaProperty = {
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

// ─── Component ────────────────────────────────────────────────────────────────

export function VariableField({
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

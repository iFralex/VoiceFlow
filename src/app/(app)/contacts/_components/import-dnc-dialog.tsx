'use client';

import { ShieldOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { importDncList } from '@/actions/contacts';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export function ImportDncDialog() {
  const t = useTranslations('contacts');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [csvText, setCsvText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  function resetForm() {
    setCsvText('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleOpenChange(value: boolean) {
    if (!value) resetForm();
    setOpen(value);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === 'string') setCsvText(text);
    };
    reader.readAsText(file, 'utf-8');
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!csvText.trim()) return;

    startTransition(async () => {
      const result = await importDncList({ csvText });

      if (!result.ok) {
        toast.error(result.message ?? t('dnc_error'));
        return;
      }

      if ((result.processedCount ?? 0) === 0) {
        toast.warning(t('dnc_no_valid_numbers'));
      } else {
        toast.success(t('dnc_success', { count: result.processedCount ?? 0 }));
      }

      setOpen(false);
      resetForm();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ShieldOff className="mr-2 size-4" />
          {t('dnc_btn')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('dnc_dialog_title')}</DialogTitle>
          <DialogDescription>{t('dnc_dialog_description')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="dnc-file">{t('dnc_file_label')}</Label>
            <input
              ref={fileInputRef}
              id="dnc-file"
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              onChange={handleFileChange}
              className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="dnc-text">{t('dnc_paste_label')}</Label>
            <Textarea
              id="dnc-text"
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder={t('dnc_paste_placeholder')}
              rows={6}
              className="font-mono text-xs"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              {t('back')}
            </Button>
            <Button type="submit" disabled={isPending || !csvText.trim()}>
              {isPending ? t('dnc_submitting') : t('dnc_submit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

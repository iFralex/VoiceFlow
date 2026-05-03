'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Copy } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { createPatAction } from '@/actions/pat';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { toastResult } from '@/lib/utils/action-toast';

const createSchema = z.object({
  name: z.string().min(1, 'name_required').max(100, 'name_too_long'),
});

type CreateValues = z.infer<typeof createSchema>;

export function CreatePatDialog() {
  const t = useTranslations('integrations');
  const tc = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [newToken, setNewToken] = useState<string | null>(null);

  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: '' },
  });

  function onSubmit(values: CreateValues) {
    startTransition(async () => {
      const result = await createPatAction({ name: values.name, scopes: ['api'] });
      if (result.ok && result.rawToken) {
        setNewToken(result.rawToken);
        router.refresh();
      } else {
        toastResult(result);
      }
    });
  }

  function handleClose() {
    setOpen(false);
    setNewToken(null);
    form.reset();
  }

  function copyToken() {
    if (newToken) {
      void navigator.clipboard.writeText(newToken);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else setOpen(true); }}>
      <DialogTrigger asChild>
        <Button size="sm">{t('create_token')}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {newToken ? t('token_created_title') : t('create_token_dialog_title')}
          </DialogTitle>
        </DialogHeader>

        {newToken ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('token_created_description')}</p>
            <div className="flex items-center gap-2 rounded-md border bg-muted px-3 py-2">
              <code className="flex-1 break-all text-xs">{newToken}</code>
              <Button type="button" variant="ghost" size="icon" onClick={copyToken} aria-label={t('copy_token')}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={handleClose}>{tc('confirm')}</Button>
            </DialogFooter>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('token_name_label')}</FormLabel>
                    <FormControl>
                      <Input placeholder={t('token_name_placeholder')} autoFocus {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleClose}
                  disabled={isPending}
                >
                  {tc('cancel')}
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending ? t('create_token_submitting') : t('create_token_submit')}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}

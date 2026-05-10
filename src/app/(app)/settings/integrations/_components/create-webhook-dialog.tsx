'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Copy } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { createWebhookAction } from '@/actions/webhooks';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ALLOWED_EVENT_TYPES } from '@/lib/services/webhooks_outgoing';
import { toastResult } from '@/lib/utils/action-toast';

const createSchema = z.object({
  url: z.string().url('url_invalid'),
  eventTypes: z.array(z.string()).min(1, 'event_types_required'),
});

type CreateValues = z.infer<typeof createSchema>;

export function CreateWebhookDialog() {
  const t = useTranslations('webhooks');
  const tc = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [secret, setSecret] = useState<string | null>(null);

  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { url: '', eventTypes: [] },
  });

  function onSubmit(values: CreateValues) {
    startTransition(async () => {
      const result = await createWebhookAction({
        url: values.url,
        eventTypes: values.eventTypes,
      });
      if (result.ok && result.secretRevealed) {
        setSecret(result.secretRevealed);
        router.refresh();
      } else {
        toastResult(result);
      }
    });
  }

  function handleClose() {
    setOpen(false);
    setSecret(null);
    form.reset();
  }

  function copySecret() {
    if (secret) {
      void navigator.clipboard.writeText(secret);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else setOpen(true); }}>
      <DialogTrigger asChild>
        <Button size="sm">{t('create_webhook')}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {secret ? t('webhook_created_title') : t('create_webhook_dialog_title')}
          </DialogTitle>
        </DialogHeader>

        {secret ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('webhook_secret_description')}</p>
            <div className="flex items-center gap-2 rounded-md border bg-muted px-3 py-2">
              <code className="flex-1 break-all text-xs">{secret}</code>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={copySecret}
                aria-label={t('copy_secret')}
              >
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
                name="url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('url_label')}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t('url_placeholder')}
                        autoFocus
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="eventTypes"
                render={() => (
                  <FormItem>
                    <FormLabel>{t('event_types_label')}</FormLabel>
                    <div className="space-y-2">
                      {ALLOWED_EVENT_TYPES.map((et) => (
                        <FormField
                          key={et}
                          control={form.control}
                          name="eventTypes"
                          render={({ field }) => (
                            <FormItem className="flex items-center gap-2">
                              <FormControl>
                                <Checkbox
                                  checked={field.value.includes(et)}
                                  onCheckedChange={(checked) => {
                                    if (checked) {
                                      field.onChange([...field.value, et]);
                                    } else {
                                      field.onChange(field.value.filter((v) => v !== et));
                                    }
                                  }}
                                />
                              </FormControl>
                              <FormLabel className="cursor-pointer font-normal">
                                <code className="text-xs">{et}</code>
                              </FormLabel>
                            </FormItem>
                          )}
                        />
                      ))}
                    </div>
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
                  {isPending ? t('create_webhook_submitting') : t('create_webhook_submit')}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}

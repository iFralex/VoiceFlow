'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { createOrganizationAndOnboard } from '@/actions/onboarding';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { toastResult } from '@/lib/utils/action-toast';

const onboardingSchema = z.object({
  name: z.string().min(1, 'name_required').max(100, 'name_too_long'),
  legalName: z.string().optional(),
  vatNumber: z
    .string()
    .optional()
    .refine((v) => !v || /^\d{11}$/.test(v.trim()), 'vat_invalid'),
  dpaAccepted: z.boolean().refine((v) => v === true, 'dpa_required'),
});

type OnboardingValues = z.infer<typeof onboardingSchema>;

export default function OnboardingPage() {
  const t = useTranslations('onboarding');
  const [isPending, startTransition] = useTransition();

  const form = useForm<OnboardingValues>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      name: '',
      legalName: '',
      vatNumber: '',
      dpaAccepted: false,
    },
  });

  function onSubmit(values: OnboardingValues) {
    startTransition(async () => {
      const result = await createOrganizationAndOnboard({
        name: values.name,
        legalName: values.legalName || undefined,
        vatNumber: values.vatNumber || undefined,
      });
      // Success causes a server-side redirect; only failures reach this point
      toastResult(result);
    });
  }

  return (
    <div className="mx-auto max-w-lg space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {/* Organization name */}
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('name_label')}</FormLabel>
                <FormControl>
                  <Input placeholder={t('name_placeholder')} autoFocus {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Legal name */}
          <FormField
            control={form.control}
            name="legalName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('legal_name_label')}</FormLabel>
                <FormControl>
                  <Input placeholder={t('legal_name_placeholder')} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* VAT number */}
          <FormField
            control={form.control}
            name="vatNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('vat_label')}</FormLabel>
                <FormControl>
                  <Input placeholder={t('vat_placeholder')} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Country — locked to Italy in Phase 1 */}
          <div className="space-y-2">
            <FormLabel>{t('country_label')}</FormLabel>
            <Input value={t('country_it')} disabled />
          </div>

          {/* DPA acceptance */}
          <FormField
            control={form.control}
            name="dpaAccepted"
            render={({ field }) => (
              <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                <FormControl>
                  <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <FormLabel>
                    {t('dpa_label_before')}
                    <Link
                      href="/legal/dpa"
                      className="font-medium underline-offset-4 hover:underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('dpa_link_text')}
                    </Link>
                  </FormLabel>
                  <FormMessage />
                </div>
              </FormItem>
            )}
          />

          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? t('submitting') : t('submit')}
          </Button>
        </form>
      </Form>
    </div>
  );
}

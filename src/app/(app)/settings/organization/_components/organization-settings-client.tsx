'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  deleteOrganizationAction,
  updateOrganizationAction,
} from '@/actions/organization';
import { createBillingPortalSession } from '@/actions/billing';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { toastResult } from '@/lib/utils/action-toast';

const updateOrgSchema = z.object({
  name: z.string().min(1, 'name_required').max(100, 'name_too_long'),
  legalName: z.string().optional(),
  vatNumber: z
    .string()
    .optional()
    .refine((v) => !v || /^\d{11}$/.test(v.trim()), 'vat_invalid'),
});

type UpdateOrgValues = z.infer<typeof updateOrgSchema>;

export type SerializedOrg = {
  id: string;
  name: string;
  legal_name: string | null;
  vat_number: string | null;
  created_at: string;
  memberCount: number;
};

interface OrganizationSettingsClientProps {
  org: SerializedOrg;
  isOwner: boolean;
  canUpdate: boolean;
}

function DeleteOrgDialog({ orgName }: { orgName: string }) {
  const t = useTranslations('settings');
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDelete() {
    const confirmed = inputRef.current?.value ?? '';
    startTransition(async () => {
      const result = await deleteOrganizationAction({ confirmedName: confirmed });
      if (!result.ok) {
        toastResult(result);
      }
      // On success, the server action redirects to /onboarding
    });
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="destructive">{t('org_delete_button')}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('org_delete_dialog_title')}</DialogTitle>
          <DialogDescription>
            {t('org_delete_dialog_description', { name: orgName })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{t('org_delete_confirm_label')}</p>
          <Input
            ref={inputRef}
            placeholder={orgName}
            aria-label={t('org_delete_confirm_label')}
          />
        </div>
        <DialogFooter>
          <Button variant="destructive" disabled={isPending} onClick={handleDelete}>
            {isPending ? t('org_delete_submitting') : t('org_delete_button')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OrganizationSettingsClient({ org, isOwner, canUpdate }: OrganizationSettingsClientProps) {
  const t = useTranslations('settings');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const form = useForm<UpdateOrgValues>({
    resolver: zodResolver(updateOrgSchema),
    defaultValues: {
      name: org.name,
      legalName: org.legal_name ?? '',
      vatNumber: org.vat_number ?? '',
    },
  });

  function onSubmit(values: UpdateOrgValues) {
    startTransition(async () => {
      const result = await updateOrganizationAction({
        name: values.name,
        ...(values.legalName ? { legalName: values.legalName } : {}),
        ...(values.vatNumber ? { vatNumber: values.vatNumber } : {}),
      });
      toastResult(result);
      if (result.ok) {
        router.refresh();
      }
    });
  }

  const createdAt = new Date(org.created_at).toLocaleDateString('it-IT', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('org_title')}</h1>
        <p className="text-sm text-muted-foreground">{t('org_description')}</p>
      </div>

      {/* Info card */}
      <div className="rounded-lg border p-4 text-sm">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <dt className="font-medium text-muted-foreground">{t('org_info_id')}</dt>
            <dd className="mt-1 font-mono text-xs break-all">{org.id}</dd>
          </div>
          <div>
            <dt className="font-medium text-muted-foreground">{t('org_info_created')}</dt>
            <dd className="mt-1">{createdAt}</dd>
          </div>
          <div>
            <dt className="font-medium text-muted-foreground">{t('org_info_members')}</dt>
            <dd className="mt-1">{org.memberCount}</dd>
          </div>
        </dl>
      </div>

      {/* Edit form */}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-lg space-y-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('org_name_label')}</FormLabel>
                <FormControl>
                  <Input {...field} disabled={!canUpdate} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="legalName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('org_legal_name_label')}</FormLabel>
                <FormControl>
                  <Input placeholder={t('org_legal_name_placeholder')} {...field} disabled={!canUpdate} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="vatNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('org_vat_label')}</FormLabel>
                <FormControl>
                  <Input placeholder={t('org_vat_placeholder')} {...field} disabled={!canUpdate} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {canUpdate && (
            <Button type="submit" disabled={isPending}>
              {isPending ? t('org_save_submitting') : t('org_save_button')}
            </Button>
          )}
        </form>
      </Form>

      {/* Billing portal */}
      <BillingPortalSection />

      {/* Danger zone — owner only */}
      {isOwner && (
        <div className="rounded-lg border border-destructive/30 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-destructive">{t('org_danger_zone_title')}</h2>
          <p className="text-sm text-muted-foreground">{t('org_danger_zone_description')}</p>
          <DeleteOrgDialog orgName={org.name} />
        </div>
      )}
    </div>
  );
}

function BillingPortalSection() {
  const t = useTranslations('settings');
  const [isPending, startTransition] = useTransition();

  function handleOpenPortal() {
    startTransition(async () => {
      const result = await createBillingPortalSession();
      if (result.ok && result.url) {
        window.location.href = result.url;
      }
    });
  }

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <h2 className="text-sm font-semibold">{t('billing_portal_title')}</h2>
      <p className="text-sm text-muted-foreground">{t('billing_portal_description')}</p>
      <Button variant="outline" disabled={isPending} onClick={handleOpenPortal}>
        {isPending ? t('billing_portal_opening') : t('billing_portal_button')}
      </Button>
    </div>
  );
}

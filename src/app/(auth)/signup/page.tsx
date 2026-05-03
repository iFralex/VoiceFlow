'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { signInWithMagicLink } from '@/actions/auth';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { toastResult } from '@/lib/utils/action-toast';

const signupSchema = z.object({
  email: z.string().min(1, 'email_required').email('email_invalid'),
});
type SignupValues = z.infer<typeof signupSchema>;

export default function SignupPage() {
  const t = useTranslations('auth');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { email: '' },
  });

  function onSubmit(values: SignupValues) {
    startTransition(async () => {
      // Sign-in and sign-up use the same magic link flow; new users get a
      // `public.users` row created automatically via the auth trigger.
      const result = await signInWithMagicLink(values.email);
      if (result.ok) {
        router.push(`/verify?email=${encodeURIComponent(values.email)}`);
      } else {
        const message =
          result.message === 'email_required' || result.message === 'email_invalid'
            ? t(result.message as 'email_required' | 'email_invalid')
            : result.message;
        toastResult({ ok: false, message });
      }
    });
  }

  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t('signup_title')}</h1>
        <p className="text-sm text-muted-foreground">{t('signup_description')}</p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('email')}</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    placeholder="you@example.com"
                    autoComplete="email"
                    autoFocus
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? t('sending') : t('send_link')}
          </Button>
        </form>
      </Form>

      <p className="text-center text-sm text-muted-foreground">
        {t('already_have_account')}{' '}
        <Link
          href="/login"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {t('sign_in')}
        </Link>
      </p>
    </div>
  );
}

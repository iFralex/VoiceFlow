'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';

import { deleteScript } from '@/actions/scripts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { toastResult } from '@/lib/utils/action-toast';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TemplateCard = {
  slug: string;
  name: string;
  description: string;
  requiredFields: string[];
};

export type SerializedScript = {
  id: string;
  name: string;
  template_slug: string;
  template_name: string;
  updated_at: string;
};

type Props = {
  templateCards: TemplateCard[];
  scripts: SerializedScript[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium' }).format(new Date(iso));
}

// ─── Sub-component: script table row ─────────────────────────────────────────

function ScriptRow({
  script,
  onDeleted,
}: {
  script: SerializedScript;
  onDeleted: () => void;
}) {
  const t = useTranslations('scripts');
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteScript({ scriptId: script.id });
      toastResult(result, t('delete_success'));
      if (result.ok) onDeleted();
    });
  }

  return (
    <tr className="border-b last:border-0 hover:bg-muted/30">
      <td className="px-4 py-3 font-medium">{script.name}</td>
      <td className="px-4 py-3">
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          {script.template_name}
        </span>
      </td>
      <td className="px-4 py-3 text-muted-foreground">{formatDate(script.updated_at)}</td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/scripts/${script.id}`}>{t('action_edit')}</Link>
          </Button>
          <ConfirmDialog
            trigger={
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                disabled={isPending}
              >
                {t('action_delete')}
              </Button>
            }
            title={t('delete_title')}
            description={t('delete_description')}
            onConfirm={handleDelete}
          />
        </div>
      </td>
    </tr>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ScriptsPageClient({ templateCards, scripts }: Props) {
  const t = useTranslations('scripts');
  const router = useRouter();

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
      </div>

      {/* Available templates */}
      <section>
        <h2 className="mb-4 text-lg font-medium">{t('templates_title')}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templateCards.map((tpl) => (
            <Card key={tpl.slug} className="flex flex-col">
              <CardHeader>
                <CardTitle className="text-base">{tpl.name}</CardTitle>
                <CardDescription>{tpl.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('required_fields')}
                </p>
                <div className="flex flex-wrap gap-1">
                  {tpl.requiredFields.map((field) => (
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
                <Button asChild size="sm" className="w-full">
                  <Link href={`/scripts/new?template=${tpl.slug}`}>
                    {t('create_from_template')}
                  </Link>
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </section>

      {/* Org scripts */}
      <section>
        <h2 className="mb-4 text-lg font-medium">{t('your_scripts_title')}</h2>
        {scripts.length === 0 ? (
          <EmptyState title={t('no_scripts')} />
        ) : (
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium">{t('col_name')}</th>
                  <th className="px-4 py-3 text-left font-medium">{t('col_template')}</th>
                  <th className="px-4 py-3 text-left font-medium">{t('col_updated')}</th>
                  <th className="px-4 py-3 text-right font-medium">{t('col_actions')}</th>
                </tr>
              </thead>
              <tbody>
                {scripts.map((script) => (
                  <ScriptRow
                    key={script.id}
                    script={script}
                    onDeleted={() => router.refresh()}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

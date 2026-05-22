import Link from 'next/link';
import type { ReactNode } from 'react';

export interface LegalSectionContent {
  title: string;
  body: string;
}

export interface LegalMetaItem {
  label: string;
  value: string;
}

interface LegalDocumentProps {
  testId: string;
  title: string;
  subtitle: string;
  draftNotice: string;
  lastUpdatedLabel: string;
  effectiveDate: string;
  backToHome: string;
  meta?: LegalMetaItem[];
  sections: LegalSectionContent[];
  children?: ReactNode;
}

export function LegalDocument({
  testId,
  title,
  subtitle,
  draftNotice,
  lastUpdatedLabel,
  effectiveDate,
  backToHome,
  meta,
  sections,
  children,
}: LegalDocumentProps) {
  return (
    <article data-testid={testId} className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-3 border-b pb-6">
        <h1 className="text-foreground text-3xl font-semibold tracking-tight sm:text-4xl">
          {title}
        </h1>
        <p className="text-muted-foreground text-base">{subtitle}</p>
        <dl className="text-muted-foreground grid gap-1 text-sm sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="text-foreground font-medium">{lastUpdatedLabel}:</dt>
            <dd>{effectiveDate}</dd>
          </div>
          {meta?.map((item) => (
            <div key={item.label} className="flex gap-2">
              <dt className="text-foreground font-medium">{item.label}:</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
        <p
          role="note"
          className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          {draftNotice}
        </p>
      </header>

      <div className="space-y-8 leading-relaxed">
        {sections.map((section) => (
          <section key={section.title} className="space-y-2">
            <h2 className="text-foreground text-xl font-semibold tracking-tight">
              {section.title}
            </h2>
            <p className="text-foreground/90 text-sm">{section.body}</p>
          </section>
        ))}
        {children}
      </div>

      <footer className="border-t pt-6">
        <Link href="/" className="text-primary text-sm underline-offset-4 hover:underline">
          ← {backToHome}
        </Link>
      </footer>
    </article>
  );
}

import type { ReactNode } from 'react';

import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';

export type EmailLocale = 'it' | 'en';

type LayoutStrings = {
  footerSent: (org: string) => string;
  footerPreferences: string;
  footerSupport: string;
};

const LAYOUT_STRINGS: Record<EmailLocale, LayoutStrings> = {
  it: {
    footerSent: (org) => `Hai ricevuto questa email perché sei membro di ${org}.`,
    footerPreferences: 'Gestisci le preferenze di notifica',
    footerSupport: 'Supporto',
  },
  en: {
    footerSent: (org) =>
      `You received this email because you are a member of ${org}.`,
    footerPreferences: 'Manage notification preferences',
    footerSupport: 'Support',
  },
};

type EmailLayoutProps = {
  locale: EmailLocale;
  preview: string;
  children: ReactNode;
  orgName: string;
  preferencesUrl: string;
  supportUrl?: string;
  appUrl?: string;
};

export function EmailLayout({
  locale,
  preview,
  children,
  orgName,
  preferencesUrl,
  supportUrl,
  appUrl,
}: EmailLayoutProps) {
  const t = LAYOUT_STRINGS[locale];

  return (
    <Html lang={locale}>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={layoutStyles.body}>
        <Container style={layoutStyles.container}>
          <Section style={layoutStyles.header}>
            {appUrl ? (
              <Link href={appUrl} style={layoutStyles.logoLink}>
                VoiceFlow
              </Link>
            ) : (
              <Text style={layoutStyles.logoText}>VoiceFlow</Text>
            )}
          </Section>

          {children}

          <Hr style={layoutStyles.hr} />
          <Section>
            <Text style={layoutStyles.footerText}>{t.footerSent(orgName)}</Text>
            <Text style={layoutStyles.footerText}>
              <Link href={preferencesUrl} style={layoutStyles.footerLink}>
                {t.footerPreferences}
              </Link>
            </Text>
            {supportUrl && (
              <Text style={layoutStyles.footerText}>
                <Link href={supportUrl} style={layoutStyles.footerLink}>
                  {t.footerSupport}
                </Link>
              </Text>
            )}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

type KpiCellProps = {
  value: string;
  label: string;
};

export function KpiCell({ value, label }: KpiCellProps) {
  return (
    <Column style={layoutStyles.kpiCell}>
      <Text style={layoutStyles.kpiValue}>{value}</Text>
      <Text style={layoutStyles.kpiLabel}>{label}</Text>
    </Column>
  );
}

type DataTableProps = {
  columns: string[];
  children?: ReactNode;
  emptyText?: string;
};

export function DataTable({ columns, children, emptyText }: DataTableProps) {
  if (!children) {
    return emptyText ? (
      <Text style={layoutStyles.muted}>{emptyText}</Text>
    ) : null;
  }
  return (
    <table cellPadding={0} cellSpacing={0} style={layoutStyles.table}>
      <thead>
        <tr>
          {columns.map((col, i) => (
            <th key={i} style={layoutStyles.th}>
              {col}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

type DataRowProps = {
  cells: ReactNode[];
};

export function DataRow({ cells }: DataRowProps) {
  return (
    <tr>
      {cells.map((cell, i) => (
        <td key={i} style={layoutStyles.td}>
          {cell}
        </td>
      ))}
    </tr>
  );
}

type CtaButtonProps = {
  href: string;
  children: ReactNode;
};

export function CtaButton({ href, children }: CtaButtonProps) {
  return (
    <Section style={layoutStyles.ctaWrap}>
      <Button href={href} style={layoutStyles.ctaButton}>
        {children}
      </Button>
    </Section>
  );
}

type AlertProps = {
  type?: 'info' | 'warning' | 'success';
  children: ReactNode;
};

export function Alert({ type = 'info', children }: AlertProps) {
  const alertStyle =
    type === 'warning'
      ? { ...layoutStyles.alertBase, ...layoutStyles.alertWarning }
      : type === 'success'
        ? { ...layoutStyles.alertBase, ...layoutStyles.alertSuccess }
        : { ...layoutStyles.alertBase, ...layoutStyles.alertInfo };

  return (
    <Section style={alertStyle}>
      <Text style={layoutStyles.alertText}>{children}</Text>
    </Section>
  );
}

export const layoutStyles = {
  body: {
    backgroundColor: '#f4f4f5',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    margin: 0,
    padding: '24px 0',
  } as const,
  container: {
    backgroundColor: '#ffffff',
    border: '1px solid #e4e4e7',
    borderRadius: '8px',
    margin: '0 auto',
    maxWidth: '600px',
    padding: '32px',
  } as const,
  header: {
    borderBottom: '1px solid #e5e7eb',
    marginBottom: '24px',
    paddingBottom: '20px',
  } as const,
  logoLink: {
    color: '#111827',
    fontSize: '20px',
    fontWeight: 700,
    letterSpacing: '-0.02em',
    textDecoration: 'none',
  } as const,
  logoText: {
    color: '#111827',
    fontSize: '20px',
    fontWeight: 700,
    letterSpacing: '-0.02em',
    margin: 0,
  } as const,
  hr: {
    borderColor: '#e5e7eb',
    margin: '24px 0',
  } as const,
  footerText: {
    color: '#6b7280',
    fontSize: '12px',
    lineHeight: '18px',
    margin: '4px 0',
  } as const,
  footerLink: {
    color: '#2563eb',
    textDecoration: 'underline',
  } as const,
  kpiCell: {
    backgroundColor: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    padding: '16px',
    textAlign: 'center' as const,
    width: '33%',
  } as const,
  kpiValue: {
    color: '#111827',
    fontSize: '28px',
    fontWeight: 700,
    lineHeight: '32px',
    margin: 0,
  } as const,
  kpiLabel: {
    color: '#6b7280',
    fontSize: '12px',
    margin: '4px 0 0',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  } as const,
  muted: {
    color: '#6b7280',
    fontSize: '14px',
    margin: 0,
  } as const,
  sectionTitle: {
    color: '#111827',
    fontSize: '16px',
    fontWeight: 600,
    margin: '0 0 12px',
  } as const,
  table: {
    borderCollapse: 'collapse' as const,
    width: '100%',
  } as const,
  th: {
    borderBottom: '1px solid #e5e7eb',
    color: '#6b7280',
    fontSize: '12px',
    fontWeight: 600,
    padding: '8px 6px',
    textAlign: 'left' as const,
    textTransform: 'uppercase' as const,
  } as const,
  td: {
    borderBottom: '1px solid #f3f4f6',
    color: '#111827',
    fontSize: '14px',
    padding: '8px 6px',
    verticalAlign: 'top' as const,
  } as const,
  ctaWrap: {
    margin: '24px 0',
    textAlign: 'center' as const,
  } as const,
  ctaButton: {
    backgroundColor: '#111827',
    borderRadius: '6px',
    color: '#ffffff',
    display: 'inline-block',
    fontSize: '14px',
    fontWeight: 600,
    padding: '12px 20px',
    textDecoration: 'none',
  } as const,
  alertBase: {
    borderRadius: '6px',
    margin: '12px 0',
    padding: '12px 16px',
  } as const,
  alertInfo: {
    backgroundColor: '#eff6ff',
    border: '1px solid #bfdbfe',
  } as const,
  alertWarning: {
    backgroundColor: '#fffbeb',
    border: '1px solid #fde68a',
  } as const,
  alertSuccess: {
    backgroundColor: '#f0fdf4',
    border: '1px solid #bbf7d0',
  } as const,
  alertText: {
    color: '#111827',
    fontSize: '14px',
    lineHeight: '20px',
    margin: 0,
  } as const,
};

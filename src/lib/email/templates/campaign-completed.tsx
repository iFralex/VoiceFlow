import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  render,
  Row,
  Section,
  Text,
} from '@react-email/components';

export type CampaignCompletedLocale = 'it' | 'en';

export type CampaignCompletedEmailProps = {
  locale: CampaignCompletedLocale;
  recipientName?: string;
  orgName: string;
  campaignName: string;
  totalCalls: number;
  completedCalls: number;
  failedCalls: number;
  qualifiedLeads: number;
  appointments: number;
  totalCostCents: number;
  avgDurationSeconds: number;
  campaignUrl: string;
  reportDownloadUrl: string;
  preferencesUrl: string;
  appUrl?: string;
};

type Strings = {
  preview: (campaign: string) => string;
  subject: (campaign: string) => string;
  greeting: (name: string) => string;
  intro: (campaign: string) => string;
  kpiHeading: string;
  kpiCalls: string;
  kpiCompleted: string;
  kpiFailed: string;
  kpiLeads: string;
  kpiAppointments: string;
  kpiCost: string;
  kpiAvgDuration: string;
  ctaDownload: string;
  ctaCampaign: string;
  footerSent: (org: string) => string;
  footerPreferences: string;
};

const STRINGS: Record<CampaignCompletedLocale, Strings> = {
  it: {
    preview: (campaign) => `Campagna conclusa — ${campaign}`,
    subject: (campaign) => `Campagna conclusa — ${campaign}`,
    greeting: (name) => `Ciao ${name},`,
    intro: (campaign) =>
      `La campagna "${campaign}" è terminata. Qui trovi il riepilogo dei risultati.`,
    kpiHeading: 'Risultati campagna',
    kpiCalls: 'Chiamate totali',
    kpiCompleted: 'Completate',
    kpiFailed: 'Fallite',
    kpiLeads: 'Lead qualificati',
    kpiAppointments: 'Appuntamenti',
    kpiCost: 'Costo totale',
    kpiAvgDuration: 'Durata media',
    ctaDownload: 'Scarica report',
    ctaCampaign: 'Vedi campagna',
    footerSent: (org) => `Hai ricevuto questa email perché sei membro di ${org}.`,
    footerPreferences: 'Gestisci le preferenze di notifica',
  },
  en: {
    preview: (campaign) => `Campaign completed — ${campaign}`,
    subject: (campaign) => `Campaign completed — ${campaign}`,
    greeting: (name) => `Hi ${name},`,
    intro: (campaign) =>
      `The campaign "${campaign}" has ended. Here is a summary of the results.`,
    kpiHeading: 'Campaign results',
    kpiCalls: 'Total calls',
    kpiCompleted: 'Completed',
    kpiFailed: 'Failed',
    kpiLeads: 'Qualified leads',
    kpiAppointments: 'Appointments',
    kpiCost: 'Total cost',
    kpiAvgDuration: 'Avg duration',
    ctaDownload: 'Download report',
    ctaCampaign: 'View campaign',
    footerSent: (org) => `You received this email because you are a member of ${org}.`,
    footerPreferences: 'Manage notification preferences',
  },
};

function formatCost(cents: number, locale: CampaignCompletedLocale): string {
  const euros = cents / 100;
  return new Intl.NumberFormat(locale === 'it' ? 'it-IT' : 'en-GB', {
    style: 'currency',
    currency: 'EUR',
  }).format(euros);
}

function formatDuration(seconds: number, locale: CampaignCompletedLocale): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (locale === 'it') {
    return mins > 0 ? `${mins} min ${secs} sec` : `${secs} sec`;
  }
  return mins > 0 ? `${mins} min ${secs} sec` : `${secs} sec`;
}

export function CampaignCompletedEmail(props: CampaignCompletedEmailProps) {
  const t = STRINGS[props.locale];
  const previewText = t.preview(props.campaignName);
  const greetingName = props.recipientName?.trim() || props.orgName;

  const kpiRows = [
    { label: t.kpiCalls, value: String(props.totalCalls) },
    { label: t.kpiCompleted, value: String(props.completedCalls) },
    { label: t.kpiFailed, value: String(props.failedCalls) },
    { label: t.kpiLeads, value: String(props.qualifiedLeads) },
    { label: t.kpiAppointments, value: String(props.appointments) },
    { label: t.kpiCost, value: formatCost(props.totalCostCents, props.locale) },
    { label: t.kpiAvgDuration, value: formatDuration(props.avgDurationSeconds, props.locale) },
  ];

  return (
    <Html lang={props.locale}>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.header}>
            {props.appUrl ? (
              <Link href={props.appUrl} style={styles.logoLink}>
                VoiceFlow
              </Link>
            ) : (
              <Text style={styles.logoText}>VoiceFlow</Text>
            )}
          </Section>

          <Section style={styles.hero}>
            <Heading as="h1" style={styles.heroTitle}>
              {props.campaignName}
            </Heading>
            <Text style={styles.greeting}>{t.greeting(greetingName)}</Text>
            <Text style={styles.intro}>{t.intro(props.campaignName)}</Text>
          </Section>

          <Section style={styles.kpiBox}>
            <Heading as="h2" style={styles.sectionTitle}>
              {t.kpiHeading}
            </Heading>
            <Row style={styles.kpiGrid}>
              <Column style={styles.kpiColumn}>
                <Text style={styles.kpiValue}>{String(props.totalCalls)}</Text>
                <Text style={styles.kpiLabel}>{t.kpiCalls}</Text>
              </Column>
              <Column style={styles.kpiColumn}>
                <Text style={styles.kpiValue}>{String(props.completedCalls)}</Text>
                <Text style={styles.kpiLabel}>{t.kpiCompleted}</Text>
              </Column>
              <Column style={styles.kpiColumn}>
                <Text style={styles.kpiValueWarning}>{String(props.failedCalls)}</Text>
                <Text style={styles.kpiLabel}>{t.kpiFailed}</Text>
              </Column>
            </Row>
            <Row style={styles.kpiGrid}>
              <Column style={styles.kpiColumn}>
                <Text style={styles.kpiValueSuccess}>{String(props.qualifiedLeads)}</Text>
                <Text style={styles.kpiLabel}>{t.kpiLeads}</Text>
              </Column>
              <Column style={styles.kpiColumn}>
                <Text style={styles.kpiValueSuccess}>{String(props.appointments)}</Text>
                <Text style={styles.kpiLabel}>{t.kpiAppointments}</Text>
              </Column>
              <Column style={styles.kpiColumn}>
                <Text style={styles.kpiValue}>{formatCost(props.totalCostCents, props.locale)}</Text>
                <Text style={styles.kpiLabel}>{t.kpiCost}</Text>
              </Column>
            </Row>

            <Hr style={styles.kpiDivider} />

            <table cellPadding={0} cellSpacing={0} style={styles.detailsTable}>
              <tbody>
                {kpiRows.slice(-1).map((row) => (
                  <tr key={row.label}>
                    <td style={styles.detailLabel}>{row.label}</td>
                    <td style={styles.detailValue}>{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section style={styles.ctaWrap}>
            <Button href={props.reportDownloadUrl} style={styles.ctaPrimary}>
              {t.ctaDownload}
            </Button>
          </Section>

          <Section style={styles.ctaSecondaryWrap}>
            <Link href={props.campaignUrl} style={styles.ctaSecondaryLink}>
              {t.ctaCampaign}
            </Link>
          </Section>

          <Hr style={styles.hr} />

          <Section>
            <Text style={styles.footer}>{t.footerSent(props.orgName)}</Text>
            <Text style={styles.footer}>
              <Link href={props.preferencesUrl} style={styles.footerLink}>
                {t.footerPreferences}
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export type RenderedCampaignCompleted = {
  subject: string;
  html: string;
  text: string;
};

export async function renderCampaignCompletedEmail(
  props: CampaignCompletedEmailProps,
): Promise<RenderedCampaignCompleted> {
  const t = STRINGS[props.locale];
  const subject = t.subject(props.campaignName);
  const html = await render(<CampaignCompletedEmail {...props} />);
  const text = await render(<CampaignCompletedEmail {...props} />, { plainText: true });
  return { subject, html, text };
}

const styles = {
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
  hero: {
    paddingBottom: '8px',
  } as const,
  heroTitle: {
    color: '#111827',
    fontSize: '24px',
    fontWeight: 600,
    lineHeight: '32px',
    margin: '0 0 12px',
  } as const,
  greeting: {
    color: '#111827',
    fontSize: '16px',
    margin: '0 0 8px',
  } as const,
  intro: {
    color: '#374151',
    fontSize: '14px',
    lineHeight: '20px',
    margin: '0 0 20px',
  } as const,
  kpiBox: {
    backgroundColor: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    padding: '16px',
    margin: '0 0 24px',
  } as const,
  sectionTitle: {
    color: '#111827',
    fontSize: '16px',
    fontWeight: 600,
    margin: '0 0 16px',
  } as const,
  kpiGrid: {
    marginBottom: '16px',
  } as const,
  kpiColumn: {
    textAlign: 'center' as const,
    padding: '8px',
  } as const,
  kpiValue: {
    color: '#111827',
    fontSize: '22px',
    fontWeight: 700,
    margin: '0 0 4px',
  } as const,
  kpiValueSuccess: {
    color: '#059669',
    fontSize: '22px',
    fontWeight: 700,
    margin: '0 0 4px',
  } as const,
  kpiValueWarning: {
    color: '#dc2626',
    fontSize: '22px',
    fontWeight: 700,
    margin: '0 0 4px',
  } as const,
  kpiLabel: {
    color: '#6b7280',
    fontSize: '11px',
    fontWeight: 600,
    margin: 0,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  } as const,
  kpiDivider: {
    borderColor: '#e5e7eb',
    margin: '8px 0 12px',
  } as const,
  detailsTable: {
    borderCollapse: 'collapse' as const,
    width: '100%',
  } as const,
  detailLabel: {
    color: '#6b7280',
    fontSize: '12px',
    fontWeight: 600,
    padding: '6px 12px 6px 0',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    width: '50%',
    verticalAlign: 'top' as const,
  } as const,
  detailValue: {
    color: '#111827',
    fontSize: '14px',
    fontWeight: 500,
    padding: '6px 0',
    verticalAlign: 'top' as const,
  } as const,
  ctaWrap: {
    margin: '24px 0 8px',
    textAlign: 'center' as const,
  } as const,
  ctaPrimary: {
    backgroundColor: '#111827',
    borderRadius: '6px',
    color: '#ffffff',
    display: 'inline-block',
    fontSize: '14px',
    fontWeight: 600,
    padding: '12px 20px',
    textDecoration: 'none',
  } as const,
  ctaSecondaryWrap: {
    margin: '0 0 16px',
    textAlign: 'center' as const,
  } as const,
  ctaSecondaryLink: {
    color: '#2563eb',
    fontSize: '14px',
    textDecoration: 'underline',
  } as const,
  hr: {
    borderColor: '#e5e7eb',
    margin: '24px 0',
  } as const,
  footer: {
    color: '#6b7280',
    fontSize: '12px',
    lineHeight: '18px',
    margin: '4px 0',
  } as const,
  footerLink: {
    color: '#2563eb',
    textDecoration: 'underline',
  } as const,
} as const;

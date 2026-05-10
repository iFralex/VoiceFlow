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

export type WeeklySummaryLocale = 'it' | 'en';

export type WeeklySummaryTopCampaign = {
  id: string;
  name: string;
  appointments: number;
  calls: number;
  qualifiedLeads: number;
};

export type WeeklySummaryAlert = {
  type: 'warning' | 'error';
  campaignName: string;
  failed: number;
  total: number;
};

export type WeeklySummaryEmailProps = {
  locale: WeeklySummaryLocale;
  recipientName?: string;
  orgName: string;
  weekStart: Date;
  weekEnd: Date;
  totalCalls: number;
  completedCalls: number;
  failedCalls: number;
  qualifiedLeads: number;
  appointments: number;
  topCampaigns: WeeklySummaryTopCampaign[];
  alerts: WeeklySummaryAlert[];
  dashboardUrl: string;
  preferencesUrl: string;
  appUrl?: string;
};

type Strings = {
  preview: (range: string) => string;
  subject: (range: string) => string;
  greeting: (name: string) => string;
  intro: (range: string) => string;
  kpiHeading: string;
  kpiCalls: string;
  kpiCompleted: string;
  kpiFailed: string;
  kpiLeads: string;
  kpiAppointments: string;
  topCampaignsHeading: string;
  topCampaignsCampaign: string;
  topCampaignsAppointments: string;
  topCampaignsCalls: string;
  topCampaignsLeads: string;
  alertsHeading: string;
  noAlerts: string;
  alertHighFailureRate: (name: string, failed: number, total: number) => string;
  ctaDashboard: string;
  footerSent: (org: string) => string;
  footerPreferences: string;
};

const STRINGS: Record<WeeklySummaryLocale, Strings> = {
  it: {
    preview: (range) => `Riepilogo settimanale — ${range}`,
    subject: (range) => `Il tuo riepilogo settimanale — ${range}`,
    greeting: (name) => `Ciao ${name},`,
    intro: (range) =>
      `Ecco il riepilogo delle attività della settimana dal ${range}.`,
    kpiHeading: 'KPI settimanali',
    kpiCalls: 'Chiamate totali',
    kpiCompleted: 'Completate',
    kpiFailed: 'Fallite',
    kpiLeads: 'Lead qualificati',
    kpiAppointments: 'Appuntamenti',
    topCampaignsHeading: 'Top campagne (per appuntamenti)',
    topCampaignsCampaign: 'Campagna',
    topCampaignsAppointments: 'Appuntamenti',
    topCampaignsCalls: 'Chiamate',
    topCampaignsLeads: 'Lead',
    alertsHeading: 'Avvisi e problemi',
    noAlerts: 'Nessun avviso per questa settimana.',
    alertHighFailureRate: (name, failed, total) =>
      `Campagna "${name}": tasso di fallimento elevato (${failed}/${total} chiamate fallite)`,
    ctaDashboard: 'Vai alla dashboard',
    footerSent: (org) => `Hai ricevuto questa email perché sei membro di ${org}.`,
    footerPreferences: 'Gestisci le preferenze di notifica',
  },
  en: {
    preview: (range) => `Weekly summary — ${range}`,
    subject: (range) => `Your weekly summary — ${range}`,
    greeting: (name) => `Hi ${name},`,
    intro: (range) =>
      `Here is the summary of activities for the week of ${range}.`,
    kpiHeading: 'Weekly KPIs',
    kpiCalls: 'Total calls',
    kpiCompleted: 'Completed',
    kpiFailed: 'Failed',
    kpiLeads: 'Qualified leads',
    kpiAppointments: 'Appointments',
    topCampaignsHeading: 'Top campaigns (by appointments)',
    topCampaignsCampaign: 'Campaign',
    topCampaignsAppointments: 'Appointments',
    topCampaignsCalls: 'Calls',
    topCampaignsLeads: 'Leads',
    alertsHeading: 'Alerts & issues',
    noAlerts: 'No alerts this week.',
    alertHighFailureRate: (name, failed, total) =>
      `Campaign "${name}": high failure rate (${failed}/${total} calls failed)`,
    ctaDashboard: 'Go to dashboard',
    footerSent: (org) => `You received this email because you are a member of ${org}.`,
    footerPreferences: 'Manage notification preferences',
  },
};

function formatDateRange(weekStart: Date, weekEnd: Date, locale: WeeklySummaryLocale): string {
  const fmt = new Intl.DateTimeFormat(locale === 'it' ? 'it-IT' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Rome',
  });
  const fmtNoYear = new Intl.DateTimeFormat(locale === 'it' ? 'it-IT' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/Rome',
  });
  const startYear = new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'Europe/Rome' })
    .format(weekStart);
  const endYear = new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'Europe/Rome' })
    .format(weekEnd);
  if (startYear === endYear) {
    return `${fmtNoYear.format(weekStart)} – ${fmt.format(weekEnd)}`;
  }
  return `${fmt.format(weekStart)} – ${fmt.format(weekEnd)}`;
}

export function WeeklySummaryEmail(props: WeeklySummaryEmailProps) {
  const t = STRINGS[props.locale];
  const dateRange = formatDateRange(props.weekStart, props.weekEnd, props.locale);
  const previewText = t.preview(dateRange);
  const greetingName = props.recipientName?.trim() || props.orgName;

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
              {t.preview(dateRange)}
            </Heading>
            <Text style={styles.greeting}>{t.greeting(greetingName)}</Text>
            <Text style={styles.intro}>{t.intro(dateRange)}</Text>
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
              <Column style={styles.kpiColumn} />
            </Row>
          </Section>

          {props.topCampaigns.length > 0 && (
            <Section style={styles.tableBox}>
              <Heading as="h2" style={styles.sectionTitle}>
                {t.topCampaignsHeading}
              </Heading>
              <table cellPadding={0} cellSpacing={0} style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>{t.topCampaignsCampaign}</th>
                    <th style={{ ...styles.th, ...styles.thRight }}>{t.topCampaignsAppointments}</th>
                    <th style={{ ...styles.th, ...styles.thRight }}>{t.topCampaignsCalls}</th>
                    <th style={{ ...styles.th, ...styles.thRight }}>{t.topCampaignsLeads}</th>
                  </tr>
                </thead>
                <tbody>
                  {props.topCampaigns.map((c, i) => (
                    <tr key={c.id} style={i % 2 === 1 ? styles.trAlt : undefined}>
                      <td style={styles.td}>{c.name}</td>
                      <td style={{ ...styles.td, ...styles.tdRight, ...styles.tdSuccess }}>
                        {String(c.appointments)}
                      </td>
                      <td style={{ ...styles.td, ...styles.tdRight }}>{String(c.calls)}</td>
                      <td style={{ ...styles.td, ...styles.tdRight }}>{String(c.qualifiedLeads)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          <Section style={styles.alertBox}>
            <Heading as="h2" style={styles.sectionTitle}>
              {t.alertsHeading}
            </Heading>
            {props.alerts.length === 0 ? (
              <Text style={styles.noAlerts}>{t.noAlerts}</Text>
            ) : (
              props.alerts.map((alert, i) => (
                <Text
                  key={i}
                  style={alert.type === 'error' ? styles.alertError : styles.alertWarning}
                >
                  {alert.type === 'error' ? '⚠ ' : '• '}
                  {t.alertHighFailureRate(alert.campaignName, alert.failed, alert.total)}
                </Text>
              ))
            )}
          </Section>

          <Section style={styles.ctaWrap}>
            <Button href={props.dashboardUrl} style={styles.ctaPrimary}>
              {t.ctaDashboard}
            </Button>
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

export type RenderedWeeklySummary = {
  subject: string;
  html: string;
  text: string;
};

export async function renderWeeklySummaryEmail(
  props: WeeklySummaryEmailProps,
): Promise<RenderedWeeklySummary> {
  const t = STRINGS[props.locale];
  const dateRange = formatDateRange(props.weekStart, props.weekEnd, props.locale);
  const subject = t.subject(dateRange);
  const html = await render(<WeeklySummaryEmail {...props} />);
  const text = await render(<WeeklySummaryEmail {...props} />, { plainText: true });
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
  tableBox: {
    margin: '0 0 24px',
  } as const,
  alertBox: {
    backgroundColor: '#fffbeb',
    border: '1px solid #fde68a',
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
  table: {
    borderCollapse: 'collapse' as const,
    width: '100%',
  } as const,
  th: {
    backgroundColor: '#f9fafb',
    borderBottom: '2px solid #e5e7eb',
    color: '#6b7280',
    fontSize: '11px',
    fontWeight: 600,
    padding: '8px 12px',
    textAlign: 'left' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  } as const,
  thRight: {
    textAlign: 'right' as const,
  } as const,
  td: {
    borderBottom: '1px solid #f3f4f6',
    color: '#111827',
    fontSize: '13px',
    padding: '10px 12px',
    verticalAlign: 'middle' as const,
  } as const,
  tdRight: {
    textAlign: 'right' as const,
  } as const,
  tdSuccess: {
    color: '#059669',
    fontWeight: 600,
  } as const,
  trAlt: {
    backgroundColor: '#f9fafb',
  } as const,
  noAlerts: {
    color: '#6b7280',
    fontSize: '13px',
    margin: 0,
  } as const,
  alertWarning: {
    color: '#92400e',
    fontSize: '13px',
    lineHeight: '20px',
    margin: '0 0 6px',
  } as const,
  alertError: {
    color: '#991b1b',
    fontSize: '13px',
    fontWeight: 600,
    lineHeight: '20px',
    margin: '0 0 6px',
  } as const,
  ctaWrap: {
    margin: '24px 0',
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

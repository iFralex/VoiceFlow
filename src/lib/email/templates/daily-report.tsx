/**
 * Daily report email template (plan 12 task 8).
 *
 * Rendered server-side with `@react-email/components` and dispatched via the
 * `sendEmail` adapter. The template runs outside the Next.js request lifecycle
 * (cron + Inngest), so next-intl is unavailable; locale strings are bundled
 * inline below and selected by the `locale` prop. Italian is the default;
 * English is the fallback for `users.locale === 'en'` members.
 */

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

export type DailyReportLocale = 'it' | 'en';

export type DailyReportTopCampaign = {
  id: string;
  name: string;
  completed: number;
  total: number;
  appointmentsBooked: number;
};

export type DailyReportAppointment = {
  id: string;
  contactName: string;
  scheduledAt: Date;
  campaignName: string;
};

export type DailyReportEmailProps = {
  locale: DailyReportLocale;
  recipientName?: string;
  orgName: string;
  reportDate: Date;
  dashboardUrl: string;
  preferencesUrl: string;
  kpis: {
    callsCompleted: number;
    qualifiedLeads: number;
    appointmentsBooked: number;
  };
  topCampaigns: DailyReportTopCampaign[];
  recentAppointments: DailyReportAppointment[];
};

type Strings = {
  preview: (date: string, total: number) => string;
  subject: (date: string, total: number) => string;
  greeting: (name: string) => string;
  intro: (date: string, org: string) => string;
  kpisHeading: string;
  kpiCallsCompleted: string;
  kpiQualifiedLeads: string;
  kpiAppointments: string;
  topCampaignsHeading: string;
  topCampaignsEmpty: string;
  campaignColName: string;
  campaignColCompleted: string;
  campaignColAppointments: string;
  appointmentsHeading: string;
  appointmentsEmpty: string;
  appointmentColContact: string;
  appointmentColCampaign: string;
  appointmentColScheduled: string;
  ctaDashboard: string;
  footerSent: (org: string) => string;
  footerPreferences: string;
};

const STRINGS: Record<DailyReportLocale, Strings> = {
  it: {
    preview: (date, total) => `Report giornaliero — ${date} — ${total} chiamate`,
    subject: (date, total) => `Report giornaliero — ${date} — ${total} chiamate`,
    greeting: (name) => `Ciao ${name},`,
    intro: (date, org) =>
      `Ecco il riepilogo delle attività di ${org} del ${date}.`,
    kpisHeading: 'Riepilogo della giornata',
    kpiCallsCompleted: 'Chiamate completate',
    kpiQualifiedLeads: 'Lead qualificati',
    kpiAppointments: 'Appuntamenti fissati',
    topCampaignsHeading: 'Campagne in evidenza',
    topCampaignsEmpty: 'Nessuna campagna attiva.',
    campaignColName: 'Campagna',
    campaignColCompleted: 'Completate / Totali',
    campaignColAppointments: 'Appuntamenti',
    appointmentsHeading: 'Appuntamenti fissati ieri',
    appointmentsEmpty: 'Nessun appuntamento fissato.',
    appointmentColContact: 'Contatto',
    appointmentColCampaign: 'Campagna',
    appointmentColScheduled: 'In programma',
    ctaDashboard: 'Vai alla dashboard',
    footerSent: (org) => `Hai ricevuto questa email perché sei membro di ${org}.`,
    footerPreferences: 'Gestisci le preferenze di notifica',
  },
  en: {
    preview: (date, total) => `Daily report — ${date} — ${total} calls`,
    subject: (date, total) => `Daily report — ${date} — ${total} calls`,
    greeting: (name) => `Hi ${name},`,
    intro: (date, org) => `Here is the activity recap for ${org} on ${date}.`,
    kpisHeading: "Yesterday's summary",
    kpiCallsCompleted: 'Calls completed',
    kpiQualifiedLeads: 'Qualified leads',
    kpiAppointments: 'Appointments booked',
    topCampaignsHeading: 'Top campaigns',
    topCampaignsEmpty: 'No active campaigns.',
    campaignColName: 'Campaign',
    campaignColCompleted: 'Completed / Total',
    campaignColAppointments: 'Appointments',
    appointmentsHeading: 'Appointments booked yesterday',
    appointmentsEmpty: 'No appointments booked.',
    appointmentColContact: 'Contact',
    appointmentColCampaign: 'Campaign',
    appointmentColScheduled: 'Scheduled',
    ctaDashboard: 'Open dashboard',
    footerSent: (org) => `You received this email because you are a member of ${org}.`,
    footerPreferences: 'Manage notification preferences',
  },
};

const MAX_CAMPAIGNS = 5;
const MAX_APPOINTMENTS = 10;

export function DailyReportEmail(props: DailyReportEmailProps) {
  const t = STRINGS[props.locale];
  const dateLabel = formatDate(props.reportDate, props.locale);
  const totalCalls = props.kpis.callsCompleted;
  const previewText = t.preview(dateLabel, totalCalls);
  const greetingName = props.recipientName?.trim() || props.orgName;
  const campaigns = props.topCampaigns.slice(0, MAX_CAMPAIGNS);
  const appointments = props.recentAppointments.slice(0, MAX_APPOINTMENTS);

  return (
    <Html lang={props.locale}>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.hero}>
            <Heading as="h1" style={styles.heroTitle}>
              {t.kpisHeading}
            </Heading>
            <Text style={styles.heroDate}>{dateLabel}</Text>
            <Text style={styles.greeting}>{t.greeting(greetingName)}</Text>
            <Text style={styles.intro}>{t.intro(dateLabel, props.orgName)}</Text>

            <Row style={styles.kpiRow}>
              <Column style={styles.kpiCell}>
                <Text style={styles.kpiValue}>
                  {formatNumber(props.kpis.callsCompleted, props.locale)}
                </Text>
                <Text style={styles.kpiLabel}>{t.kpiCallsCompleted}</Text>
              </Column>
              <Column style={styles.kpiCell}>
                <Text style={styles.kpiValue}>
                  {formatNumber(props.kpis.qualifiedLeads, props.locale)}
                </Text>
                <Text style={styles.kpiLabel}>{t.kpiQualifiedLeads}</Text>
              </Column>
              <Column style={styles.kpiCell}>
                <Text style={styles.kpiValue}>
                  {formatNumber(props.kpis.appointmentsBooked, props.locale)}
                </Text>
                <Text style={styles.kpiLabel}>{t.kpiAppointments}</Text>
              </Column>
            </Row>
          </Section>

          <Hr style={styles.hr} />

          <Section>
            <Heading as="h2" style={styles.sectionTitle}>
              {t.topCampaignsHeading}
            </Heading>
            {campaigns.length === 0 ? (
              <Text style={styles.muted}>{t.topCampaignsEmpty}</Text>
            ) : (
              <table cellPadding={0} cellSpacing={0} style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>{t.campaignColName}</th>
                    <th style={styles.th}>{t.campaignColCompleted}</th>
                    <th style={styles.th}>{t.campaignColAppointments}</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => (
                    <tr key={c.id}>
                      <td style={styles.td}>{c.name}</td>
                      <td style={styles.td}>
                        {formatNumber(c.completed, props.locale)} /{' '}
                        {formatNumber(c.total, props.locale)}
                      </td>
                      <td style={styles.td}>
                        {formatNumber(c.appointmentsBooked, props.locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Hr style={styles.hr} />

          <Section>
            <Heading as="h2" style={styles.sectionTitle}>
              {t.appointmentsHeading}
            </Heading>
            {appointments.length === 0 ? (
              <Text style={styles.muted}>{t.appointmentsEmpty}</Text>
            ) : (
              <table cellPadding={0} cellSpacing={0} style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>{t.appointmentColContact}</th>
                    <th style={styles.th}>{t.appointmentColCampaign}</th>
                    <th style={styles.th}>{t.appointmentColScheduled}</th>
                  </tr>
                </thead>
                <tbody>
                  {appointments.map((a) => (
                    <tr key={a.id}>
                      <td style={styles.td}>{a.contactName}</td>
                      <td style={styles.td}>{a.campaignName}</td>
                      <td style={styles.td}>
                        {formatDateTime(a.scheduledAt, props.locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section style={styles.ctaWrap}>
            <Button href={props.dashboardUrl} style={styles.cta}>
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

export type RenderedDailyReport = {
  subject: string;
  html: string;
  text: string;
};

export async function renderDailyReportEmail(
  props: DailyReportEmailProps,
): Promise<RenderedDailyReport> {
  const t = STRINGS[props.locale];
  const dateLabel = formatDate(props.reportDate, props.locale);
  const subject = t.subject(dateLabel, props.kpis.callsCompleted);
  const html = await render(<DailyReportEmail {...props} />);
  const text = await render(<DailyReportEmail {...props} />, { plainText: true });
  return { subject, html, text };
}

function formatDate(d: Date, locale: DailyReportLocale): string {
  return new Intl.DateTimeFormat(locale === 'it' ? 'it-IT' : 'en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

function formatDateTime(d: Date, locale: DailyReportLocale): string {
  return new Intl.DateTimeFormat(locale === 'it' ? 'it-IT' : 'en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function formatNumber(n: number, locale: DailyReportLocale): string {
  return new Intl.NumberFormat(locale === 'it' ? 'it-IT' : 'en-GB').format(n);
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
  hero: {
    paddingBottom: '8px',
  } as const,
  heroTitle: {
    color: '#111827',
    fontSize: '24px',
    fontWeight: 600,
    lineHeight: '32px',
    margin: 0,
  } as const,
  heroDate: {
    color: '#6b7280',
    fontSize: '14px',
    margin: '4px 0 16px',
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
    margin: '0 0 24px',
  } as const,
  kpiRow: {
    width: '100%',
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
  hr: {
    borderColor: '#e5e7eb',
    margin: '24px 0',
  } as const,
  sectionTitle: {
    color: '#111827',
    fontSize: '16px',
    fontWeight: 600,
    margin: '0 0 12px',
  } as const,
  muted: {
    color: '#6b7280',
    fontSize: '14px',
    margin: 0,
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
  cta: {
    backgroundColor: '#111827',
    borderRadius: '6px',
    color: '#ffffff',
    display: 'inline-block',
    fontSize: '14px',
    fontWeight: 600,
    padding: '12px 20px',
    textDecoration: 'none',
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

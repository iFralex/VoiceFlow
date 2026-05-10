import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  render,
  Section,
  Text,
} from '@react-email/components';

export type AppointmentBookedLocale = 'it' | 'en';

export type AppointmentBookedEmailProps = {
  locale: AppointmentBookedLocale;
  recipientName?: string;
  orgName: string;
  contactName: string;
  scheduledAt: Date;
  serviceType?: string;
  campaignName: string;
  transcriptSnippet?: string;
  callDetailUrl: string;
  preferencesUrl: string;
  appUrl?: string;
};

type Strings = {
  preview: (contact: string, date: string) => string;
  subject: (contact: string, date: string) => string;
  greeting: (name: string) => string;
  intro: (contact: string) => string;
  heroDate: string;
  heroService: string;
  heroServiceFallback: string;
  campaignLabel: string;
  transcriptHeading: string;
  transcriptPrefix: string;
  ctaCall: string;
  footerSent: (org: string) => string;
  footerPreferences: string;
  footerCallDetail: string;
};

const STRINGS: Record<AppointmentBookedLocale, Strings> = {
  it: {
    preview: (contact, date) => `Appuntamento fissato — ${contact} il ${date}`,
    subject: (contact, date) => `Appuntamento fissato — ${contact} il ${date}`,
    greeting: (name) => `Ciao ${name},`,
    intro: (contact) =>
      `L'AI ha fissato un nuovo appuntamento con ${contact}. Ecco i dettagli.`,
    heroDate: 'Data e ora',
    heroService: 'Tipo di servizio',
    heroServiceFallback: 'Non specificato',
    campaignLabel: 'Campagna di origine',
    transcriptHeading: 'Estratto dalla chiamata',
    transcriptPrefix: "L'AI ha fissato l'appuntamento dicendo:",
    ctaCall: 'Apri scheda chiamata',
    footerSent: (org) => `Hai ricevuto questa email perché sei membro di ${org}.`,
    footerPreferences: 'Gestisci le preferenze di notifica',
    footerCallDetail: 'Vedi dettaglio chiamata',
  },
  en: {
    preview: (contact, date) => `Appointment booked — ${contact} on ${date}`,
    subject: (contact, date) => `Appointment booked — ${contact} on ${date}`,
    greeting: (name) => `Hi ${name},`,
    intro: (contact) =>
      `The AI has booked a new appointment with ${contact}. Here are the details.`,
    heroDate: 'Date and time',
    heroService: 'Service type',
    heroServiceFallback: 'Not specified',
    campaignLabel: 'Source campaign',
    transcriptHeading: 'Call excerpt',
    transcriptPrefix: 'The AI booked the appointment by saying:',
    ctaCall: 'Open call record',
    footerSent: (org) => `You received this email because you are a member of ${org}.`,
    footerPreferences: 'Manage notification preferences',
    footerCallDetail: 'View call detail',
  },
};

export function AppointmentBookedEmail(props: AppointmentBookedEmailProps) {
  const t = STRINGS[props.locale];
  const dateLabel = formatDateTime(props.scheduledAt, props.locale);
  const previewText = t.preview(props.contactName, dateLabel);
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
              {props.contactName}
            </Heading>
            <Text style={styles.greeting}>{t.greeting(greetingName)}</Text>
            <Text style={styles.intro}>{t.intro(props.contactName)}</Text>
          </Section>

          <Section style={styles.detailsBox}>
            <table cellPadding={0} cellSpacing={0} style={styles.detailsTable}>
              <tbody>
                <tr>
                  <td style={styles.detailLabel}>{t.heroDate}</td>
                  <td style={styles.detailValue}>{dateLabel}</td>
                </tr>
                <tr>
                  <td style={styles.detailLabel}>{t.heroService}</td>
                  <td style={styles.detailValue}>
                    {props.serviceType?.trim() || t.heroServiceFallback}
                  </td>
                </tr>
                <tr>
                  <td style={styles.detailLabel}>{t.campaignLabel}</td>
                  <td style={styles.detailValue}>{props.campaignName}</td>
                </tr>
              </tbody>
            </table>
          </Section>

          {props.transcriptSnippet && (
            <>
              <Hr style={styles.hr} />
              <Section>
                <Heading as="h2" style={styles.sectionTitle}>
                  {t.transcriptHeading}
                </Heading>
                <Text style={styles.transcriptPrefix}>{t.transcriptPrefix}</Text>
                <Text style={styles.transcriptQuote}>
                  &ldquo;{props.transcriptSnippet}&rdquo;
                </Text>
              </Section>
            </>
          )}

          <Section style={styles.ctaWrap}>
            <Button href={props.callDetailUrl} style={styles.cta}>
              {t.ctaCall}
            </Button>
          </Section>

          <Hr style={styles.hr} />

          <Section>
            <Text style={styles.footer}>{t.footerSent(props.orgName)}</Text>
            <Text style={styles.footer}>
              <Link href={props.callDetailUrl} style={styles.footerLink}>
                {t.footerCallDetail}
              </Link>
            </Text>
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

export type RenderedAppointmentBooked = {
  subject: string;
  html: string;
  text: string;
};

export async function renderAppointmentBookedEmail(
  props: AppointmentBookedEmailProps,
): Promise<RenderedAppointmentBooked> {
  const t = STRINGS[props.locale];
  const dateLabel = formatDateTime(props.scheduledAt, props.locale);
  const subject = t.subject(props.contactName, dateLabel);
  const html = await render(<AppointmentBookedEmail {...props} />);
  const text = await render(<AppointmentBookedEmail {...props} />, { plainText: true });
  return { subject, html, text };
}

function formatDateTime(d: Date, locale: AppointmentBookedLocale): string {
  return new Intl.DateTimeFormat(locale === 'it' ? 'it-IT' : 'en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
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
  detailsBox: {
    backgroundColor: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    padding: '16px',
    margin: '0 0 24px',
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
    width: '40%',
    verticalAlign: 'top' as const,
  } as const,
  detailValue: {
    color: '#111827',
    fontSize: '14px',
    fontWeight: 500,
    padding: '6px 0',
    verticalAlign: 'top' as const,
  } as const,
  hr: {
    borderColor: '#e5e7eb',
    margin: '24px 0',
  } as const,
  sectionTitle: {
    color: '#111827',
    fontSize: '16px',
    fontWeight: 600,
    margin: '0 0 8px',
  } as const,
  transcriptPrefix: {
    color: '#6b7280',
    fontSize: '13px',
    margin: '0 0 8px',
  } as const,
  transcriptQuote: {
    backgroundColor: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderLeft: '3px solid #2563eb',
    borderRadius: '4px',
    color: '#111827',
    fontSize: '14px',
    lineHeight: '22px',
    margin: 0,
    padding: '12px 16px',
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

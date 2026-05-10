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

export type QualifiedLeadLocale = 'it' | 'en';

export type QualifiedLeadEmailProps = {
  locale: QualifiedLeadLocale;
  recipientName?: string;
  orgName: string;
  contactName: string;
  contactPhone: string;
  contactEmail?: string;
  aiSummary?: string;
  recommendedNextAction?: string;
  campaignName: string;
  callDetailUrl: string;
  preferencesUrl: string;
  appUrl?: string;
};

type Strings = {
  preview: (contact: string) => string;
  subject: (contact: string) => string;
  greeting: (name: string) => string;
  intro: (contact: string) => string;
  contactDetailsHeading: string;
  contactPhone: string;
  contactEmail: string;
  contactEmailFallback: string;
  campaignLabel: string;
  aiSummaryHeading: string;
  nextActionHeading: string;
  ctaCall: string;
  footerSent: (org: string) => string;
  footerPreferences: string;
  footerCallDetail: string;
};

const STRINGS: Record<QualifiedLeadLocale, Strings> = {
  it: {
    preview: (contact) => `Nuovo lead qualificato — ${contact}`,
    subject: (contact) => `Nuovo lead qualificato — ${contact}`,
    greeting: (name) => `Ciao ${name},`,
    intro: (contact) =>
      `L'AI ha identificato ${contact} come lead qualificato. Ti consigliamo di ricontattarlo al più presto.`,
    contactDetailsHeading: 'Dettagli contatto',
    contactPhone: 'Telefono',
    contactEmail: 'Email',
    contactEmailFallback: 'Non disponibile',
    campaignLabel: 'Campagna di origine',
    aiSummaryHeading: 'Sintesi AI',
    nextActionHeading: 'Prossimo passo consigliato',
    ctaCall: 'Richiama il contatto',
    footerSent: (org) => `Hai ricevuto questa email perché sei membro di ${org}.`,
    footerPreferences: 'Gestisci le preferenze di notifica',
    footerCallDetail: 'Vedi dettaglio chiamata',
  },
  en: {
    preview: (contact) => `New qualified lead — ${contact}`,
    subject: (contact) => `New qualified lead — ${contact}`,
    greeting: (name) => `Hi ${name},`,
    intro: (contact) =>
      `The AI has identified ${contact} as a qualified lead. We recommend following up as soon as possible.`,
    contactDetailsHeading: 'Contact details',
    contactPhone: 'Phone',
    contactEmail: 'Email',
    contactEmailFallback: 'Not available',
    campaignLabel: 'Source campaign',
    aiSummaryHeading: 'AI Summary',
    nextActionHeading: 'Recommended next action',
    ctaCall: 'Call the contact',
    footerSent: (org) => `You received this email because you are a member of ${org}.`,
    footerPreferences: 'Manage notification preferences',
    footerCallDetail: 'View call detail',
  },
};

export function QualifiedLeadEmail(props: QualifiedLeadEmailProps) {
  const t = STRINGS[props.locale];
  const previewText = t.preview(props.contactName);
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
            <Heading as="h2" style={styles.sectionTitle}>
              {t.contactDetailsHeading}
            </Heading>
            <table cellPadding={0} cellSpacing={0} style={styles.detailsTable}>
              <tbody>
                <tr>
                  <td style={styles.detailLabel}>{t.contactPhone}</td>
                  <td style={styles.detailValue}>
                    <Link href={`tel:${props.contactPhone}`} style={styles.phoneLink}>
                      {props.contactPhone}
                    </Link>
                  </td>
                </tr>
                <tr>
                  <td style={styles.detailLabel}>{t.contactEmail}</td>
                  <td style={styles.detailValue}>
                    {props.contactEmail?.trim() ? (
                      <Link href={`mailto:${props.contactEmail}`} style={styles.emailLink}>
                        {props.contactEmail}
                      </Link>
                    ) : (
                      t.contactEmailFallback
                    )}
                  </td>
                </tr>
                <tr>
                  <td style={styles.detailLabel}>{t.campaignLabel}</td>
                  <td style={styles.detailValue}>{props.campaignName}</td>
                </tr>
              </tbody>
            </table>
          </Section>

          {props.aiSummary && (
            <>
              <Hr style={styles.hr} />
              <Section>
                <Heading as="h2" style={styles.sectionTitle}>
                  {t.aiSummaryHeading}
                </Heading>
                <Text style={styles.summaryText}>{props.aiSummary}</Text>
              </Section>
            </>
          )}

          {props.recommendedNextAction && (
            <>
              <Hr style={styles.hr} />
              <Section>
                <Heading as="h2" style={styles.sectionTitle}>
                  {t.nextActionHeading}
                </Heading>
                <Text style={styles.nextActionText}>{props.recommendedNextAction}</Text>
              </Section>
            </>
          )}

          <Section style={styles.ctaWrap}>
            <Button href={`tel:${props.contactPhone}`} style={styles.cta}>
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

export type RenderedQualifiedLead = {
  subject: string;
  html: string;
  text: string;
};

export async function renderQualifiedLeadEmail(
  props: QualifiedLeadEmailProps,
): Promise<RenderedQualifiedLead> {
  const t = STRINGS[props.locale];
  const subject = t.subject(props.contactName);
  const html = await render(<QualifiedLeadEmail {...props} />);
  const text = await render(<QualifiedLeadEmail {...props} />, { plainText: true });
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
  phoneLink: {
    color: '#111827',
    textDecoration: 'none',
  } as const,
  emailLink: {
    color: '#2563eb',
    textDecoration: 'underline',
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
  summaryText: {
    backgroundColor: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderLeft: '3px solid #10b981',
    borderRadius: '4px',
    color: '#111827',
    fontSize: '14px',
    lineHeight: '22px',
    margin: 0,
    padding: '12px 16px',
  } as const,
  nextActionText: {
    backgroundColor: '#eff6ff',
    border: '1px solid #bfdbfe',
    borderLeft: '3px solid #2563eb',
    borderRadius: '4px',
    color: '#1e40af',
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

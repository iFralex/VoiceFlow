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

export type LowBalanceLocale = 'it' | 'en';

export type LowBalanceEmailProps = {
  locale: LowBalanceLocale;
  recipientName?: string;
  orgName: string;
  remainingMinutes: number;
  avgDailyMinutes: number;
  estimatedDaysRemaining: number;
  topupUrl: string;
  preferencesUrl: string;
  appUrl?: string;
};

type Strings = {
  preview: (minutes: number) => string;
  subject: (minutes: number) => string;
  greeting: (name: string) => string;
  intro: (minutes: number) => string;
  statsHeading: string;
  remainingLabel: string;
  remainingValue: (n: number) => string;
  avgDailyLabel: string;
  avgDailyValue: (n: number) => string;
  estimatedLabel: string;
  estimatedValue: (n: number) => string;
  estimatedToday: string;
  ctaTopup: string;
  footerSent: (org: string) => string;
  footerPreferences: string;
};

const STRINGS: Record<LowBalanceLocale, Strings> = {
  it: {
    preview: (n) => `Credito basso — restano ${n} minuti`,
    subject: (n) => `Credito basso — restano ${n} minuti`,
    greeting: (name) => `Ciao ${name},`,
    intro: (n) =>
      `Il tuo credito VoiceFlow sta per esaurirsi. Restano solo ${n} minuti disponibili. Ricarica ora per evitare interruzioni delle campagne.`,
    statsHeading: 'Riepilogo utilizzo',
    remainingLabel: 'Minuti rimanenti',
    remainingValue: (n) => `${n} min`,
    avgDailyLabel: 'Consumo medio (ultimi 7 giorni)',
    avgDailyValue: (n) => `${n} min/giorno`,
    estimatedLabel: 'Durata stimata',
    estimatedValue: (n) => (n === 1 ? `${n} giorno` : `${n} giorni`),
    estimatedToday: 'Meno di un giorno',
    ctaTopup: 'Ricarica ora',
    footerSent: (org) => `Hai ricevuto questa email perché sei membro di ${org}.`,
    footerPreferences: 'Gestisci le preferenze di notifica',
  },
  en: {
    preview: (n) => `Low balance — ${n} minutes remaining`,
    subject: (n) => `Low balance — ${n} minutes remaining`,
    greeting: (name) => `Hi ${name},`,
    intro: (n) =>
      `Your VoiceFlow credit is running low. Only ${n} minutes remain. Top up now to avoid campaign interruptions.`,
    statsHeading: 'Usage summary',
    remainingLabel: 'Minutes remaining',
    remainingValue: (n) => `${n} min`,
    avgDailyLabel: 'Average daily usage (last 7 days)',
    avgDailyValue: (n) => `${n} min/day`,
    estimatedLabel: 'Estimated runway',
    estimatedValue: (n) => (n === 1 ? `${n} day` : `${n} days`),
    estimatedToday: 'Less than a day',
    ctaTopup: 'Top up now',
    footerSent: (org) => `You received this email because you are a member of ${org}.`,
    footerPreferences: 'Manage notification preferences',
  },
};

export function LowBalanceEmail(props: LowBalanceEmailProps) {
  const t = STRINGS[props.locale];
  const previewText = t.preview(props.remainingMinutes);
  const greetingName = props.recipientName?.trim() || props.orgName;
  const daysText =
    props.estimatedDaysRemaining < 1
      ? t.estimatedToday
      : t.estimatedValue(props.estimatedDaysRemaining);

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

          <Section style={styles.alertBanner}>
            <Text style={styles.alertText}>⚠ {t.preview(props.remainingMinutes)}</Text>
          </Section>

          <Section style={styles.hero}>
            <Text style={styles.greeting}>{t.greeting(greetingName)}</Text>
            <Text style={styles.intro}>{t.intro(props.remainingMinutes)}</Text>
          </Section>

          <Section style={styles.detailsBox}>
            <Heading as="h2" style={styles.sectionTitle}>
              {t.statsHeading}
            </Heading>
            <table cellPadding={0} cellSpacing={0} style={styles.detailsTable}>
              <tbody>
                <tr>
                  <td style={styles.detailLabel}>{t.remainingLabel}</td>
                  <td style={styles.detailValueHighlight}>
                    {t.remainingValue(props.remainingMinutes)}
                  </td>
                </tr>
                <tr>
                  <td style={styles.detailLabel}>{t.avgDailyLabel}</td>
                  <td style={styles.detailValue}>{t.avgDailyValue(props.avgDailyMinutes)}</td>
                </tr>
                <tr>
                  <td style={styles.detailLabel}>{t.estimatedLabel}</td>
                  <td style={styles.detailValue}>{daysText}</td>
                </tr>
              </tbody>
            </table>
          </Section>

          <Section style={styles.ctaWrap}>
            <Button href={props.topupUrl} style={styles.cta}>
              {t.ctaTopup}
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

export type RenderedLowBalance = {
  subject: string;
  html: string;
  text: string;
};

export async function renderLowBalanceEmail(
  props: LowBalanceEmailProps,
): Promise<RenderedLowBalance> {
  const t = STRINGS[props.locale];
  const subject = t.subject(props.remainingMinutes);
  const html = await render(<LowBalanceEmail {...props} />);
  const text = await render(<LowBalanceEmail {...props} />, { plainText: true });
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
  alertBanner: {
    backgroundColor: '#fef3c7',
    border: '1px solid #fbbf24',
    borderLeft: '4px solid #f59e0b',
    borderRadius: '6px',
    padding: '12px 16px',
    marginBottom: '24px',
  } as const,
  alertText: {
    color: '#92400e',
    fontSize: '14px',
    fontWeight: 600,
    margin: 0,
  } as const,
  hero: {
    paddingBottom: '8px',
  } as const,
  greeting: {
    color: '#111827',
    fontSize: '16px',
    margin: '0 0 8px',
  } as const,
  intro: {
    color: '#374151',
    fontSize: '14px',
    lineHeight: '22px',
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
  detailValueHighlight: {
    color: '#b45309',
    fontSize: '16px',
    fontWeight: 700,
    padding: '6px 0',
    verticalAlign: 'top' as const,
  } as const,
  sectionTitle: {
    color: '#111827',
    fontSize: '16px',
    fontWeight: 600,
    margin: '0 0 12px',
  } as const,
  hr: {
    borderColor: '#e5e7eb',
    margin: '24px 0',
  } as const,
  ctaWrap: {
    margin: '24px 0',
    textAlign: 'center' as const,
  } as const,
  cta: {
    backgroundColor: '#d97706',
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

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

export type SuspiciousLoginLocale = 'it' | 'en';

export type SuspiciousLoginEmailProps = {
  locale: SuspiciousLoginLocale;
  userEmail: string;
  occurredAt: Date;
  ip: string;
  city?: string;
  userAgentSummary: string;
  revokeUrl: string;
  appUrl?: string;
};

type Strings = {
  preview: string;
  subject: string;
  title: string;
  intro: (email: string) => string;
  detailsLabel: string;
  labelTime: string;
  labelLocation: string;
  labelDevice: string;
  unknown: string;
  safeNotice: string;
  ctaRevoke: string;
  ctaNote: string;
  footerNote: string;
};

const STRINGS: Record<SuspiciousLoginLocale, Strings> = {
  it: {
    preview: 'Nuovo accesso rilevato al tuo account VoiceFlow',
    subject: 'Nuovo accesso al tuo account VoiceFlow',
    title: 'Nuovo accesso rilevato',
    intro: (email) =>
      `Abbiamo rilevato un accesso al tuo account (${email}) da un dispositivo o una posizione che non avevamo mai visto prima.`,
    detailsLabel: 'Dettagli accesso',
    labelTime: 'Data e ora',
    labelLocation: 'Posizione (IP)',
    labelDevice: 'Dispositivo',
    unknown: 'Sconosciuto',
    safeNotice:
      'Se eri tu, puoi ignorare questa email. Se non riconosci questo accesso, ti consigliamo di proteggere immediatamente il tuo account.',
    ctaRevoke: 'Non ero io — proteggi l\'account',
    ctaNote: 'Cliccando verrà revocata ogni sessione attiva.',
    footerNote:
      'Hai ricevuto questa email perché il tuo account VoiceFlow ha ricevuto un nuovo accesso da un dispositivo sconosciuto. Se hai già verificato che si trattava di te, puoi ignorare questo messaggio.',
  },
  en: {
    preview: 'New sign-in detected to your VoiceFlow account',
    subject: 'New sign-in to your VoiceFlow account',
    title: 'New sign-in detected',
    intro: (email) =>
      `We detected a sign-in to your account (${email}) from a device or location we haven't seen before.`,
    detailsLabel: 'Sign-in details',
    labelTime: 'Date and time',
    labelLocation: 'Location (IP)',
    labelDevice: 'Device',
    unknown: 'Unknown',
    safeNotice:
      'If this was you, you can ignore this email. If you don\'t recognise this sign-in, we recommend securing your account immediately.',
    ctaRevoke: 'This wasn\'t me — secure my account',
    ctaNote: 'Clicking will revoke all active sessions.',
    footerNote:
      'You received this email because your VoiceFlow account had a new sign-in from an unknown device. If you have already verified it was you, you can safely ignore this message.',
  },
};

function formatDate(date: Date, locale: SuspiciousLoginLocale): string {
  return date.toLocaleString(locale === 'it' ? 'it-IT' : 'en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Rome',
    timeZoneName: 'short',
  });
}

export function SuspiciousLoginEmail(props: SuspiciousLoginEmailProps) {
  const t = STRINGS[props.locale];

  const locationDisplay =
    props.city ? `${props.city} (${props.ip})` : props.ip;

  return (
    <Html lang={props.locale}>
      <Head />
      <Preview>{t.preview}</Preview>
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
              {t.title}
            </Heading>
            <Text style={styles.intro}>{t.intro(props.userEmail)}</Text>
          </Section>

          <Section style={styles.detailsBox}>
            <Text style={styles.detailsLabel}>{t.detailsLabel}</Text>
            <table cellPadding={0} cellSpacing={0} style={styles.detailsTable}>
              <tbody>
                <tr>
                  <td style={styles.detailKey}>{t.labelTime}</td>
                  <td style={styles.detailValue}>
                    {formatDate(props.occurredAt, props.locale)}
                  </td>
                </tr>
                <tr>
                  <td style={styles.detailKey}>{t.labelLocation}</td>
                  <td style={styles.detailValue}>{locationDisplay}</td>
                </tr>
                <tr>
                  <td style={styles.detailKey}>{t.labelDevice}</td>
                  <td style={styles.detailValue}>
                    {props.userAgentSummary || t.unknown}
                  </td>
                </tr>
              </tbody>
            </table>
          </Section>

          <Section style={styles.noticeWrap}>
            <Text style={styles.notice}>{t.safeNotice}</Text>
          </Section>

          <Section style={styles.ctaWrap}>
            <Button href={props.revokeUrl} style={styles.ctaDanger}>
              {t.ctaRevoke}
            </Button>
            <Text style={styles.ctaNote}>{t.ctaNote}</Text>
          </Section>

          <Hr style={styles.hr} />

          <Section>
            <Text style={styles.footer}>{t.footerNote}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export type RenderedSuspiciousLogin = {
  subject: string;
  html: string;
  text: string;
};

export async function renderSuspiciousLoginEmail(
  props: SuspiciousLoginEmailProps,
): Promise<RenderedSuspiciousLogin> {
  const t = STRINGS[props.locale];
  const html = await render(<SuspiciousLoginEmail {...props} />);
  const text = await render(<SuspiciousLoginEmail {...props} />, { plainText: true });
  return { subject: t.subject, html, text };
}

/** Parses a raw User-Agent string into a human-readable summary (browser + OS). */
export function summariseUserAgent(ua: string): string {
  if (!ua) return '';

  let browser = '';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\//.test(ua)) browser = 'Opera';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';

  let os = '';
  if (/Windows NT 10/.test(ua)) os = 'Windows 10/11';
  else if (/Windows NT/.test(ua)) os = 'Windows';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad/.test(ua)) os = 'iOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  if (browser && os) return `${browser} su ${os}`;
  if (browser) return browser;
  if (os) return os;
  return ua.slice(0, 60);
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
  intro: {
    color: '#374151',
    fontSize: '14px',
    lineHeight: '22px',
    margin: '0 0 20px',
  } as const,
  detailsBox: {
    backgroundColor: '#fef3c7',
    border: '1px solid #f59e0b',
    borderRadius: '6px',
    padding: '16px',
    margin: '0 0 24px',
  } as const,
  detailsLabel: {
    color: '#92400e',
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.05em',
    margin: '0 0 10px',
    textTransform: 'uppercase' as const,
  } as const,
  detailsTable: {
    borderCollapse: 'collapse' as const,
    width: '100%',
  } as const,
  detailKey: {
    color: '#6b7280',
    fontSize: '12px',
    fontWeight: 600,
    padding: '5px 12px 5px 0',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    width: '35%',
    verticalAlign: 'top' as const,
  } as const,
  detailValue: {
    color: '#111827',
    fontSize: '14px',
    padding: '5px 0',
    verticalAlign: 'top' as const,
  } as const,
  noticeWrap: {
    marginBottom: '8px',
  } as const,
  notice: {
    color: '#4b5563',
    fontSize: '14px',
    lineHeight: '22px',
    margin: '0 0 16px',
  } as const,
  ctaWrap: {
    margin: '24px 0',
    textAlign: 'center' as const,
  } as const,
  ctaDanger: {
    backgroundColor: '#dc2626',
    borderRadius: '6px',
    color: '#ffffff',
    display: 'inline-block',
    fontSize: '14px',
    fontWeight: 600,
    padding: '12px 20px',
    textDecoration: 'none',
  } as const,
  ctaNote: {
    color: '#9ca3af',
    fontSize: '12px',
    margin: '12px 0 0',
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
} as const;

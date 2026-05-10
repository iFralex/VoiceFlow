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

import type { MemberRole } from '@/types';

export type MemberInviteLocale = 'it' | 'en';

export type MemberInviteEmailProps = {
  locale: MemberInviteLocale;
  recipientName?: string;
  orgName: string;
  inviterName: string;
  role: MemberRole;
  acceptUrl: string;
  appUrl?: string;
};

type Strings = {
  preview: (inviter: string, org: string) => string;
  subject: (inviter: string, org: string) => string;
  greeting: (name: string) => string;
  intro: (inviter: string, org: string) => string;
  roleLabel: string;
  roleValue: (role: MemberRole) => string;
  valueProp: string;
  ctaAccept: string;
  ctaNote: string;
  footerSent: (org: string) => string;
};

const ROLE_LABELS: Record<MemberRole, Record<MemberInviteLocale, string>> = {
  owner: { it: 'Proprietario', en: 'Owner' },
  admin: { it: 'Amministratore', en: 'Administrator' },
  operator: { it: 'Operatore', en: 'Operator' },
  viewer: { it: 'Visualizzatore', en: 'Viewer' },
};

const STRINGS: Record<MemberInviteLocale, Strings> = {
  it: {
    preview: (inviter, org) => `${inviter} ti ha invitato a unirti a ${org} su VoiceFlow`,
    subject: (inviter, org) => `${inviter} ti ha invitato a unirti a ${org} su VoiceFlow`,
    greeting: (name) => `Ciao${name ? ` ${name}` : ''},`,
    intro: (inviter, org) =>
      `${inviter} ti ha invitato a entrare nel team di ${org} su VoiceFlow, la piattaforma di chiamate AI per concessionarie.`,
    roleLabel: 'Ruolo assegnato',
    roleValue: (role) => ROLE_LABELS[role].it,
    valueProp:
      'Con VoiceFlow il tuo team può avviare campagne di chiamata automatizzate, qualificare lead e fissare appuntamenti — tutto in modo semplice e misurabile.',
    ctaAccept: 'Accetta invito',
    ctaNote: "Cliccando il pulsante verrai reindirizzato alla pagina di accesso.",
    footerSent: (org) =>
      `Hai ricevuto questa email perché ${org} ti ha invitato su VoiceFlow. Se non ti aspettavi questo invito, puoi ignorare questo messaggio.`,
  },
  en: {
    preview: (inviter, org) => `${inviter} invited you to join ${org} on VoiceFlow`,
    subject: (inviter, org) => `${inviter} invited you to join ${org} on VoiceFlow`,
    greeting: (name) => `Hi${name ? ` ${name}` : ''},`,
    intro: (inviter, org) =>
      `${inviter} has invited you to join the ${org} team on VoiceFlow, the AI calling platform for dealerships.`,
    roleLabel: 'Assigned role',
    roleValue: (role) => ROLE_LABELS[role].en,
    valueProp:
      'With VoiceFlow your team can launch automated calling campaigns, qualify leads, and book appointments — all in a simple, measurable way.',
    ctaAccept: 'Accept invitation',
    ctaNote: 'Clicking the button will redirect you to the login page.',
    footerSent: (org) =>
      `You received this email because ${org} invited you to VoiceFlow. If you were not expecting this invitation, you can safely ignore this message.`,
  },
};

export function MemberInviteEmail(props: MemberInviteEmailProps) {
  const t = STRINGS[props.locale];
  const previewText = t.preview(props.inviterName, props.orgName);
  const greetingName = props.recipientName?.trim() ?? '';

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
              {props.orgName}
            </Heading>
            <Text style={styles.greeting}>{t.greeting(greetingName)}</Text>
            <Text style={styles.intro}>{t.intro(props.inviterName, props.orgName)}</Text>
          </Section>

          <Section style={styles.detailsBox}>
            <table cellPadding={0} cellSpacing={0} style={styles.detailsTable}>
              <tbody>
                <tr>
                  <td style={styles.detailLabel}>{t.roleLabel}</td>
                  <td style={styles.detailValue}>{t.roleValue(props.role)}</td>
                </tr>
              </tbody>
            </table>
          </Section>

          <Section style={styles.valuePropWrap}>
            <Text style={styles.valueProp}>{t.valueProp}</Text>
          </Section>

          <Section style={styles.ctaWrap}>
            <Button href={props.acceptUrl} style={styles.cta}>
              {t.ctaAccept}
            </Button>
            <Text style={styles.ctaNote}>{t.ctaNote}</Text>
          </Section>

          <Hr style={styles.hr} />

          <Section>
            <Text style={styles.footer}>{t.footerSent(props.orgName)}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export type RenderedMemberInvite = {
  subject: string;
  html: string;
  text: string;
};

export async function renderMemberInviteEmail(
  props: MemberInviteEmailProps,
): Promise<RenderedMemberInvite> {
  const t = STRINGS[props.locale];
  const subject = t.subject(props.inviterName, props.orgName);
  const html = await render(<MemberInviteEmail {...props} />);
  const text = await render(<MemberInviteEmail {...props} />, { plainText: true });
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
    width: '40%',
    verticalAlign: 'top' as const,
  } as const,
  detailValue: {
    color: '#111827',
    fontSize: '14px',
    fontWeight: 600,
    padding: '6px 0',
    verticalAlign: 'top' as const,
  } as const,
  valuePropWrap: {
    marginBottom: '8px',
  } as const,
  valueProp: {
    color: '#4b5563',
    fontSize: '14px',
    lineHeight: '22px',
    margin: '0 0 16px',
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

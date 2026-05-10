import { describe, expect, it } from 'vitest';

import { renderMemberInviteEmail, type MemberInviteEmailProps } from './member-invite';

function buildProps(overrides: Partial<MemberInviteEmailProps> = {}): MemberInviteEmailProps {
  return {
    locale: 'it',
    recipientName: 'Giulia Verdi',
    orgName: 'Acme Auto',
    inviterName: 'Luca Bianchi',
    role: 'operator',
    acceptUrl: 'https://app.example.com/invite/accept/token-123',
    appUrl: 'https://app.example.com',
    ...overrides,
  };
}

describe('renderMemberInviteEmail', () => {
  it('renders Italian subject and html without error', async () => {
    const result = await renderMemberInviteEmail(buildProps());
    expect(result.subject).toContain('ti ha invitato');
    expect(result.subject).toContain('Luca Bianchi');
    expect(result.subject).toContain('Acme Auto');
    expect(result.html).toContain('<html');
    expect(result.html).toContain('Accetta invito');
  });

  it('uses English strings when locale is en', async () => {
    const result = await renderMemberInviteEmail(buildProps({ locale: 'en' }));
    expect(result.subject).toContain('invited you');
    expect(result.subject).toContain('Luca Bianchi');
    expect(result.html).toContain('Accept invitation');
    expect(result.html).not.toContain('Accetta invito');
    expect(result.html).not.toContain('ti ha invitato');
  });

  it('includes accept URL in CTA button', async () => {
    const result = await renderMemberInviteEmail(buildProps());
    expect(result.html).toContain('https://app.example.com/invite/accept/token-123');
  });

  it('shows correct Italian role label for operator', async () => {
    const result = await renderMemberInviteEmail(buildProps({ role: 'operator' }));
    expect(result.html).toContain('Operatore');
  });

  it('shows correct Italian role label for admin', async () => {
    const result = await renderMemberInviteEmail(buildProps({ role: 'admin' }));
    expect(result.html).toContain('Amministratore');
  });

  it('shows correct English role label for admin', async () => {
    const result = await renderMemberInviteEmail(buildProps({ locale: 'en', role: 'admin' }));
    expect(result.html).toContain('Administrator');
    expect(result.html).not.toContain('Amministratore');
  });

  it('shows correct English role label for viewer', async () => {
    const result = await renderMemberInviteEmail(buildProps({ locale: 'en', role: 'viewer' }));
    expect(result.html).toContain('Viewer');
  });

  it('includes inviter name and org name in body', async () => {
    const result = await renderMemberInviteEmail(buildProps());
    expect(result.html).toContain('Luca Bianchi');
    expect(result.html).toContain('Acme Auto');
  });

  it('greets by recipient name when provided', async () => {
    const result = await renderMemberInviteEmail(buildProps({ recipientName: 'Giulia Verdi' }));
    expect(result.html).toContain('Giulia Verdi');
  });

  it('greets without name when recipientName is absent', async () => {
    const base = buildProps();
    const { recipientName: _omit, ...rest } = base;
    const result = await renderMemberInviteEmail(rest);
    expect(result.html).toContain('Ciao,');
  });

  it('includes org name in footer', async () => {
    const result = await renderMemberInviteEmail(buildProps());
    expect(result.html).toContain('Acme Auto');
  });

  it('produces non-empty plain text output', async () => {
    const result = await renderMemberInviteEmail(buildProps());
    expect(result.text.length).toBeGreaterThan(10);
    expect(result.text.toLowerCase()).toContain('acme auto');
  });
});

import { describe, expect, it } from 'vitest';

import { AddCliArgsError, parseAddCliArgs } from './add-cli';

describe('parseAddCliArgs', () => {
  const baseArgs = [
    '--e164',
    '+390212345678',
    '--provider',
    'voiped',
    '--vapi-id',
    'pn_abc123',
  ];

  it('parses a minimal valid command', () => {
    const out = parseAddCliArgs(baseArgs);
    expect(out).toEqual({
      e164: '+390212345678',
      provider: 'voiped',
      vapiId: 'pn_abc123',
      region: null,
      capabilities: [],
      orgId: null,
    });
  });

  it('parses region and a comma-separated capabilities list', () => {
    const out = parseAddCliArgs([
      ...baseArgs,
      '--region',
      'milano',
      '--capabilities',
      'landline,sms',
    ]);
    expect(out.region).toBe('milano');
    expect(out.capabilities).toEqual(['landline', 'sms']);
  });

  it('trims whitespace inside a capabilities list', () => {
    const out = parseAddCliArgs([...baseArgs, '--capabilities', ' landline , sms ']);
    expect(out.capabilities).toEqual(['landline', 'sms']);
  });

  it('drops empty capability tokens (e.g. trailing comma)', () => {
    const out = parseAddCliArgs([...baseArgs, '--capabilities', 'landline,,']);
    expect(out.capabilities).toEqual(['landline']);
  });

  it('lowercases org-id (UUID is case-insensitive but we normalise)', () => {
    const out = parseAddCliArgs([
      ...baseArgs,
      '--org-id',
      '11111111-2222-3333-4444-AAAABBBBCCCC',
    ]);
    expect(out.orgId).toBe('11111111-2222-3333-4444-aaaabbbbcccc');
  });

  it('supports --flag=value form', () => {
    const out = parseAddCliArgs([
      '--e164=+393409876543',
      '--provider=twilio',
      '--vapi-id=pn_xyz',
    ]);
    expect(out.e164).toBe('+393409876543');
    expect(out.provider).toBe('twilio');
    expect(out.vapiId).toBe('pn_xyz');
  });

  it('rejects a missing required flag', () => {
    expect(() => parseAddCliArgs(['--provider', 'voiped'])).toThrow(AddCliArgsError);
    expect(() => parseAddCliArgs(['--e164', '+390212345678'])).toThrow(/--provider/);
  });

  it('rejects a non-E.164 number', () => {
    expect(() =>
      parseAddCliArgs(['--e164', '0212345678', '--provider', 'voiped', '--vapi-id', 'x']),
    ).toThrow(/E\.164/);
    expect(() =>
      parseAddCliArgs(['--e164', '+abc', '--provider', 'voiped', '--vapi-id', 'x']),
    ).toThrow(/E\.164/);
  });

  it('rejects an unknown provider', () => {
    expect(() =>
      parseAddCliArgs([
        '--e164',
        '+390212345678',
        '--provider',
        'plivo',
        '--vapi-id',
        'x',
      ]),
    ).toThrow(/voiped, twilio, telnyx/);
  });

  it('rejects a malformed org-id', () => {
    expect(() => parseAddCliArgs([...baseArgs, '--org-id', 'not-a-uuid'])).toThrow(
      /UUID/,
    );
  });

  it('rejects a flag missing its value', () => {
    expect(() => parseAddCliArgs(['--e164'])).toThrow(/Missing value/);
  });

  it('rejects an unrecognised positional argument', () => {
    expect(() => parseAddCliArgs(['oops'])).toThrow(/Unexpected/);
  });

  it('treats accepted providers as the full enum (voiped, twilio, telnyx)', () => {
    for (const provider of ['voiped', 'twilio', 'telnyx'] as const) {
      const out = parseAddCliArgs([
        '--e164',
        '+390212345678',
        '--provider',
        provider,
        '--vapi-id',
        'pn',
      ]);
      expect(out.provider).toBe(provider);
    }
  });

  it('treats an empty --region as null (so the founder can pass through scripted defaults)', () => {
    const out = parseAddCliArgs([...baseArgs, '--region=']);
    expect(out.region).toBeNull();
  });
});

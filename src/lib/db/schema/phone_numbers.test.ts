import { describe, expect, it } from 'vitest';

import { phoneNumbers, phoneProviderEnum, phoneStatusEnum } from './phone_numbers';

describe('phone_numbers schema', () => {
  it('has expected columns', () => {
    const cols = Object.keys(phoneNumbers);
    expect(cols).toContain('id');
    expect(cols).toContain('e164');
    expect(cols).toContain('org_id');
    expect(cols).toContain('provider');
    expect(cols).toContain('status');
    expect(cols).toContain('last_used_at');
    expect(cols).toContain('daily_call_count');
    expect(cols).toContain('spam_score');
    expect(cols).toContain('created_at');
  });

  it('phoneProviderEnum has correct values', () => {
    expect(phoneProviderEnum.enumValues).toEqual(['voiped', 'twilio', 'telnyx']);
  });

  it('phoneStatusEnum has correct values', () => {
    expect(phoneStatusEnum.enumValues).toEqual(['active', 'cooling_down', 'retired']);
  });

  it('e164 is not null', () => {
    const col = (phoneNumbers as any).e164;
    expect(col.notNull).toBeTruthy();
  });

  it('org_id is nullable (null = shared pool)', () => {
    const col = (phoneNumbers as any).org_id;
    expect(col.notNull).toBeFalsy();
  });

  it('status defaults to active', () => {
    const col = (phoneNumbers as any).status;
    expect(col.default).toBe('active');
  });

  it('daily_call_count defaults to 0', () => {
    const col = (phoneNumbers as any).daily_call_count;
    expect(col.default).toBe(0);
  });

  it('daily_call_count is not null', () => {
    const col = (phoneNumbers as any).daily_call_count;
    expect(col.notNull).toBeTruthy();
  });

  it('spam_score is not null', () => {
    const col = (phoneNumbers as any).spam_score;
    expect(col.notNull).toBeTruthy();
  });

  it('last_used_at is nullable', () => {
    const col = (phoneNumbers as any).last_used_at;
    expect(col.notNull).toBeFalsy();
  });
});

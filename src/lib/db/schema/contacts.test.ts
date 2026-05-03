import { describe, expect, it } from 'vitest';

import { contactLists, listSourceEnum } from './contact_lists';
import { consentBasisEnum, contactTypeEnum, contacts, rpoStatusEnum } from './contacts';

describe('contact_lists schema', () => {
  it('has expected columns', () => {
    const cols = Object.keys(contactLists);
    expect(cols).toContain('id');
    expect(cols).toContain('org_id');
    expect(cols).toContain('name');
    expect(cols).toContain('source');
    expect(cols).toContain('source_file_path');
    expect(cols).toContain('total_count');
    expect(cols).toContain('valid_count');
    expect(cols).toContain('created_at');
  });

  it('source_file_path is nullable', () => {
    const col = (contactLists as any).source_file_path;
    expect(col.notNull).toBeFalsy();
  });

  it('total_count and valid_count default to 0', () => {
    const total = (contactLists as any).total_count;
    const valid = (contactLists as any).valid_count;
    expect(total.default).toBe(0);
    expect(valid.default).toBe(0);
  });

  it('listSourceEnum has correct values', () => {
    expect(listSourceEnum.enumValues).toEqual(['csv-upload', 'zapier', 'api']);
  });
});

describe('contacts schema', () => {
  it('has expected columns', () => {
    const cols = Object.keys(contacts);
    expect(cols).toContain('id');
    expect(cols).toContain('org_id');
    expect(cols).toContain('contact_list_id');
    expect(cols).toContain('phone_e164');
    expect(cols).toContain('first_name');
    expect(cols).toContain('last_name');
    expect(cols).toContain('email');
    expect(cols).toContain('consent_basis');
    expect(cols).toContain('consent_evidence');
    expect(cols).toContain('contact_type');
    expect(cols).toContain('rpo_status');
    expect(cols).toContain('rpo_checked_at');
    expect(cols).toContain('opt_out');
    expect(cols).toContain('opt_out_reason');
    expect(cols).toContain('metadata');
    expect(cols).toContain('created_at');
    expect(cols).toContain('deleted_at');
  });

  it('nullable optional fields', () => {
    const nullableFields = ['first_name', 'last_name', 'email', 'consent_evidence', 'opt_out_reason', 'metadata', 'rpo_checked_at', 'deleted_at'];
    for (const field of nullableFields) {
      const col = (contacts as any)[field];
      expect(col.notNull, `${field} should be nullable`).toBeFalsy();
    }
  });

  it('contact_type defaults to b2c', () => {
    const col = (contacts as any).contact_type;
    expect(col.default).toBe('b2c');
  });

  it('rpo_status defaults to unchecked', () => {
    const col = (contacts as any).rpo_status;
    expect(col.default).toBe('unchecked');
  });

  it('opt_out defaults to false', () => {
    const col = (contacts as any).opt_out;
    expect(col.default).toBe(false);
  });

  it('consentBasisEnum has correct values', () => {
    expect(consentBasisEnum.enumValues).toEqual([
      'consent',
      'legitimate_interest',
      'existing_customer',
    ]);
  });

  it('contactTypeEnum has correct values', () => {
    expect(contactTypeEnum.enumValues).toEqual(['b2c', 'b2b']);
  });

  it('rpoStatusEnum has correct values', () => {
    expect(rpoStatusEnum.enumValues).toEqual(['clear', 'blocked', 'unchecked']);
  });
});

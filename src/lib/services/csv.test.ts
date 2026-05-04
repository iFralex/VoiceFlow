import { describe, expect, it } from 'vitest';

import { parseContactsCsv } from './csv';

const BASE_OPTIONS = {
  consentBasis: 'existing_customer' as const,
  sourceListId: 'list-1',
  orgId: 'org-1',
};

// ─── Column auto-detection ────────────────────────────────────────────────────

describe('column auto-detection', () => {
  it('detects Italian "telefono" as phone column', async () => {
    const csv = 'telefono,nome\n+39333123456,Mario';
    const result = await parseContactsCsv(csv, BASE_OPTIONS);
    expect(result.detectedColumns.phone).toBe('telefono');
    expect(result.detectedColumns.firstName).toBe('nome');
  });

  it('detects English "phone" as phone column', async () => {
    const csv = 'phone,first_name,last_name,email\n+39333123456,John,Doe,john@example.com';
    const result = await parseContactsCsv(csv, BASE_OPTIONS);
    expect(result.detectedColumns.phone).toBe('phone');
    expect(result.detectedColumns.firstName).toBe('first_name');
    expect(result.detectedColumns.lastName).toBe('last_name');
    expect(result.detectedColumns.email).toBe('email');
  });

  it('detects "cellulare" as phone column', async () => {
    const csv = 'cellulare\n+393331234567';
    const result = await parseContactsCsv(csv, BASE_OPTIONS);
    expect(result.detectedColumns.phone).toBe('cellulare');
  });

  it('detects "mobile" as phone column', async () => {
    const csv = 'mobile\n+393331234567';
    const result = await parseContactsCsv(csv, BASE_OPTIONS);
    expect(result.detectedColumns.phone).toBe('mobile');
  });

  it('detects "cognome" as last_name column', async () => {
    const csv = 'telefono,cognome\n+393331234567,Rossi';
    const result = await parseContactsCsv(csv, BASE_OPTIONS);
    expect(result.detectedColumns.lastName).toBe('cognome');
  });

  it('returns error result when phone column cannot be detected', async () => {
    const csv = 'nome,cognome\nMario,Rossi';
    const result = await parseContactsCsv(csv, BASE_OPTIONS);
    expect(result.validRows).toHaveLength(0);
    expect(result.invalidRows).toHaveLength(1);
    expect(result.invalidRows[0]!.errors[0]).toContain('Impossibile rilevare');
  });

  it('uses explicit column mapping when provided', async () => {
    const csv = 'tel_number,given\n+393331234567,Mario';
    const result = await parseContactsCsv(csv, {
      ...BASE_OPTIONS,
      columnMapping: { phone: 'tel_number', firstName: 'given' },
    });
    expect(result.validRows).toHaveLength(1);
    expect(result.validRows[0]!.first_name).toBe('Mario');
  });
});

// ─── Phone normalisation ──────────────────────────────────────────────────────

describe('phone normalisation', () => {
  it('normalises leading-zero Italian format', async () => {
    const csv = 'phone\n3331234567';
    const result = await parseContactsCsv(csv, BASE_OPTIONS);
    expect(result.validRows).toHaveLength(1);
    expect(result.validRows[0]!.phone_e164).toBe('+393331234567');
  });

  it('normalises +39 prefix format', async () => {
    const csv = 'phone\n+393331234567';
    const result = await parseContactsCsv(csv, BASE_OPTIONS);
    expect(result.validRows[0]!.phone_e164).toBe('+393331234567');
  });

  it('normalises 0039 prefix format', async () => {
    const csv = 'phone\n00393331234567';
    const result = await parseContactsCsv(csv, BASE_OPTIONS);
    expect(result.validRows[0]!.phone_e164).toBe('+393331234567');
  });

  it('puts malformed phone in invalidRows', async () => {
    const csv = 'phone\nnotaphone';
    const result = await parseContactsCsv(csv, BASE_OPTIONS);
    expect(result.validRows).toHaveLength(0);
    expect(result.invalidRows).toHaveLength(1);
    expect(result.invalidRows[0]!.errors[0]).toContain('Numero di telefono non valido');
  });

  it('puts empty phone in invalidRows', async () => {
    const csv = 'phone\n';
    const result = await parseContactsCsv(csv, BASE_OPTIONS);
    expect(result.validRows).toHaveLength(0);
  });
});

// ─── Email validation ─────────────────────────────────────────────────────────

describe('email validation', () => {
  it('accepts valid email addresses', async () => {
    const csv = 'phone,email\n+393331234567,mario@example.com';
    const result = await parseContactsCsv(csv, BASE_OPTIONS);
    expect(result.validRows[0]!.email).toBe('mario@example.com');
  });

  it('rejects invalid email format', async () => {
    const csv = 'phone,email\n+393331234567,not-an-email';
    const result = await parseContactsCsv(csv, BASE_OPTIONS);
    expect(result.validRows).toHaveLength(0);
    expect(result.invalidRows[0]!.errors[0]).toContain('email non valido');
  });

  it('treats empty email as no email (not an error)', async () => {
    const csv = 'phone,email\n+393331234567,';
    const result = await parseContactsCsv(csv, BASE_OPTIONS);
    expect(result.validRows).toHaveLength(1);
    expect(result.validRows[0]!.email).toBeNull();
  });
});

// ─── Field sanitisation ───────────────────────────────────────────────────────

describe('field sanitisation', () => {
  it('strips control characters from name fields', async () => {
    const csv = 'phone,nome\n+393331234567,Mar\x01io';
    const result = await parseContactsCsv(csv, BASE_OPTIONS);
    expect(result.validRows[0]!.first_name).toBe('Mario');
  });

  it('caps field length to 200 characters', async () => {
    const longName = 'A'.repeat(300);
    const csv = `phone,nome\n+393331234567,${longName}`;
    const result = await parseContactsCsv(csv, BASE_OPTIONS);
    expect(result.validRows[0]!.first_name).toHaveLength(200);
  });
});

// ─── Metadata preservation ────────────────────────────────────────────────────

describe('metadata preservation', () => {
  it('stores original row data in metadata', async () => {
    const csv = 'phone,nome,extra_col\n+393331234567,Mario,somevalue';
    const result = await parseContactsCsv(csv, BASE_OPTIONS);
    expect(result.validRows[0]!.metadata).toMatchObject({
      _original_row: { phone: '+393331234567', nome: 'Mario', extra_col: 'somevalue' },
    });
  });

  it('preserves raw row in invalidRows even when invalid', async () => {
    const csv = 'phone,nome\nnotaphone,Mario';
    const result = await parseContactsCsv(csv, BASE_OPTIONS);
    expect(result.invalidRows[0]!.raw).toMatchObject({ phone: 'notaphone', nome: 'Mario' });
  });
});

// ─── Options and counts ───────────────────────────────────────────────────────

describe('options and counts', () => {
  it('applies consentBasis to all valid rows', async () => {
    const csv = 'phone\n+393331234567\n+393332345678';
    const result = await parseContactsCsv(csv, {
      ...BASE_OPTIONS,
      consentBasis: 'consent',
    });
    for (const row of result.validRows) {
      expect(row.consent_basis).toBe('consent');
    }
  });

  it('applies contactType to all valid rows', async () => {
    const csv = 'phone\n+393331234567';
    const result = await parseContactsCsv(csv, { ...BASE_OPTIONS, contactType: 'b2b' });
    expect(result.validRows[0]!.contact_type).toBe('b2b');
  });

  it('defaults contactType to b2c', async () => {
    const csv = 'phone\n+393331234567';
    const result = await parseContactsCsv(csv, BASE_OPTIONS);
    expect(result.validRows[0]!.contact_type).toBe('b2c');
  });

  it('reports correct totalRows, validRows, invalidRows counts', async () => {
    const csv = ['phone', '+393331234567', 'bad', '+393332345678'].join('\n');
    const result = await parseContactsCsv(csv, BASE_OPTIONS);
    expect(result.totalRows).toBe(3);
    expect(result.validRows).toHaveLength(2);
    expect(result.invalidRows).toHaveLength(1);
  });

  it('sets org_id and contact_list_id on valid rows', async () => {
    const csv = 'phone\n+393331234567';
    const result = await parseContactsCsv(csv, BASE_OPTIONS);
    expect(result.validRows[0]!.org_id).toBe('org-1');
    expect(result.validRows[0]!.contact_list_id).toBe('list-1');
  });

  it('handles empty CSV gracefully', async () => {
    const csv = 'phone\n';
    const result = await parseContactsCsv(csv, BASE_OPTIONS);
    expect(result.totalRows).toBe(0);
    expect(result.validRows).toHaveLength(0);
    expect(result.invalidRows).toHaveLength(0);
  });

  it('handles Buffer input', async () => {
    const csv = Buffer.from('phone\n+393331234567');
    const result = await parseContactsCsv(csv, BASE_OPTIONS);
    expect(result.validRows).toHaveLength(1);
  });
});

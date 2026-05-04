import Papa from 'papaparse';

import type { NewContact } from '@/lib/db/schema';
import { consentBasisEnum, contactTypeEnum } from '@/lib/db/schema';
import { normaliseToE164 } from '@/lib/utils/phone';

export type ConsentBasis = (typeof consentBasisEnum.enumValues)[number];
export type ContactType = (typeof contactTypeEnum.enumValues)[number];

export type CsvParseResult = {
  totalRows: number;
  validRows: NewContact[];
  invalidRows: Array<{ rowIndex: number; raw: Record<string, string>; errors: string[] }>;
  detectedColumns: { phone: string; firstName?: string; lastName?: string; email?: string };
};

export interface ColumnMapping {
  phone: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

const MAX_FIELD_LENGTH = 200;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Italian and English column name variants
const PHONE_HEADERS = new Set([
  'telefono',
  'cellulare',
  'numero',
  'phone',
  'mobile',
  'tel',
  'telephone',
  'numero_di_telefono',
  'phone_number',
  'cell',
  'celllular',
  'phonenumber',
]);

const FIRST_NAME_HEADERS = new Set([
  'nome',
  'first_name',
  'firstname',
  'first name',
  'name',
  'nome_proprio',
  'given_name',
  'givenname',
  'first',
]);

const LAST_NAME_HEADERS = new Set([
  'cognome',
  'last_name',
  'lastname',
  'last name',
  'surname',
  'family_name',
  'familyname',
  'last',
]);

const EMAIL_HEADERS = new Set([
  'email',
  'e-mail',
  'posta_elettronica',
  'email_address',
  'emailaddress',
  'mail',
  'e_mail',
]);

function detectColumns(headers: string[]): ColumnMapping | null {
  let phone: string | undefined;
  let firstName: string | undefined;
  let lastName: string | undefined;
  let email: string | undefined;

  for (const header of headers) {
    const normalised = header.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!phone && PHONE_HEADERS.has(normalised)) phone = header;
    else if (!firstName && FIRST_NAME_HEADERS.has(normalised)) firstName = header;
    else if (!lastName && LAST_NAME_HEADERS.has(normalised)) lastName = header;
    else if (!email && EMAIL_HEADERS.has(normalised)) email = header;
  }

  if (!phone) return null;

  return {
    phone,
    ...(firstName !== undefined ? { firstName } : {}),
    ...(lastName !== undefined ? { lastName } : {}),
    ...(email !== undefined ? { email } : {}),
  };
}

function sanitiseField(value: string): string {
  // Strip control characters and cap length
  return value
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
    .slice(0, MAX_FIELD_LENGTH);
}

function validateEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

async function streamToString(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((acc, c) => acc + c.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(merged);
}

export async function parseContactsCsv(
  input: ReadableStream | Buffer | string,
  options: {
    defaultCountry?: 'IT';
    consentBasis: ConsentBasis;
    contactType?: ContactType;
    sourceListId: string;
    orgId: string;
    columnMapping?: ColumnMapping;
  },
): Promise<CsvParseResult> {
  const { defaultCountry = 'IT', consentBasis, contactType = 'b2c', sourceListId, orgId } = options;

  // Normalise input to string
  let csvText: string;
  if (typeof input === 'string') {
    csvText = input;
  } else if (Buffer.isBuffer(input)) {
    csvText = input.toString('utf-8');
  } else {
    csvText = await streamToString(input);
  }

  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });

  const headers = parsed.meta.fields ?? [];
  const mapping = options.columnMapping ?? detectColumns(headers);

  if (!mapping) {
    return {
      totalRows: parsed.data.length,
      validRows: [],
      invalidRows: parsed.data.map((raw, i) => ({
        rowIndex: i,
        raw,
        errors: [
          'Impossibile rilevare la colonna del numero di telefono. Fornire una mappatura delle colonne esplicita.',
        ],
      })),
      detectedColumns: { phone: '' },
    };
  }

  const validRows: NewContact[] = [];
  const invalidRows: Array<{ rowIndex: number; raw: Record<string, string>; errors: string[] }> =
    [];

  for (let i = 0; i < parsed.data.length; i++) {
    const row = parsed.data[i]!;
    const errors: string[] = [];

    const rawPhone = row[mapping.phone] ?? '';
    const phone_e164 = normaliseToE164(rawPhone, defaultCountry);
    if (!phone_e164) {
      errors.push(`Numero di telefono non valido: "${rawPhone}"`);
    }

    let email: string | undefined;
    if (mapping.email) {
      const rawEmail = row[mapping.email] ?? '';
      if (rawEmail) {
        const cleanEmail = sanitiseField(rawEmail);
        if (!validateEmail(cleanEmail)) {
          errors.push(`Indirizzo email non valido: "${rawEmail}"`);
        } else {
          email = cleanEmail;
        }
      }
    }

    let firstName: string | undefined;
    if (mapping.firstName) {
      const raw = row[mapping.firstName] ?? '';
      if (raw) firstName = sanitiseField(raw) || undefined;
    }

    let lastName: string | undefined;
    if (mapping.lastName) {
      const raw = row[mapping.lastName] ?? '';
      if (raw) lastName = sanitiseField(raw) || undefined;
    }

    if (errors.length > 0) {
      invalidRows.push({ rowIndex: i, raw: row, errors });
      continue;
    }

    validRows.push({
      org_id: orgId,
      contact_list_id: sourceListId,
      phone_e164: phone_e164!,
      first_name: firstName ?? null,
      last_name: lastName ?? null,
      email: email ?? null,
      consent_basis: consentBasis,
      contact_type: contactType,
      metadata: { _original_row: row },
    });
  }

  return {
    totalRows: parsed.data.length,
    validRows,
    invalidRows,
    detectedColumns: {
      phone: mapping.phone,
      ...(mapping.firstName !== undefined ? { firstName: mapping.firstName } : {}),
      ...(mapping.lastName !== undefined ? { lastName: mapping.lastName } : {}),
      ...(mapping.email !== undefined ? { email: mapping.email } : {}),
    },
  };
}

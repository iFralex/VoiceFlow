import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/**
 * Normalises a phone number string to E.164 format.
 * Accepts Italian formats: leading zero ("0039…"), "+39…", local 10-digit starting with 3.
 * Returns null if the number is invalid or cannot be parsed.
 */
export function normaliseToE164(input: string, defaultCountry: CountryCode = 'IT'): string | null {
  const cleaned = input.replace(/\s+/g, '');
  const parsed = parsePhoneNumberFromString(cleaned, defaultCountry);
  if (!parsed?.isValid()) return null;
  return parsed.number; // E.164
}

/**
 * Classifies an E.164 phone number as mobile, fixed, or unknown.
 * For Italian numbers: mobile numbers start with +393, fixed start with +390.
 */
export function classifyLineType(e164: string): 'mobile' | 'fixed' | 'unknown' {
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed?.isValid()) return 'unknown';
  const type = parsed.getType();
  if (type === 'MOBILE' || type === 'FIXED_LINE_OR_MOBILE') return 'mobile';
  if (type === 'FIXED_LINE') return 'fixed';
  return 'unknown';
}

/**
 * Formats an E.164 phone number in Italian international display format.
 * "+393401234567" → "+39 340 123 4567"
 * Returns the original string if the number cannot be parsed.
 */
export function formatItalianDisplay(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164, 'IT');
  if (!parsed?.isValid()) return e164;
  return parsed.formatInternational();
}

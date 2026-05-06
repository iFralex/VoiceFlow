/**
 * Maps Italian E.164 phone numbers to a region slug used by the CLI picker.
 *
 * The CLI picker (`src/lib/voice/cli/picker.ts`, plan 10 task 4) prefers a CLI
 * whose `region` matches the contact's region — Milanese contacts pick up
 * Milano CLIs at higher rates than out-of-area numbers (spec §9.1). For mobile
 * numbers (+393…) no region can be inferred from the prefix, so the picker
 * falls through to its remaining priorities (lowest daily count, lowest spam
 * score).
 *
 * The slugs returned here are the same ones written into
 * `phone_numbers.region` by the seed (`src/lib/db/seed/phone_numbers.ts`).
 *
 * Coverage: every Italian regional capital (capoluogo di regione) plus a few
 * additional metropolitan cities whose area codes are widely recognised. New
 * DIDs added to the pool with one of these slugs in `phone_numbers.region`
 * will participate in regional matching automatically.
 */

const AREA_CODE_TO_REGION: Record<string, string> = {
  // ---- 2-digit area codes (Milano, Roma) ----
  '02': 'milano',
  '06': 'roma',
  // ---- 3-digit area codes ----
  '010': 'genova',
  '011': 'torino',
  '030': 'brescia',
  '035': 'bergamo',
  '040': 'trieste',
  '041': 'venezia',
  '045': 'verona',
  '049': 'padova',
  '050': 'pisa',
  '051': 'bologna',
  '055': 'firenze',
  '070': 'cagliari',
  '071': 'ancona',
  '075': 'perugia',
  '079': 'sassari',
  '080': 'bari',
  '081': 'napoli',
  '085': 'pescara',
  '090': 'messina',
  '091': 'palermo',
  '095': 'catania',
  '099': 'taranto',
};

/**
 * Returns the region slug for an Italian phone number, or undefined when no
 * area code can be inferred (mobile numbers, non-Italian numbers, malformed
 * input).
 *
 * Accepts E.164 strings ("+390212345678") and tolerates a missing leading "+"
 * (raw "39…" or local "0…") — the picker calls this with whatever it is given
 * and silently falls back when no region match is possible.
 */
export function inferRegionFromPhone(phone: string | null | undefined): string | undefined {
  if (!phone) return undefined;
  const trimmed = phone.trim();
  if (trimmed === '') return undefined;

  // Strip optional "+" and the Italian country code (39); also accept raw
  // local form starting with "0".
  let national = trimmed.startsWith('+') ? trimmed.slice(1) : trimmed;
  if (national.startsWith('39')) national = national.slice(2);
  if (!national.startsWith('0')) return undefined; // mobile (3xx) or non-IT

  // Try the longest prefix first (3-digit codes like 011, 051, 081 must match
  // before 2-digit "02" / "06" since they share no overlap, but the lookup is
  // by exact prefix so we need to test 3-digit before 2-digit explicitly).
  for (const code of Object.keys(AREA_CODE_TO_REGION).sort((a, b) => b.length - a.length)) {
    if (national.startsWith(code)) {
      return AREA_CODE_TO_REGION[code];
    }
  }
  return undefined;
}

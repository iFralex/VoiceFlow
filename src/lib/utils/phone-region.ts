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
 * Plan 10 task 5 will extend this map with the full set of Italian area codes
 * (049 → Padova, 041 → Venezia, 080 → Bari, 091 → Palermo, …). Task 4 only
 * needs the metros that are present in the seed pool (Milano, Roma, Torino,
 * Napoli, Bologna) to make the picker tests meaningful.
 */

const AREA_CODE_TO_REGION: Record<string, string> = {
  '02': 'milano',
  '06': 'roma',
  '011': 'torino',
  '081': 'napoli',
  '051': 'bologna',
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

const LOCALE_MAP: Record<string, string> = {
  it: 'it-IT',
  en: 'en-GB',
};

function toIntlLocale(locale: string): string {
  return LOCALE_MAP[locale] ?? locale;
}

/**
 * Formats integer cents as a locale-aware currency string (e.g. "10,99 €" or "€10.99").
 */
export function formatCurrency(cents: number, locale: string = 'it'): string {
  return new Intl.NumberFormat(toIntlLocale(locale), {
    style: 'currency',
    currency: 'EUR',
  }).format(cents / 100);
}

/**
 * Formats an E.164 phone number to a readable Italian format.
 * +393401234567 or 393401234567 → +39 340 123 4567
 * Returns the original string if it cannot be parsed.
 */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  // Italian with country code: 12 digits starting with 39
  if (digits.length === 12 && digits.startsWith('39')) {
    const local = digits.slice(2);
    return `+39 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
  }
  // Italian mobile: 10 digits starting with 3
  if (digits.length === 10 && digits.startsWith('3')) {
    return `+39 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  return phone;
}

/**
 * Truncates an E.164 phone number to its last 4 digits, prefixed by ellipsis.
 * Returns "—" for null/undefined input.
 */
export function maskPhoneLast4(phone: string | null | undefined): string {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return phone;
  return `••• ${digits.slice(-4)}`;
}

/** Formats a billable-seconds total as `Hh Mm Ss` (omitting empty parts). */
export function formatBilledDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0s';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);
  return parts.join(' ') || '0s';
}

/**
 * Formats a duration in seconds as "Xm Ys", "Xm", or "Zs".
 * formatDuration(83) → "1m 23s"
 * formatDuration(45) → "45s"
 */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) {
    return '0s';
  }
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Formats a date as a locale-aware relative time string.
 * formatRelativeTime(twoHoursAgo, 'it') → "2 ore fa"
 * formatRelativeTime(twoHoursAgo, 'en') → "2 hours ago"
 */
export function formatRelativeTime(date: Date, locale: string = 'it'): string {
  const rtf = new Intl.RelativeTimeFormat(toIntlLocale(locale), {
    numeric: 'auto',
  });
  const diffMs = date.getTime() - Date.now();
  const absDiff = Math.abs(diffMs);

  if (absDiff < 60_000) {
    return rtf.format(Math.round(diffMs / 1_000), 'second');
  }
  if (absDiff < 3_600_000) {
    return rtf.format(Math.round(diffMs / 60_000), 'minute');
  }
  if (absDiff < 86_400_000) {
    return rtf.format(Math.round(diffMs / 3_600_000), 'hour');
  }
  return rtf.format(Math.round(diffMs / 86_400_000), 'day');
}

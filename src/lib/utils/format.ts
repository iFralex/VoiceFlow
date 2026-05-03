/**
 * Formats a phone number string to a consistent display format.
 * Handles Italian mobile (+39 3XX XXX XXXX) and international Italian format.
 * Returns the original string if it cannot be parsed.
 */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  // Italian mobile with country code: 12 digits starting with 39 (e.g. 393401234567 → +39 340 123 4567)
  if (digits.length === 12 && digits.startsWith('39')) {
    const local = digits.slice(2);
    return `+39 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
  }
  // Italian mobile: 10 digits starting with 3 (e.g. 3401234567 → +39 340 123 4567)
  if (digits.length === 10 && digits.startsWith('3')) {
    return `+39 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  return phone;
}

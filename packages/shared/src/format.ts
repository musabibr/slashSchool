// Display helpers shared by the web app and server-generated text (e.g. notices).
// The sketch uses Western digits and d/M/yyyy dates.

const moneyFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function formatMoney(amount: number, withCurrency = false): string {
  const s = moneyFmt.format(amount);
  return withCurrency ? `${s} ج.س` : s;
}

/** '2025-05-09' → '9/5/2025' */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  if (!y || !m || !d) return iso;
  return `${Number(d)}/${Number(m)}/${y}`;
}

export function formatPercent(value: number): string {
  return `${value}%`;
}

export function joinName(...parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

/** Sudanese mobile numbers: keep digits only; '+249 91 234 5678' → '0912345678'. */
export function normalizePhone(input: string): string {
  // Arabic-Indic digits → Western, then keep digits only
  let digits = input
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[^\d]/g, '');
  if (digits.startsWith('00249')) digits = '0' + digits.slice(5);
  else if (digits.startsWith('249') && digits.length === 12) digits = '0' + digits.slice(3);
  else if (digits.length === 9 && !digits.startsWith('0')) digits = '0' + digits;
  return digits;
}

export function isValidPhone(input: string): boolean {
  return /^0\d{9}$/.test(normalizePhone(input));
}

/** WhatsApp deep link (wa.me) for a local Sudanese number. */
export function whatsappLink(phone: string, text: string): string {
  const local = normalizePhone(phone);
  const intl = local.startsWith('0') ? `249${local.slice(1)}` : local;
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
}

import { formatMoney, type InstallmentStatus } from '@slash/shared';

const ORDINALS = [
  'الأول',
  'الثاني',
  'الثالث',
  'الرابع',
  'الخامس',
  'السادس',
  'السابع',
  'الثامن',
  'التاسع',
  'العاشر',
  'الحادي عشر',
  'الثاني عشر',
] as const;

/** 1 → "الأول", 2 → "الثاني" … (installments go up to 12). */
export function arabicOrdinal(n: number): string {
  return ORDINALS[n - 1] ?? String(n);
}

/** 1 → "القسط الأول" */
export function installmentLabel(seq: number): string {
  return `القسط ${arabicOrdinal(seq)}`;
}

/** Mantine colour per installment status (P9 "حالة السداد"). */
export const INSTALLMENT_STATUS_COLORS: Record<InstallmentStatus, string> = {
  paid: 'teal',
  partial: 'yellow',
  late: 'red',
  upcoming: 'gray',
};

/** "600,000 ج.س" */
export const money = (amount: number) => formatMoney(amount, true);

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

/** 1 → "القسط الأول", 3 → "القسط الثالث" (used in the fee notice text). */
export function installmentLabel(seq: number): string {
  const ordinal = ORDINALS[seq - 1];
  return ordinal ? `القسط ${ordinal}` : `القسط ${seq}`;
}

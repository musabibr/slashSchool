/** Demo logins shown on the login page when DEMO_MODE=true. The demo seed creates exactly these. */
export const DEMO_PIN = '1234';

export const DEMO_ACCOUNTS = [
  { role: 'admin', label: 'المدير', phone: '0900000001', fullName: 'عبدالرحيم الطيب' },
  { role: 'supervisor', label: 'المشرف', phone: '0900000002', fullName: 'مريوة الحليوة' },
  { role: 'teacher', label: 'الأستاذ', phone: '0900000003', fullName: 'عثمان محمد الأمين' },
  { role: 'guardian', label: 'ولي الأمر', phone: '0912345678', fullName: 'إبراهيم عبدالله أحمد' },
] as const;

/** A guardian who has not activated yet — to try the activation-code flow. */
export const DEMO_ACTIVATION = { code: 'DEMO-2025-AB', phone: '0911111111', fullName: 'عوض محمد أحمد' } as const;

export const DEMO_SCHOOLS = {
  middle: { code: 'SCHOOL_A_001', name: 'مدرسة أولاد عمار المتوسطة' },
  secondary: { code: 'SCHOOL_A_002', name: 'مدرسة أولاد عمار الثانوية' },
} as const;

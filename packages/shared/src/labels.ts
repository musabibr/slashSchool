import type {
  AssessmentKind,
  AudienceType,
  BadgeModule,
  CalendarKind,
  EvaluationRating,
  Gender,
  InstallmentStatus,
  PaymentMethod,
  Relation,
  Role,
  StudentStatus,
} from './enums';

// Arabic UI labels for every enum. Keep wording consistent with the sketch.

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'المدير',
  supervisor: 'المشرف',
  teacher: 'الأستاذ',
  guardian: 'ولي الأمر',
};

export const GENDER_LABELS: Record<Gender, string> = { male: 'ذكر', female: 'أنثى' };

export const STUDENT_STATUS_LABELS: Record<StudentStatus, string> = {
  active: 'منتظم',
  withdrawn: 'منسحب',
  expelled: 'مفصول',
};

export const RELATION_LABELS: Record<Relation, string> = {
  father: 'والد',
  mother: 'والدة',
  brother: 'أخ',
  sister: 'أخت',
  uncle: 'عم / خال',
  grandparent: 'جد / جدة',
  other: 'أخرى',
};

export const ASSESSMENT_KIND_LABELS: Record<AssessmentKind, string> = {
  quiz: 'اختبار',
  weekly: 'امتحان أسبوعي',
  monthly: 'امتحان شهري',
  term: 'امتحان فترة',
  final: 'امتحان نهائي',
};

export const EVALUATION_RATING_LABELS: Record<EvaluationRating, string> = {
  excellent: 'متميز',
  calm: 'هادئ',
  needs_attention: 'يحتاج متابعة',
  disruptive: 'مشاغب',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'نقداً',
  bank_transfer: 'تحويل بنكي',
  bankak: 'بنكك',
  other: 'أخرى',
};

export const AUDIENCE_TYPE_LABELS: Record<AudienceType, string> = {
  school: 'جميع الطلاب',
  grade_level: 'صف دراسي',
  class_section: 'فصل',
  student: 'ولي أمر طالب',
};

export const CALENDAR_KIND_LABELS: Record<CalendarKind, string> = {
  holiday: 'عطلة',
  event: 'فعالية',
  exam: 'امتحانات',
  meeting: 'اجتماع',
};

export const INSTALLMENT_STATUS_LABELS: Record<InstallmentStatus, string> = {
  paid: 'تم الدفع',
  partial: 'مدفوع جزئياً',
  late: 'متأخر',
  upcoming: 'لم يحن موعده',
};

export const BADGE_MODULE_LABELS: Record<BadgeModule, string> = {
  lessons: 'الدروس',
  homework: 'الواجبات',
  attendance: 'الغياب',
  fees: 'الرسوم الدراسية',
  exams: 'الإمتحانات',
  results: 'النتائج',
  behavior: 'السلوك والإنضباط',
  calendar: 'التقويم الدراسي',
  announcements: 'الإعلانات',
};

export const WEEKDAY_LABELS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'] as const;

export const PERIOD_LABELS = [
  'الحصة الأولى',
  'الحصة الثانية',
  'الحصة الثالثة',
  'الحصة الرابعة',
  'الحصة الخامسة',
  'الحصة السادسة',
  'الحصة السابعة',
  'الحصة الثامنة',
] as const;

/** Label for a 1-based period number. */
export function periodLabel(period: number): string {
  return PERIOD_LABELS[period - 1] ?? `الحصة ${period}`;
}

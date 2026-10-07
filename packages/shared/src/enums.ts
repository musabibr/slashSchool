// Every enum the API, database and UI agree on. Database columns store these string values.

export const ROLES = ['admin', 'supervisor', 'teacher', 'guardian'] as const;
export type Role = (typeof ROLES)[number];
export const STAFF_ROLES = ['admin', 'supervisor', 'teacher'] as const satisfies readonly Role[];

export const USER_STATUSES = ['pending', 'active'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const GENDERS = ['male', 'female'] as const;
export type Gender = (typeof GENDERS)[number];

export const STUDENT_STATUSES = ['active', 'withdrawn', 'expelled'] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

export const RELATIONS = ['father', 'mother', 'brother', 'sister', 'uncle', 'grandparent', 'other'] as const;
export type Relation = (typeof RELATIONS)[number];

export const EXAM_PERIOD_KINDS = ['weekly', 'monthly', 'term', 'final'] as const;
export type ExamPeriodKind = (typeof EXAM_PERIOD_KINDS)[number];

/** `quiz` = a standalone announced test (اختبار); the rest belong to an exam period. */
export const ASSESSMENT_KINDS = ['quiz', ...EXAM_PERIOD_KINDS] as const;
export type AssessmentKind = (typeof ASSESSMENT_KINDS)[number];

export const EVALUATION_RATINGS = ['excellent', 'calm', 'needs_attention', 'disruptive'] as const;
export type EvaluationRating = (typeof EVALUATION_RATINGS)[number];

export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'bankak', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const AUDIENCE_TYPES = ['school', 'grade_level', 'class_section', 'student'] as const;
export type AudienceType = (typeof AUDIENCE_TYPES)[number];

export const CALENDAR_KINDS = ['holiday', 'event', 'exam', 'meeting'] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];

/** Modules that show an unread badge on the guardian home menu (P3). */
export const BADGE_MODULES = [
  'lessons',
  'homework',
  'attendance',
  'fees',
  'exams',
  'results',
  'behavior',
  'calendar',
  'announcements',
] as const;
export type BadgeModule = (typeof BADGE_MODULES)[number];

export const INSTALLMENT_STATUSES = ['paid', 'partial', 'late', 'upcoming'] as const;
export type InstallmentStatus = (typeof INSTALLMENT_STATUSES)[number];

export const DATE_RANGES = ['today', 'week', 'month', 'all'] as const;
export type DateRange = (typeof DATE_RANGES)[number];

/** 0 = Sunday … 6 = Saturday (same as JS Date#getDay). */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const MAX_PERIODS_PER_DAY = 8;

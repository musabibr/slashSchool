import Papa from 'papaparse';
import {
  GENDER_LABELS,
  GENDERS,
  RELATION_LABELS,
  RELATIONS,
  STUDENT_STATUS_LABELS,
  isValidPhone,
  type StudentStatus,
  type UserStatus,
} from '@slash/shared';

export const PAGE_SIZE = 25;

export const STUDENT_STATUS_COLORS: Record<StudentStatus, string> = {
  active: 'teal',
  withdrawn: 'gray',
  expelled: 'red',
};

export const USER_STATUS_LABELS: Record<UserStatus, string> = { active: 'مفعل', pending: 'غير مفعل' };
export const USER_STATUS_COLORS: Record<UserStatus, string> = { active: 'teal', pending: 'orange' };

export const GENDER_OPTIONS = GENDERS.map((g) => ({ value: g, label: GENDER_LABELS[g] }));
export const RELATION_OPTIONS = RELATIONS.map((r) => ({ value: r, label: RELATION_LABELS[r] }));
export const STUDENT_STATUS_OPTIONS = (Object.keys(STUDENT_STATUS_LABELS) as StudentStatus[]).map((s) => ({
  value: s,
  label: STUDENT_STATUS_LABELS[s],
}));

/** Form validator for an optional phone. */
export const optionalPhone = (v: string) => (!v.trim() || isValidPhone(v) ? null : 'رقم الهاتف غير صالح');
/** Form validator for a required phone. */
export const requiredPhone = (v: string) =>
  !v.trim() ? 'رقم الهاتف مطلوب' : isValidPhone(v) ? null : 'رقم الهاتف غير صالح';
export const required = (message = 'هذا الحقل مطلوب') => (v: string | null) => (v && v.trim() ? null : message);

/** '' → null, otherwise trimmed. */
export const orNull = (v: string) => v.trim() || null;

/** "أحمد" / "أحمد وسارة" / "أحمد وسارة ومريم" */
export function joinArabicList(names: string[]): string {
  return names.filter(Boolean).join(' و');
}

/** The link the guardian opens to activate (the code is prefilled where the activation screen supports it). */
export function activationUrl(code: string): string {
  return `${window.location.origin}/activate?code=${encodeURIComponent(code)}`;
}

/** WhatsApp text that goes with a guardian's activation code. */
export function activationMessage(opts: { guardianName: string; students: string[]; schoolName: string; code: string }) {
  const students = joinArabicList(opts.students) || 'أبنائكم';
  return `مرحباً ${opts.guardianName}، تم تسجيل ${students} في ${opts.schoolName}. رمز تفعيل تطبيق سلاش سكول: ${opts.code} — للتفعيل افتح ${activationUrl(opts.code)}`;
}

/** WhatsApp text that goes with a student link code ("+" in the guardian app). */
export function linkCodeMessage(opts: { studentName: string; schoolName: string; code: string }) {
  return `رمز ربط الطالب ${opts.studentName} (${opts.schoolName}) بحسابك في تطبيق سلاش سكول: ${opts.code} — من قائمة الأبناء اضغط "+" وأدخل الرمز`;
}

/** Downloads rows as a UTF-8 CSV (with BOM so Excel shows Arabic correctly). */
export function downloadCsv(fileName: string, header: string[], rows: Array<Array<string | number | null>>) {
  const csv = Papa.unparse({ fields: header, data: rows.map((r) => r.map((v) => (v === null ? '' : String(v)))) });
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

// ───────────────────────────── Demo data (demo mode: fewer things to type) ─────────────────────────────

const MALE_NAMES = ['أحمد', 'محمد', 'عمر', 'يوسف', 'خالد', 'عثمان', 'إبراهيم', 'مصطفى', 'الطيب', 'حسن', 'صلاح', 'معتز'];
const FEMALE_NAMES = ['سارة', 'فاطمة', 'مريم', 'آمنة', 'هبة', 'رنا', 'ريم', 'سلمى', 'تسنيم', 'هديل', 'إسراء', 'زينب'];
const OCCUPATIONS = ['موظف', 'مهندس', 'معلم', 'طبيب', 'تاجر', 'محاسب'];
const WORKPLACES = ['الخرطوم', 'أم درمان', 'بحري', 'السوق العربي', 'المنطقة الصناعية'];
const LOCALITIES = ['كرري', 'أم درمان', 'الخرطوم', 'بحري', 'شرق النيل', 'جبل أولياء'];
const RESIDENCES = ['الحتانة', 'الثورة', 'المهدية', 'الصحافة', 'الرياض', 'شمبات', 'الكلاكلة'];

export const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];

/** A random Sudanese mobile number in the 0912… range. */
export const randomPhone = () => `091${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`;

export function demoPerson() {
  const gender = Math.random() < 0.5 ? ('male' as const) : ('female' as const);
  const father = pick(MALE_NAMES);
  const grandfather = pick(MALE_NAMES.filter((n) => n !== father));
  const great = pick(MALE_NAMES);
  const year = 2010 + Math.floor(Math.random() * 8);
  const month = 1 + Math.floor(Math.random() * 12);
  const day = 1 + Math.floor(Math.random() * 28);
  const phone = randomPhone();
  return {
    gender,
    firstName: pick(gender === 'male' ? MALE_NAMES : FEMALE_NAMES),
    fatherName: father,
    grandfatherName: grandfather,
    greatGrandfatherName: great,
    birthDate: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    guardian: {
      firstName: father,
      fatherName: grandfather,
      grandfatherName: great,
      greatGrandfatherName: pick(MALE_NAMES),
      phone,
      whatsapp: phone,
      occupation: pick(OCCUPATIONS),
      workplace: pick(WORKPLACES),
      locality: pick(LOCALITIES),
      residence: pick(RESIDENCES),
    },
    mother: {
      firstName: pick(FEMALE_NAMES),
      fatherName: pick(MALE_NAMES),
      grandfatherName: pick(MALE_NAMES),
      phone: randomPhone(),
    },
  };
}

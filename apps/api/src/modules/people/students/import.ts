import { and, eq, inArray } from 'drizzle-orm';
import {
  GENDER_LABELS,
  isIsoDate,
  isValidPhone,
  normalizePhone,
  RELATION_LABELS,
  RELATIONS,
  type Gender,
  type Relation,
} from '@slash/shared';
import type { Db } from '../../../db/client';
import { classSections, gradeLevels, memberships, studentGuardians, students, users } from '../../../db/schema';
import { currentAcademicYear } from '../../../lib/scope';
import type { ImportRowInput } from './schemas';
import {
  chunks,
  codeIssuers,
  issueActivationCodes,
  lockStudentCodes,
  nextStudentNumber,
  normalizeArabic,
  studentCode,
  studentFullName,
} from './service';

export interface ImportRowError {
  /** 1-based position in `rows`. */
  row: number;
  messages: string[];
}

/** One guardian account's activation code after an import (the CSV the director downloads). */
export interface ImportCode {
  guardianName: string;
  phone: string;
  code: string;
  /** Names of the students imported for this guardian. */
  students: string[];
}

interface PreparedRow {
  row: number;
  firstName: string;
  fatherName: string;
  grandfatherName: string;
  greatGrandfatherName: string | null;
  gender: Gender;
  birthDate: string | null;
  gradeLevelId: string;
  classSectionId: string | null;
  guardianName: string;
  guardianPhone: string;
  relation: Relation;
  motherName: string | null;
  motherPhone: string | null;
}

// ───────────────────────────── Value parsing ─────────────────────────────

/** Lookup key: Arabic letter variants unified, lower-case, no spaces around separators. */
const key = (v: string) =>
  normalizeArabic(v)
    .toLowerCase()
    .replace(/\s*([-/])\s*/g, '$1');

/** "الصف الخامس" and "الخامس" both match the grade level "الصف الخامس". */
const gradeKey = (v: string) => key(v).replace(/^(ال)?صف\s+/, '');

const GENDER_WORDS: Record<string, Gender> = {};
for (const [g, words] of [
  ['male', ['male', 'm', GENDER_LABELS.male, 'ذكر', 'ولد', 'طالب']],
  ['female', ['female', 'f', GENDER_LABELS.female, 'انثى', 'انثي', 'بنت', 'طالبة']],
] as const) {
  for (const w of words) GENDER_WORDS[key(w)] = g;
}

const RELATION_WORDS: Record<string, Relation> = {};
const RELATION_EXTRA: Record<Relation, string[]> = {
  father: ['الوالد', 'اب', 'أب', 'الأب', 'ابو', 'أبو'],
  mother: ['الوالدة', 'ام', 'أم', 'الأم'],
  brother: ['الأخ', 'شقيق'],
  sister: ['الأخت', 'شقيقة'],
  uncle: ['عم', 'خال', 'العم', 'الخال'],
  grandparent: ['جد', 'جدة', 'الجد', 'الجدة'],
  other: ['آخر', 'اخري'],
};
for (const r of RELATIONS) {
  for (const w of [r, RELATION_LABELS[r], ...RELATION_EXTRA[r]]) RELATION_WORDS[key(w)] = r;
}

/** YYYY-MM-DD, D/M/YYYY or D-M-YYYY (as spreadsheets export them) → YYYY-MM-DD, else null. */
export function parseImportDate(value: string): string | null {
  const v = value.trim();
  let y: string, m: string, d: string;
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(v);
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(v);
  if (iso) [, y, m, d] = iso;
  else if (dmy) [, d, m, y] = dmy;
  else return null;
  const out = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return isIsoDate(out) ? out : null;
}

// ───────────────────────────── Validation ─────────────────────────────

interface SchoolCatalog {
  /** gradeKey → grade levels with that name (more than one = ambiguous across stages). */
  grades: Map<string, Array<{ id: string; name: string }>>;
  /** gradeLevelId → section key → class id (current academic year). */
  sections: Map<string, Map<string, string>>;
  /** "first|father|grandfather|phone" keys of students already registered. */
  existing: Set<string>;
}

const duplicateKey = (first: string, father: string, grandfather: string, phone: string) =>
  [first, father, grandfather].map(key).join('|') + `|${phone}`;

async function loadCatalog(db: Db, schoolId: string): Promise<SchoolCatalog> {
  const year = await currentAcademicYear(db, schoolId);
  const [gradeRows, classRows, existingRows] = await Promise.all([
    db
      .select({ id: gradeLevels.id, name: gradeLevels.name })
      .from(gradeLevels)
      .where(eq(gradeLevels.schoolId, schoolId)),
    year
      ? db
          .select({ id: classSections.id, name: classSections.name, gradeLevelId: classSections.gradeLevelId })
          .from(classSections)
          .where(and(eq(classSections.schoolId, schoolId), eq(classSections.academicYearId, year.id)))
      : Promise.resolve([]),
    db
      .select({
        firstName: students.firstName,
        fatherName: students.fatherName,
        grandfatherName: students.grandfatherName,
        phone: users.phone,
      })
      .from(students)
      .innerJoin(studentGuardians, eq(studentGuardians.studentId, students.id))
      .innerJoin(users, eq(users.id, studentGuardians.userId))
      .where(eq(students.schoolId, schoolId)),
  ]);
  const grades = new Map<string, Array<{ id: string; name: string }>>();
  for (const g of gradeRows) {
    const k = gradeKey(g.name);
    grades.set(k, [...(grades.get(k) ?? []), g]);
  }
  const sections = new Map<string, Map<string, string>>();
  for (const c of classRows) {
    const byName = sections.get(c.gradeLevelId) ?? new Map<string, string>();
    byName.set(key(c.name), c.id);
    sections.set(c.gradeLevelId, byName);
  }
  const existing = new Set(
    existingRows.map((r) => duplicateKey(r.firstName, r.fatherName, r.grandfatherName, r.phone)),
  );
  return { grades, sections, existing };
}

const MAX_NAME = 60;
const MAX_LONG = 150;

/**
 * Validates every row (collecting all messages per row rather than stopping at the first) and resolves
 * grade levels, classes, genders, relations, dates and phones.
 */
export async function prepareImport(
  db: Db,
  schoolId: string,
  rows: ImportRowInput[],
  today: string,
): Promise<{ prepared: PreparedRow[]; errors: ImportRowError[] }> {
  const catalog = await loadCatalog(db, schoolId);
  const prepared: PreparedRow[] = [];
  const errors: ImportRowError[] = [];
  const seen = new Map<string, number>();

  rows.forEach((raw, i) => {
    const rowNo = i + 1;
    const messages: string[] = [];
    const required = (value: string, label: string, max = MAX_NAME) => {
      if (!value) messages.push(`${label} مطلوب`);
      else if (value.length > max) messages.push(`${label} أطول من المسموح`);
      return value;
    };
    const optional = (value: string, label: string, max = MAX_NAME) => {
      if (value.length > max) messages.push(`${label} أطول من المسموح`);
      return value || null;
    };

    const firstName = required(raw.studentFirstName, 'الاسم الأول للطالب');
    const fatherName = required(raw.studentFatherName, 'الاسم الثاني للطالب');
    const grandfatherName = required(raw.studentGrandfatherName, 'الاسم الثالث للطالب');
    const greatGrandfatherName = optional(raw.studentGreatGrandfatherName, 'الاسم الرابع للطالب');
    const guardianName = required(raw.guardianName, 'اسم ولي الأمر', MAX_LONG);
    const motherName = optional(raw.motherName, 'اسم الوالدة', MAX_LONG);

    let gender: Gender | null = null;
    if (!raw.gender) messages.push('الجنس مطلوب');
    else {
      gender = GENDER_WORDS[key(raw.gender)] ?? null;
      if (!gender) messages.push(`الجنس "${raw.gender}" غير معروف (ذكر / أنثى)`);
    }

    let relation: Relation = 'father';
    if (raw.relation) {
      const found = RELATION_WORDS[key(raw.relation)];
      if (found) relation = found;
      else messages.push(`صلة القرابة "${raw.relation}" غير معروفة`);
    }

    let birthDate: string | null = null;
    if (raw.birthDate) {
      birthDate = parseImportDate(raw.birthDate);
      if (!birthDate) messages.push(`تاريخ الميلاد "${raw.birthDate}" غير صالح (YYYY-MM-DD)`);
      else if (birthDate >= today) messages.push('تاريخ الميلاد يجب أن يكون قبل اليوم');
    }

    let guardianPhone = '';
    if (!raw.guardianPhone) messages.push('رقم ولي الأمر مطلوب');
    else if (!isValidPhone(raw.guardianPhone)) messages.push(`رقم ولي الأمر "${raw.guardianPhone}" غير صالح`);
    else guardianPhone = normalizePhone(raw.guardianPhone);

    let motherPhone: string | null = null;
    if (raw.motherPhone) {
      if (!isValidPhone(raw.motherPhone)) messages.push(`رقم الوالدة "${raw.motherPhone}" غير صالح`);
      else motherPhone = normalizePhone(raw.motherPhone);
    }

    // Grade level (and optionally the section, also accepted as "الصف الخامس - أ" in the grade column).
    let gradeLevelId: string | null = null;
    let gradeName = raw.gradeLevel;
    let classSectionId: string | null = null;
    let sectionName = raw.classSection;
    if (!raw.gradeLevel) messages.push('السنة الدراسية مطلوبة');
    else {
      let matches = catalog.grades.get(gradeKey(raw.gradeLevel)) ?? [];
      const split = /^(.*\S)\s*-\s*(\S+)$/.exec(raw.gradeLevel);
      if (!matches.length && split && !sectionName) {
        matches = catalog.grades.get(gradeKey(split[1])) ?? [];
        if (matches.length) sectionName = split[2];
      }
      if (!matches.length) messages.push(`السنة الدراسية "${raw.gradeLevel}" غير موجودة`);
      else if (matches.length > 1) messages.push(`السنة الدراسية "${raw.gradeLevel}" موجودة في أكثر من مرحلة`);
      else {
        gradeLevelId = matches[0].id;
        gradeName = matches[0].name;
      }
    }
    if (gradeLevelId && sectionName) {
      classSectionId = catalog.sections.get(gradeLevelId)?.get(key(sectionName)) ?? null;
      if (!classSectionId) messages.push(`الفصل "${sectionName}" غير موجود في ${gradeName}`);
    }

    if (firstName && fatherName && grandfatherName && guardianPhone) {
      const dup = duplicateKey(firstName, fatherName, grandfatherName, guardianPhone);
      if (catalog.existing.has(dup)) messages.push('الطالب مسجل مسبقاً بنفس الاسم ورقم ولي الأمر');
      else if (seen.has(dup)) messages.push(`الطالب مكرر في الملف (الصف ${seen.get(dup)})`);
      else seen.set(dup, rowNo);
    }

    if (messages.length || !gender || !gradeLevelId) {
      errors.push({ row: rowNo, messages });
      return;
    }
    prepared.push({
      row: rowNo,
      firstName,
      fatherName,
      grandfatherName,
      greatGrandfatherName,
      gender,
      birthDate,
      gradeLevelId,
      classSectionId,
      guardianName,
      guardianPhone,
      relation,
      motherName,
      motherPhone,
    });
  });

  return { prepared, errors };
}

// ───────────────────────────── Import ─────────────────────────────

const BATCH = 500;

/**
 * Imports validated rows inside the caller's transaction: allocates "S-{n}" codes, creates or reuses
 * guardian accounts (one per phone), links them as primary guardians and issues activation codes to
 * accounts that are not activated yet. Bulk statements keep a 2,000-row file to a few dozen queries.
 */
export async function executeImport(
  tx: Db,
  schoolId: string,
  actorId: string,
  rows: PreparedRow[],
  today: string,
): Promise<{ created: number; codes: ImportCode[] }> {
  await lockStudentCodes(tx, schoolId);
  let n = await nextStudentNumber(tx, schoolId);

  // Guardian accounts: reuse by phone, create the rest with the name from their first row.
  const phones = [...new Set(rows.map((r) => r.guardianPhone))];
  const userByPhone = new Map<string, typeof users.$inferSelect>();
  for (const batch of chunks(phones, BATCH)) {
    for (const u of await tx.select().from(users).where(inArray(users.phone, batch))) userByPhone.set(u.phone, u);
  }
  const nameByPhone = new Map<string, string>();
  for (const r of rows) if (!nameByPhone.has(r.guardianPhone)) nameByPhone.set(r.guardianPhone, r.guardianName);
  const missing = phones.filter((p) => !userByPhone.has(p));
  for (const batch of chunks(missing, BATCH)) {
    const values = batch.map((phone) => ({ phone, fullName: nameByPhone.get(phone)! }));
    for (const u of await tx.insert(users).values(values).returning()) userByPhone.set(u.phone, u);
  }
  const guardianIds = [...userByPhone.values()].map((u) => u.id);
  for (const batch of chunks(guardianIds, BATCH)) {
    await tx
      .insert(memberships)
      .values(batch.map((userId) => ({ userId, schoolId, role: 'guardian' as const })))
      .onConflictDoNothing();
  }

  // Students, then their guardian links (matched back by code).
  const withCodes = rows.map((r) => ({ ...r, code: studentCode(n++) }));
  const idByCode = new Map<string, string>();
  for (const batch of chunks(withCodes, BATCH)) {
    const inserted = await tx
      .insert(students)
      .values(
        batch.map((r) => ({
          schoolId,
          code: r.code,
          firstName: r.firstName,
          fatherName: r.fatherName,
          grandfatherName: r.grandfatherName,
          greatGrandfatherName: r.greatGrandfatherName,
          gender: r.gender,
          birthDate: r.birthDate,
          gradeLevelId: r.gradeLevelId,
          classSectionId: r.classSectionId,
          motherName: r.motherName,
          motherPhone: r.motherPhone,
          registeredAt: today,
        })),
      )
      .returning({ id: students.id, code: students.code });
    for (const s of inserted) idByCode.set(s.code, s.id);
  }
  for (const batch of chunks(withCodes, BATCH)) {
    await tx.insert(studentGuardians).values(
      batch.map((r) => ({
        schoolId,
        studentId: idByCode.get(r.code)!,
        userId: userByPhone.get(r.guardianPhone)!.id,
        relation: r.relation,
        isPrimary: true,
      })),
    );
  }

  // Activation codes for accounts not activated yet (and that this school may issue codes to).
  const issuers = await codeIssuers(tx, schoolId, guardianIds);
  const pending = phones.map((p) => userByPhone.get(p)!).filter((u) => u.status === 'pending' && issuers.has(u.id));
  const issued = await issueActivationCodes(
    tx,
    pending.map((u) => u.id),
    actorId,
  );
  const childrenByPhone = new Map<string, string[]>();
  for (const r of withCodes) childrenByPhone.set(r.guardianPhone, [...(childrenByPhone.get(r.guardianPhone) ?? []), studentFullName(r)]);
  const codes: ImportCode[] = pending.map((u) => ({
    guardianName: u.fullName,
    phone: u.phone,
    code: issued.get(u.id)!.code,
    students: childrenByPhone.get(u.phone) ?? [],
  }));
  return { created: withCodes.length, codes };
}

import { addDays, type Gender, type Relation, type Role } from '@slash/shared';
import { hashCode } from '../../lib/security';
import { DEMO_ACCOUNTS, DEMO_ACTIVATION, DEMO_LINK_CODE, DEMO_SCHOOLS } from '../demo-accounts';
import {
  ELDER_NAMES,
  EXTRA_SUPERVISOR,
  EXTRA_TEACHERS,
  FEE_INSTALLMENTS,
  FEMALE_JOBS,
  FEMALE_NAMES,
  GUARDIAN_RELATIONS,
  LOCALITIES,
  MALE_JOBS,
  MALE_NAMES,
  PHONE_PREFIXES,
  SCHOOL_DEFS,
  type TeacherKey,
} from './content';
import type {
  ClassModel,
  DemoChild,
  DemoContext,
  Family,
  GradeModel,
  SchoolModel,
  StudentModel,
  World,
} from './context';
import { minDate } from './time';

const MIN_CLASS_SIZE = 18;
const MAX_CLASS_SIZE = 24;
const FEMALE_SHARE = 0.6;
const ACTIVE_GUARDIAN_SHARE = 0.25;
/** Sibling pairs (same guardian) per school; the younger one gets a 10% discount. */
const SIBLING_PAIRS: Record<SchoolModel['key'], number> = { middle: 4, secondary: 2 };
const SIBLING_DISCOUNT = 0.1;
const ACTIVATION_CODE_TTL_MS = 3650 * 86_400_000;

const planTotal = (key: SchoolModel['key']) => FEE_INSTALLMENTS[key].reduce((a, b) => a + b, 0);

/** Name combinations reserved for the scripted families. */
const RESERVED_LINEAGES = new Set(['إبراهيم|عبدالله', 'عوض|محمد']);

function demoAccount(role: (typeof DEMO_ACCOUNTS)[number]['role']) {
  const account = DEMO_ACCOUNTS.find((a) => a.role === role);
  if (!account) throw new Error(`demo account missing: ${role}`);
  return account;
}

interface SpecialStudent {
  classKey: string;
  firstName: string;
  gender: Gender;
  family: Family;
  ability: number;
  /** Years since registration. */
  yearsAgo: number;
  demo?: DemoChild;
  discount?: number;
  linkCode?: boolean;
}

/**
 * Schools, structure, staff, students and guardians. Returns the modelled world the other builders
 * use; every row goes to `ctx.rows`.
 */
export function buildPeople(ctx: DemoContext): World {
  const { rows, ids, year, today, dates } = ctx;
  const rng = ctx.rng.fork('people');

  const usedPhones = new Set<string>([
    ...DEMO_ACCOUNTS.map((a) => a.phone),
    DEMO_ACTIVATION.phone,
    EXTRA_SUPERVISOR.phone,
    ...Object.values(EXTRA_TEACHERS).map((t) => t.phone),
  ]);
  const newPhone = () => {
    for (;;) {
      const phone = `${rng.pick(PHONE_PREFIXES)}${String(rng.int(0, 9_999_999)).padStart(7, '0')}`;
      if (!usedPhones.has(phone)) {
        usedPhones.add(phone);
        return phone;
      }
    }
  };

  /** A login during the last week: staff in the morning, guardians in the evening. */
  const recentLogin = (fromHour: number) =>
    ctx.cal.at(rng.pick(dates.recent.slice(0, 6)), fromHour + rng.int(0, 3), rng.int(0, 59));

  // ── Staff ──
  const activeUser = (phone: string, fullName: string) => {
    const id = ids.next();
    rows.users.push({ id, phone, fullName, pinHash: ctx.pinHash, status: 'active', lastLoginAt: recentLogin(7) });
    return id;
  };
  const adminId = activeUser(demoAccount('admin').phone, demoAccount('admin').fullName);
  const supervisorId = activeUser(demoAccount('supervisor').phone, demoAccount('supervisor').fullName);
  const teacherId = activeUser(demoAccount('teacher').phone, demoAccount('teacher').fullName);
  const guardianAccount = demoAccount('guardian');
  const guardianId = activeUser(guardianAccount.phone, guardianAccount.fullName);
  const extraSupervisorId = activeUser(EXTRA_SUPERVISOR.phone, EXTRA_SUPERVISOR.fullName);
  const teacherIds = new Map<TeacherKey, string>([['demo', teacherId]]);
  for (const key of Object.keys(EXTRA_TEACHERS) as Array<keyof typeof EXTRA_TEACHERS>) {
    teacherIds.set(key, activeUser(EXTRA_TEACHERS[key].phone, EXTRA_TEACHERS[key].fullName));
  }
  const teacherFor = (key: TeacherKey) => {
    const id = teacherIds.get(key);
    if (!id) throw new Error(`demo teacher missing: ${key}`);
    return id;
  };

  const membershipKeys = new Set<string>();
  const addMembership = (userId: string, schoolId: string, role: Role) => {
    const key = `${userId}|${schoolId}|${role}`;
    if (membershipKeys.has(key)) return;
    membershipKeys.add(key);
    rows.memberships.push({ id: ids.next(), userId, schoolId, role });
  };

  // ── Schools and structure ──
  const schools: SchoolModel[] = SCHOOL_DEFS.map((def) => {
    const meta = DEMO_SCHOOLS[def.key];
    const id = ids.next();
    rows.schools.push({
      id,
      name: meta.name,
      code: meta.code,
      timezone: 'Africa/Khartoum',
      weekStart: 0,
      phone: def.phone,
      address: def.address,
    });
    const academicYearId = ids.next();
    rows.academicYears.push({
      id: academicYearId,
      schoolId: id,
      name: year.name,
      startsOn: year.startsOn,
      endsOn: year.endsOn,
      isCurrent: true,
    });
    const stageId = ids.next();
    rows.stages.push({ id: stageId, schoolId: id, name: def.stage, sort: 1 });

    const school: SchoolModel = {
      id,
      key: def.key,
      name: meta.name,
      def,
      academicYearId,
      subjects: [],
      grades: [],
      classes: [],
      supervisorIds: def.key === 'middle' ? [supervisorId, extraSupervisorId] : [supervisorId],
    };
    school.subjects = def.subjects.map((subjectDef, i) => {
      const subjectId = ids.next();
      rows.subjects.push({ id: subjectId, schoolId: id, name: subjectDef.name, sort: i + 1 });
      return { id: subjectId, def: subjectDef };
    });

    def.grades.forEach((gradeDef, gradeIndex) => {
      const gradeId = ids.next();
      rows.gradeLevels.push({ id: gradeId, schoolId: id, stageId, name: gradeDef.name, sort: gradeIndex + 1 });
      const grade: GradeModel = { id: gradeId, def: gradeDef, index: gradeIndex, classes: [] };
      for (const classDef of gradeDef.classes) {
        const classId = ids.next();
        rows.classSections.push({
          id: classId,
          schoolId: id,
          academicYearId,
          gradeLevelId: gradeId,
          name: classDef.section,
        });
        const cls: ClassModel = {
          id: classId,
          key: `${def.key}:${gradeDef.name}:${classDef.section}`,
          label: `${gradeDef.name} - ${classDef.section}`,
          def: classDef,
          school,
          grade,
          index: school.classes.length,
          teacherOf: new Map(),
          students: [],
        };
        for (const subject of school.subjects) {
          const teacherKey = classDef.teachers[subject.def.name];
          if (!teacherKey) throw new Error(`no teacher for ${subject.def.name} in ${cls.label}`);
          const assigned = teacherFor(teacherKey);
          cls.teacherOf.set(subject.id, assigned);
          rows.teachingAssignments.push({
            id: ids.next(),
            schoolId: id,
            classSectionId: classId,
            subjectId: subject.id,
            teacherId: assigned,
          });
          addMembership(assigned, id, 'teacher');
        }
        grade.classes.push(cls);
        school.classes.push(cls);
      }
      school.grades.push(grade);
    });

    addMembership(adminId, id, 'admin');
    for (const sup of school.supervisorIds) addMembership(sup, id, 'supervisor');
    addMembership(guardianId, id, 'guardian');
    return school;
  });
  const [middle, secondary] = schools;
  const classByKey = new Map(schools.flatMap((sc) => sc.classes.map((c) => [c.key, c] as const)));
  const classAt = (key: string) => {
    const cls = classByKey.get(key);
    if (!cls) throw new Error(`demo class missing: ${key}`);
    return cls;
  };

  // ── Families ──
  const pickLocality = () =>
    rng.weighted(LOCALITIES.map((l) => [l, l.locality === 'كرري' ? 8 : l.locality === 'أم درمان' ? 4 : 1] as const));
  /** The guardian's own name, consistent with the child's lineage. */
  const guardianName = (
    relation: Relation,
    f: Pick<Family, 'fatherName' | 'grandfatherName' | 'greatGrandfatherName' | 'motherName'>,
  ): string => {
    switch (relation) {
      case 'mother':
        return f.motherName;
      case 'uncle':
        return `${rng.pick(ELDER_NAMES)} ${f.grandfatherName} ${f.greatGrandfatherName}`;
      case 'brother':
        return `${rng.pick(MALE_NAMES)} ${f.fatherName} ${f.grandfatherName}`;
      case 'sister':
        return `${rng.pick(FEMALE_NAMES)} ${f.fatherName} ${f.grandfatherName}`;
      case 'grandparent':
        return `${f.grandfatherName} ${f.greatGrandfatherName} ${rng.pick(ELDER_NAMES)}`;
      default:
        return `${f.fatherName} ${f.grandfatherName} ${f.greatGrandfatherName}`;
    }
  };
  const newFamily = (): Family => {
    let fatherName: string;
    let grandfatherName: string;
    do {
      fatherName = rng.pick(ELDER_NAMES);
      grandfatherName = rng.pick(ELDER_NAMES);
    } while (fatherName === grandfatherName || RESERVED_LINEAGES.has(`${fatherName}|${grandfatherName}`));
    const greatGrandfatherName = rng.pick(ELDER_NAMES);
    const motherName = `${rng.pick(FEMALE_NAMES)} ${rng.pick(ELDER_NAMES)} ${rng.pick(ELDER_NAMES)}`;
    const relation = rng.weighted(GUARDIAN_RELATIONS);
    const fullName = guardianName(relation, { fatherName, grandfatherName, greatGrandfatherName, motherName });
    const female = relation === 'mother' || relation === 'sister';
    const [occupation, workplace] = rng.pick(female ? FEMALE_JOBS : MALE_JOBS);
    const place = pickLocality();
    const phone = newPhone();
    return {
      guardianId: ids.next(),
      phone,
      fullName,
      active: rng.chance(ACTIVE_GUARDIAN_SHARE),
      relation,
      fatherName,
      grandfatherName,
      greatGrandfatherName,
      motherName,
      motherPhone: relation === 'mother' ? phone : rng.chance(0.5) ? newPhone() : null,
      occupation,
      workplace,
      locality: place.locality,
      residence: rng.pick(place.residences),
      whatsapp: rng.chance(0.85) ? phone : null,
    };
  };

  const motherPhone = newPhone();
  const demoFamily: Family = {
    guardianId,
    phone: guardianAccount.phone,
    fullName: guardianAccount.fullName,
    active: true,
    relation: 'father',
    fatherName: 'إبراهيم',
    grandfatherName: 'عبدالله',
    greatGrandfatherName: 'أحمد',
    motherName: 'آمنة الطيب محمد',
    motherPhone,
    occupation: 'محاسب',
    workplace: 'بنك الخرطوم',
    locality: 'كرري',
    residence: 'الحتانة',
    whatsapp: guardianAccount.phone,
    external: true,
  };
  // Their mother is the guardian of record of a fourth child, whom the demo guardian can link with "+".
  const motherFamily: Family = {
    ...demoFamily,
    guardianId: ids.next(),
    phone: motherPhone,
    fullName: 'آمنة الطيب محمد',
    active: false,
    relation: 'mother',
    occupation: 'معلمة',
    workplace: 'مدرسة الحارة 21 الأساسية',
    whatsapp: motherPhone,
    external: false,
  };
  const activationFamily: Family = {
    guardianId: ids.next(),
    phone: DEMO_ACTIVATION.phone,
    fullName: DEMO_ACTIVATION.fullName,
    active: false,
    relation: 'father',
    fatherName: 'عوض',
    grandfatherName: 'محمد',
    greatGrandfatherName: 'أحمد',
    motherName: 'سمية عبدالقادر حسن',
    motherPhone: null,
    occupation: 'تاجر',
    workplace: 'سوق ليبيا',
    locality: 'أم بدة',
    residence: 'أم بدة الحارة 17',
    whatsapp: DEMO_ACTIVATION.phone,
  };

  const specials: SpecialStudent[] = [
    {
      classKey: 'middle:الصف الخامس:ب',
      firstName: 'مصعب',
      gender: 'male',
      family: demoFamily,
      ability: 0.68,
      yearsAgo: 2,
      demo: 'musab',
    },
    {
      classKey: 'middle:الصف السادس:أ',
      firstName: 'إسماعيل',
      gender: 'male',
      family: demoFamily,
      ability: 0.8,
      yearsAgo: 3,
      demo: 'ismail',
      discount: planTotal('middle') * SIBLING_DISCOUNT,
    },
    {
      classKey: 'secondary:الصف الأول الثانوي:أ',
      firstName: 'محمد',
      gender: 'male',
      family: demoFamily,
      ability: 0.86,
      yearsAgo: 0,
      demo: 'mohamed',
    },
    {
      classKey: 'secondary:الصف الثاني الثانوي:أ',
      firstName: 'سلمى',
      gender: 'female',
      family: motherFamily,
      ability: 0.84,
      yearsAgo: 1,
      linkCode: true,
    },
    {
      classKey: 'middle:الصف الخامس:أ',
      firstName: 'هبة',
      gender: 'female',
      family: activationFamily,
      ability: 0.72,
      yearsAgo: 1,
    },
  ];

  // ── Students ──
  const students: StudentModel[] = [];
  const linkCodeStudents = new Set<string>();
  const children: Partial<Record<DemoChild, StudentModel>> = {};
  const registeredOn = (yearsAgo: number) =>
    minDate(addDays(`${year.startYear - yearsAgo}-06-01`, rng.int(0, 45)), today);
  const bornOn = (age: number) => addDays(`${year.startYear - age}-07-01`, -rng.int(1, 365));
  const makeStudent = (
    cls: ClassModel,
    init: Pick<StudentModel, 'firstName' | 'gender' | 'family' | 'ability'> & { yearsAgo: number },
  ): StudentModel => {
    const student: StudentModel = {
      id: ids.next(),
      school: cls.school,
      cls,
      firstName: init.firstName,
      gender: init.gender,
      family: init.family,
      ability: init.ability,
      registeredAt: registeredOn(init.yearsAgo),
      birthDate: bornOn(cls.grade.def.age + (rng.chance(0.2) ? 1 : 0)),
      discount: 0,
    };
    cls.students.push(student);
    students.push(student);
    return student;
  };

  for (const sp of specials) {
    const student = makeStudent(classAt(sp.classKey), sp);
    student.special = true;
    student.discount = sp.discount ?? 0;
    if (sp.demo) {
      student.demo = sp.demo;
      children[sp.demo] = student;
    }
    if (sp.linkCode) linkCodeStudents.add(student.id);
  }
  for (const school of schools) {
    for (const cls of school.classes) {
      const size = rng.int(MIN_CLASS_SIZE, MAX_CLASS_SIZE);
      const taken = new Set(cls.students.map((st) => st.firstName));
      // Exactly ~60% girls in every class, in random order.
      const girls = Math.round(size * FEMALE_SHARE) - cls.students.filter((st) => st.gender === 'female').length;
      const genders = rng.shuffle(
        Array.from({ length: size - cls.students.length }, (_, i): Gender => (i < girls ? 'female' : 'male')),
      );
      for (const gender of genders) {
        const names = gender === 'female' ? FEMALE_NAMES : MALE_NAMES;
        let firstName: string;
        do firstName = rng.pick(names);
        while (taken.has(firstName));
        taken.add(firstName);
        const yearsAgo = rng.weighted([
          [cls.grade.index, 5],
          [cls.grade.index + 1, 2],
          [cls.grade.index + 2, 1],
          [Math.max(0, cls.grade.index - 1), 2],
        ]);
        // Skewed towards the middle: most students score 55–85%.
        const ability = 0.35 + 0.62 * ((rng.next() + rng.next() + rng.next()) / 3);
        makeStudent(cls, { firstName, gender, family: newFamily(), ability, yearsAgo });
      }
    }
  }

  // Siblings: the second child joins the first one's family; the younger gets a discount.
  for (const school of schools) {
    const pool = rng.shuffle(students.filter((st) => st.school === school && !st.special));
    const used = new Set<string>();
    for (let pair = 0; pair < SIBLING_PAIRS[school.key]; pair++) {
      const a = pool.find((st) => !used.has(st.id));
      const b = a && pool.find((st) => !used.has(st.id) && st.cls.grade.index !== a.cls.grade.index);
      if (!a || !b) break;
      used.add(a.id);
      used.add(b.id);
      b.family = a.family;
      const younger = a.cls.grade.index < b.cls.grade.index ? a : b;
      younger.discount = planTotal(school.key) * SIBLING_DISCOUNT;
    }
  }

  // Codes S-1, S-2, … per school in registration order.
  for (const school of schools) {
    const ordered = students
      .map((st, i) => ({ st, i }))
      .filter(({ st }) => st.school === school)
      .sort((x, y) => x.st.registeredAt.localeCompare(y.st.registeredAt) || x.i - y.i);
    ordered.forEach(({ st }, n) => {
      const f = st.family;
      rows.students.push({
        id: st.id,
        schoolId: school.id,
        code: `S-${n + 1}`,
        firstName: st.firstName,
        fatherName: f.fatherName,
        grandfatherName: f.grandfatherName,
        greatGrandfatherName: f.greatGrandfatherName,
        gender: st.gender,
        birthDate: st.birthDate,
        gradeLevelId: st.cls.grade.id,
        classSectionId: st.cls.id,
        status: 'active',
        motherName: f.motherName,
        motherPhone: f.motherPhone,
        motherWhatsapp: f.motherPhone,
        registeredAt: st.registeredAt,
        linkCodeHash: linkCodeStudents.has(st.id) ? hashCode(DEMO_LINK_CODE) : null,
      });
    });
  }

  // ── Guardians ──
  const emitted = new Set<string>();
  for (const st of students) {
    const f = st.family;
    if (!f.external && !emitted.has(f.guardianId)) {
      emitted.add(f.guardianId);
      rows.users.push({
        id: f.guardianId,
        phone: f.phone,
        fullName: f.fullName,
        pinHash: f.active ? ctx.pinHash : null,
        status: f.active ? 'active' : 'pending',
        lastLoginAt: f.active ? recentLogin(18) : null,
      });
    }
    addMembership(f.guardianId, st.school.id, 'guardian');
    rows.studentGuardians.push({
      id: ids.next(),
      schoolId: st.school.id,
      studentId: st.id,
      userId: f.guardianId,
      relation: f.relation,
      isPrimary: true,
      occupation: f.occupation,
      workplace: f.workplace,
      locality: f.locality,
      residence: f.residence,
      whatsapp: f.whatsapp,
      createdAt: dates.linkedAt,
    });
  }

  rows.activationCodes.push({
    id: ids.next(),
    userId: activationFamily.guardianId,
    codeHash: hashCode(DEMO_ACTIVATION.code),
    expiresAt: new Date(ctx.now.getTime() + ACTIVATION_CODE_TTL_MS),
    createdBy: adminId,
  });

  const { musab, ismail, mohamed } = children;
  if (!musab || !ismail || !mohamed) throw new Error('demo children missing');
  return {
    schools,
    middle,
    secondary,
    adminId,
    supervisorId,
    teacherId,
    guardianId,
    children: { musab, ismail, mohamed },
    students,
  };
}

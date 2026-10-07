import type { Gender, Relation } from '@slash/shared';
import * as s from '../../db/schema';
import type { ClassDef, GradeDef, SchoolDef, SubjectDef } from './content';
import type { IdFactory, Rng } from './random';
import type { AcademicYearDates, SchoolCalendar } from './time';

type Row<T extends { $inferInsert: unknown }> = T['$inferInsert'];

/** Every row of the demo dataset, per table, ready for chunked multi-row inserts. */
export interface DemoRows {
  schools: Row<typeof s.schools>[];
  users: Row<typeof s.users>[];
  memberships: Row<typeof s.memberships>[];
  activationCodes: Row<typeof s.activationCodes>[];
  academicYears: Row<typeof s.academicYears>[];
  stages: Row<typeof s.stages>[];
  gradeLevels: Row<typeof s.gradeLevels>[];
  classSections: Row<typeof s.classSections>[];
  subjects: Row<typeof s.subjects>[];
  teachingAssignments: Row<typeof s.teachingAssignments>[];
  students: Row<typeof s.students>[];
  studentGuardians: Row<typeof s.studentGuardians>[];
  lessons: Row<typeof s.lessons>[];
  homeworkDone: Row<typeof s.homeworkDone>[];
  attendanceSessions: Row<typeof s.attendanceSessions>[];
  absences: Row<typeof s.absences>[];
  examPeriods: Row<typeof s.examPeriods>[];
  assessments: Row<typeof s.assessments>[];
  scores: Row<typeof s.scores>[];
  regulations: Row<typeof s.regulations>[];
  behaviorIncidents: Row<typeof s.behaviorIncidents>[];
  evaluations: Row<typeof s.evaluations>[];
  feePlans: Row<typeof s.feePlans>[];
  planInstallments: Row<typeof s.planInstallments>[];
  studentFees: Row<typeof s.studentFees>[];
  payments: Row<typeof s.payments>[];
  announcements: Row<typeof s.announcements>[];
  calendarEvents: Row<typeof s.calendarEvents>[];
  timetableSlots: Row<typeof s.timetableSlots>[];
  readCursors: Row<typeof s.readCursors>[];
}

export function emptyRows(): DemoRows {
  return {
    schools: [],
    users: [],
    memberships: [],
    activationCodes: [],
    academicYears: [],
    stages: [],
    gradeLevels: [],
    classSections: [],
    subjects: [],
    teachingAssignments: [],
    students: [],
    studentGuardians: [],
    lessons: [],
    homeworkDone: [],
    attendanceSessions: [],
    absences: [],
    examPeriods: [],
    assessments: [],
    scores: [],
    regulations: [],
    behaviorIncidents: [],
    evaluations: [],
    feePlans: [],
    planInstallments: [],
    studentFees: [],
    payments: [],
    announcements: [],
    calendarEvents: [],
    timetableSlots: [],
    readCursors: [],
  };
}

/** A sitting window of an exam period (one per grade level, same dates for the whole school). */
export interface ExamWindow {
  name: string;
  /** School days of the sittings, oldest first (two subjects per day). */
  days: string[];
  createdAt: Date;
  /** null = results not published yet. */
  publishedAt: Date | null;
}

/** Key dates every builder agrees on, all relative to `today`. */
export interface DatePlan {
  /** Recent school days, newest first: [0] is the latest school day. */
  recent: string[];
  /** Guardians "last opened" each module at this instant, so only the last two school days look new. */
  cursorAt: Date;
  /** When the demo links (student_guardians) were created: today − 21 days. */
  linkedAt: Date;
  pastBreak: string[];
  futureBreak: string[];
  term: ExamWindow;
  lastMonthly: ExamWindow;
  upcomingMonthly: ExamWindow;
  /** Next school days after today, for announced quizzes (all before the upcoming exams). */
  quizDays: string[];
  /** "غداً إجتماع أولياء الأمور" is published on `meetingAnnouncedOn`; the meeting is the day after. */
  meetingAnnouncedOn: string;
  meetingOn: string;
}

export interface DemoContext {
  today: string;
  now: Date;
  cal: SchoolCalendar;
  year: AcademicYearDates;
  dates: DatePlan;
  ids: IdFactory;
  rng: Rng;
  /** DEMO_PIN hashed once and shared by every active demo user. */
  pinHash: string;
  rows: DemoRows;
}

// ───────────────────────────── The modelled world ─────────────────────────────

export interface Family {
  guardianId: string;
  phone: string;
  fullName: string;
  active: boolean;
  relation: Relation;
  /** The children's father, grandfather and great-grandfather (the student's name parts 2–4). */
  fatherName: string;
  grandfatherName: string;
  greatGrandfatherName: string;
  motherName: string;
  motherPhone: string | null;
  occupation: string | null;
  workplace: string | null;
  locality: string;
  residence: string;
  whatsapp: string | null;
  /** Users who are created elsewhere (the demo accounts) are not emitted again. */
  external?: boolean;
}

export type DemoChild = 'musab' | 'ismail' | 'mohamed';

export interface StudentModel {
  id: string;
  school: SchoolModel;
  cls: ClassModel;
  firstName: string;
  gender: Gender;
  family: Family;
  /** 0–1: drives scores. */
  ability: number;
  registeredAt: string;
  birthDate: string;
  /** Sibling discount on the fee plan (SDG). */
  discount: number;
  demo?: DemoChild;
  /** A student whose rows are scripted (demo children, the activation / link-code students). */
  special?: boolean;
}

export interface SubjectModel {
  id: string;
  def: SubjectDef;
}

export interface ClassModel {
  id: string;
  /** e.g. "middle:الصف الخامس:ب" */
  key: string;
  label: string;
  def: ClassDef;
  school: SchoolModel;
  grade: GradeModel;
  /** Position of the class in its school (0-based), used to stagger dates. */
  index: number;
  /** subjectId → teacher user id */
  teacherOf: Map<string, string>;
  students: StudentModel[];
}

export interface GradeModel {
  id: string;
  def: GradeDef;
  /** 0-based position inside the stage. */
  index: number;
  classes: ClassModel[];
}

export interface SchoolModel {
  id: string;
  key: SchoolDef['key'];
  name: string;
  def: SchoolDef;
  academicYearId: string;
  subjects: SubjectModel[];
  grades: GradeModel[];
  classes: ClassModel[];
  /** Supervisors who record attendance / behavior here. */
  supervisorIds: string[];
}

export interface World {
  schools: SchoolModel[];
  middle: SchoolModel;
  secondary: SchoolModel;
  adminId: string;
  supervisorId: string;
  teacherId: string;
  guardianId: string;
  children: Record<DemoChild, StudentModel>;
  students: StudentModel[];
}

export function subjectNamed(school: SchoolModel, name: string): SubjectModel {
  const subject = school.subjects.find((x) => x.def.name === name);
  if (!subject) throw new Error(`demo subject missing: ${name}`);
  return subject;
}

/** The teacher assigned to a subject in a class (every class × subject has one). */
export function teacherOf(cls: ClassModel, subjectId: string): string {
  const id = cls.teacherOf.get(subjectId);
  if (!id) throw new Error(`demo: no teacher for subject ${subjectId} in ${cls.label}`);
  return id;
}

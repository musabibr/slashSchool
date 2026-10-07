/**
 * Database schema (PostgreSQL). Every tenant table carries `school_id`.
 * Calendar dates are `date` columns read as 'YYYY-MM-DD' strings; instants are timestamptz.
 * Enum-like columns hold the string values defined in @slash/shared/enums.
 */
import {
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  AssessmentKind,
  AudienceType,
  CalendarKind,
  EvaluationRating,
  ExamPeriodKind,
  Gender,
  GradeBand,
  PaymentMethod,
  Relation,
  Role,
  StudentStatus,
  UserStatus,
} from '@slash/shared';

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => 'bytea',
  fromDriver: (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v)),
});

const pk = () => uuid('id').primaryKey().defaultRandom();
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();
const day = (name: string) => date(name, { mode: 'string' });
const schoolRef = () =>
  uuid('school_id')
    .notNull()
    .references(() => schools.id, { onDelete: 'cascade' });

// ───────────────────────────── Tenancy & identity ─────────────────────────────

export const schools = pgTable('schools', {
  id: pk(),
  name: text('name').notNull(),
  /** Short public code, e.g. SCHOOL_A_001 */
  code: text('code').notNull().unique(),
  timezone: text('timezone').notNull().default('Africa/Khartoum'),
  /** 0 = Sunday … 6 = Saturday */
  weekStart: integer('week_start').notNull().default(0),
  currency: text('currency').notNull().default('SDG'),
  /** null → DEFAULT_GRADE_BANDS */
  gradeBands: jsonb('grade_bands').$type<GradeBand[] | null>(),
  phone: text('phone'),
  address: text('address'),
  createdAt: createdAt(),
});

export const users = pgTable('users', {
  id: pk(),
  /** Normalized local format, e.g. 0912345678 */
  phone: text('phone').notNull().unique(),
  fullName: text('full_name').notNull(),
  pinHash: text('pin_hash'),
  status: text('status').$type<UserStatus>().notNull().default('pending'),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: ts('locked_until'),
  lastLoginAt: ts('last_login_at'),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  'memberships',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    schoolId: schoolRef(),
    role: text('role').$type<Role>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('memberships_user_school_role').on(t.userId, t.schoolId, t.role),
    index('memberships_school_role').on(t.schoolId, t.role),
  ],
);

export const activationCodes = pgTable('activation_codes', {
  id: pk(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  codeHash: text('code_hash').notNull().unique(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
  revokedAt: ts('revoked_at'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

export const sessions = pgTable('sessions', {
  id: pk(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: ts('expires_at').notNull(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  userAgent: text('user_agent'),
  createdAt: createdAt(),
});

// ───────────────────────────── School structure ─────────────────────────────

export const academicYears = pgTable('academic_years', {
  id: pk(),
  schoolId: schoolRef(),
  name: text('name').notNull(),
  startsOn: day('starts_on').notNull(),
  endsOn: day('ends_on').notNull(),
  isCurrent: boolean('is_current').notNull().default(false),
  createdAt: createdAt(),
});

/** روضة / أساس / متوسط / ثانوي */
export const stages = pgTable('stages', {
  id: pk(),
  schoolId: schoolRef(),
  name: text('name').notNull(),
  sort: integer('sort').notNull().default(0),
  createdAt: createdAt(),
});

/** الصف الخامس */
export const gradeLevels = pgTable('grade_levels', {
  id: pk(),
  schoolId: schoolRef(),
  stageId: uuid('stage_id')
    .notNull()
    .references(() => stages.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sort: integer('sort').notNull().default(0),
  createdAt: createdAt(),
});

/** A class/section in one academic year: "الخامس - ب" = grade level + section name. */
export const classSections = pgTable(
  'class_sections',
  {
    id: pk(),
    schoolId: schoolRef(),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id, { onDelete: 'cascade' }),
    gradeLevelId: uuid('grade_level_id')
      .notNull()
      .references(() => gradeLevels.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('class_sections_year_grade_name').on(t.academicYearId, t.gradeLevelId, t.name)],
);

export const subjects = pgTable(
  'subjects',
  {
    id: pk(),
    schoolId: schoolRef(),
    name: text('name').notNull(),
    sort: integer('sort').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('subjects_school_name').on(t.schoolId, t.name)],
);

/** Who teaches which subject to which class. Drives teacher scope and the guardian subject grid. */
export const teachingAssignments = pgTable(
  'teaching_assignments',
  {
    id: pk(),
    schoolId: schoolRef(),
    classSectionId: uuid('class_section_id')
      .notNull()
      .references(() => classSections.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    teacherId: uuid('teacher_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('teaching_assignments_class_subject').on(t.classSectionId, t.subjectId),
    index('teaching_assignments_teacher').on(t.teacherId),
  ],
);

// ───────────────────────────── People ─────────────────────────────

export const students = pgTable(
  'students',
  {
    id: pk(),
    schoolId: schoolRef(),
    /** Per-school code shown in the dashboard, e.g. S-25 */
    code: text('code').notNull(),
    firstName: text('first_name').notNull(),
    fatherName: text('father_name').notNull(),
    grandfatherName: text('grandfather_name').notNull(),
    greatGrandfatherName: text('great_grandfather_name'),
    gender: text('gender').$type<Gender>().notNull(),
    birthDate: day('birth_date'),
    /** Level the student was admitted to (المرحلة / السنة الدراسية in D3). */
    gradeLevelId: uuid('grade_level_id').references(() => gradeLevels.id, { onDelete: 'set null' }),
    /** Current class; null until the student is placed in a section. */
    classSectionId: uuid('class_section_id').references(() => classSections.id, { onDelete: 'set null' }),
    status: text('status').$type<StudentStatus>().notNull().default('active'),
    statusReason: text('status_reason'),
    statusChangedAt: ts('status_changed_at'),
    motherName: text('mother_name'),
    motherPhone: text('mother_phone'),
    motherWhatsapp: text('mother_whatsapp'),
    registeredAt: day('registered_at').notNull(),
    /** Hash of the code a guardian enters with "+" (P2) to link this student. */
    linkCodeHash: text('link_code_hash').unique(),
    notes: text('notes'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('students_school_code').on(t.schoolId, t.code),
    index('students_class').on(t.classSectionId),
  ],
);

export const studentGuardians = pgTable(
  'student_guardians',
  {
    id: pk(),
    schoolId: schoolRef(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    relation: text('relation').$type<Relation>().notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    occupation: text('occupation'),
    workplace: text('workplace'),
    locality: text('locality'),
    residence: text('residence'),
    whatsapp: text('whatsapp'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('student_guardians_student_user').on(t.studentId, t.userId),
    index('student_guardians_user').on(t.userId),
  ],
);

// ───────────────────────────── Files ─────────────────────────────

/** MVP file storage lives in Postgres (no persistent disk on the free host). Max ~5 MB each. */
export const files = pgTable('files', {
  id: pk(),
  schoolId: schoolRef(),
  uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  data: bytea('data').notNull(),
  createdAt: createdAt(),
});

// ───────────────────────────── Lessons & homework ─────────────────────────────

export const lessons = pgTable(
  'lessons',
  {
    id: pk(),
    schoolId: schoolRef(),
    classSectionId: uuid('class_section_id')
      .notNull()
      .references(() => classSections.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    /** Author (teacher or supervisor). */
    teacherId: uuid('teacher_id').references(() => users.id, { onDelete: 'set null' }),
    date: day('date').notNull(),
    title: text('title').notNull(),
    /** Free text, e.g. "15 - 50" */
    pages: text('pages'),
    details: text('details'),
    hasHomework: boolean('has_homework').notNull().default(false),
    homeworkDetails: text('homework_details'),
    homeworkDueDate: day('homework_due_date'),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('lessons_class_subject_date').on(t.classSectionId, t.subjectId, t.date)],
);

export const lessonAttachments = pgTable(
  'lesson_attachments',
  {
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.lessonId, t.fileId] })],
);

/** The "تم" checkbox on homework (P7). */
export const homeworkDone = pgTable(
  'homework_done',
  {
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    byUserId: uuid('by_user_id').references(() => users.id, { onDelete: 'set null' }),
    doneAt: ts('done_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.lessonId, t.studentId] })],
);

// ───────────────────────────── Attendance ─────────────────────────────

/** One per class per day. A session with no absences means "everyone present". */
export const attendanceSessions = pgTable(
  'attendance_sessions',
  {
    id: pk(),
    schoolId: schoolRef(),
    classSectionId: uuid('class_section_id')
      .notNull()
      .references(() => classSections.id, { onDelete: 'cascade' }),
    date: day('date').notNull(),
    recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('attendance_sessions_class_date').on(t.classSectionId, t.date)],
);

export const absences = pgTable(
  'absences',
  {
    sessionId: uuid('session_id')
      .notNull()
      .references(() => attendanceSessions.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.studentId] }), index('absences_student').on(t.studentId)],
);

// ───────────────────────────── Exams & grades ─────────────────────────────

/** e.g. "الامتحانات الشهرية — نوفمبر" for one grade level. Results are hidden until published. */
export const examPeriods = pgTable('exam_periods', {
  id: pk(),
  schoolId: schoolRef(),
  academicYearId: uuid('academic_year_id')
    .notNull()
    .references(() => academicYears.id, { onDelete: 'cascade' }),
  gradeLevelId: uuid('grade_level_id')
    .notNull()
    .references(() => gradeLevels.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<ExamPeriodKind>().notNull(),
  name: text('name').notNull(),
  resultsPublishedAt: ts('results_published_at'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

/**
 * One sitting of one subject for one class. Covers:
 *  - an exam timetable row (exam_period_id set, S12),
 *  - a quiz announcement (kind = 'quiz', no period, S13 / P11),
 *  - the target of grade entry (S14).
 */
export const assessments = pgTable(
  'assessments',
  {
    id: pk(),
    schoolId: schoolRef(),
    examPeriodId: uuid('exam_period_id').references(() => examPeriods.id, { onDelete: 'cascade' }),
    classSectionId: uuid('class_section_id')
      .notNull()
      .references(() => classSections.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<AssessmentKind>().notNull(),
    title: text('title').notNull(),
    date: day('date').notNull(),
    maxScore: integer('max_score').notNull(),
    details: text('details'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('assessments_class_date').on(t.classSectionId, t.date),
    index('assessments_period').on(t.examPeriodId),
  ],
);

export const scores = pgTable(
  'scores',
  {
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    score: doublePrecision('score').notNull(),
    enteredBy: uuid('entered_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.assessmentId, t.studentId] }), index('scores_student').on(t.studentId)],
);

// ───────────────────────────── Behavior & evaluation ─────────────────────────────

/** School regulations catalog (اللوائح المدرسية). */
export const regulations = pgTable('regulations', {
  id: pk(),
  schoolId: schoolRef(),
  code: text('code'),
  title: text('title').notNull(),
  defaultPenalty: text('default_penalty'),
  createdAt: createdAt(),
});

export const behaviorIncidents = pgTable(
  'behavior_incidents',
  {
    id: pk(),
    schoolId: schoolRef(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    regulationId: uuid('regulation_id')
      .notNull()
      .references(() => regulations.id, { onDelete: 'restrict' }),
    date: day('date').notNull(),
    details: text('details'),
    /** Empty = violation without a penalty. */
    penalty: text('penalty'),
    recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('behavior_incidents_student').on(t.studentId)],
);

/** Student evaluation (S17 / T9): a rating + comment per subject per day. */
export const evaluations = pgTable(
  'evaluations',
  {
    id: pk(),
    schoolId: schoolRef(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    teacherId: uuid('teacher_id').references(() => users.id, { onDelete: 'set null' }),
    date: day('date').notNull(),
    rating: text('rating').$type<EvaluationRating>().notNull(),
    comment: text('comment'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('evaluations_student_subject_date').on(t.studentId, t.subjectId, t.date),
    index('evaluations_student').on(t.studentId),
  ],
);

// ───────────────────────────── Fees ─────────────────────────────

/** Total = sum of its installments. */
export const feePlans = pgTable('fee_plans', {
  id: pk(),
  schoolId: schoolRef(),
  academicYearId: uuid('academic_year_id')
    .notNull()
    .references(() => academicYears.id, { onDelete: 'cascade' }),
  /** null = applies to any grade level */
  gradeLevelId: uuid('grade_level_id').references(() => gradeLevels.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

export const planInstallments = pgTable(
  'plan_installments',
  {
    id: pk(),
    feePlanId: uuid('fee_plan_id')
      .notNull()
      .references(() => feePlans.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    amount: integer('amount').notNull(),
    dueDate: day('due_date').notNull(),
  },
  (t) => [uniqueIndex('plan_installments_plan_seq').on(t.feePlanId, t.seq)],
);

/** A student billed under a plan (one per plan). */
export const studentFees = pgTable(
  'student_fees',
  {
    id: pk(),
    schoolId: schoolRef(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    feePlanId: uuid('fee_plan_id')
      .notNull()
      .references(() => feePlans.id, { onDelete: 'cascade' }),
    discount: integer('discount').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('student_fees_student_plan').on(t.studentId, t.feePlanId)],
);

export const payments = pgTable(
  'payments',
  {
    id: pk(),
    schoolId: schoolRef(),
    studentFeeId: uuid('student_fee_id')
      .notNull()
      .references(() => studentFees.id, { onDelete: 'cascade' }),
    amount: integer('amount').notNull(),
    paidAt: day('paid_at').notNull(),
    method: text('method').$type<PaymentMethod>().notNull(),
    receiptNo: text('receipt_no'),
    note: text('note'),
    recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('payments_student_fee').on(t.studentFeeId)],
);

// ───────────────────────────── Communication ─────────────────────────────

export const announcements = pgTable(
  'announcements',
  {
    id: pk(),
    schoolId: schoolRef(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    audienceType: text('audience_type').$type<AudienceType>().notNull(),
    /** grade_level / class_section / student id; null for audience 'school'. */
    audienceId: uuid('audience_id'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    publishedAt: ts('published_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index('announcements_school_published').on(t.schoolId, t.publishedAt)],
);

export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: pk(),
    schoolId: schoolRef(),
    title: text('title').notNull(),
    kind: text('kind').$type<CalendarKind>().notNull(),
    startsOn: day('starts_on').notNull(),
    endsOn: day('ends_on').notNull(),
    details: text('details'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('calendar_events_school_start').on(t.schoolId, t.startsOn)],
);

/** Weekly class timetable (S16 / T8). */
export const timetableSlots = pgTable(
  'timetable_slots',
  {
    id: pk(),
    schoolId: schoolRef(),
    classSectionId: uuid('class_section_id')
      .notNull()
      .references(() => classSections.id, { onDelete: 'cascade' }),
    /** 0 = Sunday … 6 = Saturday */
    weekday: integer('weekday').notNull(),
    /** 1-based period number */
    period: integer('period').notNull(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    teacherId: uuid('teacher_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('timetable_slots_class_day_period').on(t.classSectionId, t.weekday, t.period),
    index('timetable_slots_teacher').on(t.teacherId),
  ],
);

/** Per guardian × student × module (× subject) "last seen" marker that drives unread badges. */
export const readCursors = pgTable(
  'read_cursors',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    module: text('module').notNull(),
    /** subject id for per-subject badges, '' otherwise */
    scope: text('scope').notNull().default(''),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.studentId, t.module, t.scope] })],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: pk(),
    schoolId: uuid('school_id').references(() => schools.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    action: text('action').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_school_entity').on(t.schoolId, t.entity, t.entityId)],
);

/**
 * Arabic content for the demo dataset: names, places, curricula and wording. Data only.
 */
import type { EvaluationRating, Gender, Relation } from '@slash/shared';

// ───────────────────────────── People ─────────────────────────────

export const MALE_NAMES = [
  'محمد',
  'أحمد',
  'عمر',
  'عثمان',
  'يوسف',
  'خالد',
  'مصطفى',
  'الطيب',
  'حسن',
  'حسين',
  'علي',
  'مجتبى',
  'معتز',
  'مهند',
  'أمجد',
  'ياسر',
  'طارق',
  'عبدالرحمن',
  'المعز',
  'الفاتح',
  'مازن',
  'أنس',
  'الصادق',
  'مؤمن',
  'عمار',
  'أيمن',
  'حمزة',
  'أبوبكر',
  'الزبير',
  'عبدالعزيز',
  'سيف الدين',
  'مزمل',
  'مدثر',
  'أواب',
  'تميم',
  'قصي',
  'معاذ',
  'عبيدة',
  'مهاب',
  'ريان',
] as const;

export const FEMALE_NAMES = [
  'فاطمة',
  'آمنة',
  'مريم',
  'سارة',
  'هبة',
  'رنا',
  'تسنيم',
  'أسماء',
  'خديجة',
  'زينب',
  'سلمى',
  'ملاذ',
  'رؤى',
  'إسراء',
  'آلاء',
  'نسرين',
  'هالة',
  'ندى',
  'رحاب',
  'شهد',
  'مروة',
  'أمل',
  'سجى',
  'روان',
  'وعد',
  'دعاء',
  'منى',
  'إيمان',
  'هديل',
  'عفراء',
  'لينا',
  'رهف',
  'ميسون',
  'أريج',
  'صفاء',
  'عائشة',
  'سمية',
  'رقية',
  'هاجر',
  'مودة',
  'رزان',
  'تقوى',
  'أبرار',
  'نهى',
  'منار',
  'إيلاف',
  'دانية',
] as const;

/** Names of the fathers' and grandfathers' generation. */
export const ELDER_NAMES = [
  'عبدالرحيم',
  'الطيب',
  'محمد',
  'أحمد',
  'عثمان',
  'حسن',
  'علي',
  'عبدالله',
  'مصطفى',
  'الأمين',
  'صالح',
  'يوسف',
  'بابكر',
  'عوض',
  'الفكي',
  'حامد',
  'إدريس',
  'موسى',
  'عبدالقادر',
  'الصديق',
  'النور',
  'آدم',
  'جعفر',
  'الحاج',
  'مختار',
  'محجوب',
  'عبدالمنعم',
  'كمال',
  'فيصل',
  'ميرغني',
  'بشير',
  'الزين',
  'حمد',
  'الماحي',
  'عبدالباقي',
  'سليمان',
  'دفع الله',
  'خليل',
  'العوض',
  'التجاني',
  'السر',
  'عبدالوهاب',
  'أبوزيد',
  'حمدان',
  'المبارك',
  'قسم السيد',
  'عبدالمحمود',
] as const;

/** Khartoum-state localities with a few neighbourhoods each. */
export const LOCALITIES: ReadonlyArray<{ locality: string; residences: readonly string[] }> = [
  { locality: 'كرري', residences: ['الحتانة', 'الثورة الحارة 21', 'الثورة الحارة 14', 'المهدية', 'الدروشاب جنوب'] },
  { locality: 'أم درمان', residences: ['ود نوباوي', 'الملازمين', 'بيت المال', 'العباسية', 'أبوروف'] },
  { locality: 'أم بدة', residences: ['أم بدة الحارة 17', 'الفتيحاب', 'أم بدة السبيل'] },
  { locality: 'بحري', residences: ['شمبات', 'الصافية', 'الحلفايا', 'كافوري', 'الدناقلة'] },
  { locality: 'الخرطوم', residences: ['الرياض', 'الصحافة', 'الخرطوم 2', 'بري', 'الجريف غرب'] },
  { locality: 'شرق النيل', residences: ['الحاج يوسف', 'الجريف شرق', 'العيلفون'] },
  { locality: 'جبل أولياء', residences: ['الكلاكلة', 'جبرة', 'الأزهري'] },
];

/** [occupation, workplace] pairs for fathers and other male guardians. */
export const MALE_JOBS: ReadonlyArray<readonly [string, string | null]> = [
  ['موظف', 'وزارة المالية'],
  ['معلم', 'مدرسة الثورة الثانوية'],
  ['تاجر', 'سوق أم درمان'],
  ['مهندس', 'شركة سوداتل'],
  ['طبيب', 'مستشفى أم درمان التعليمي'],
  ['محاسب', 'بنك الخرطوم'],
  ['سائق', null],
  ['مزارع', 'مشروع الجزيرة'],
  ['ضابط', 'القوات المسلحة'],
  ['أعمال حرة', null],
  ['أستاذ جامعي', 'جامعة الخرطوم'],
  ['فني كهرباء', 'الشركة السودانية لتوزيع الكهرباء'],
  ['صيدلي', 'صيدلية الشفاء'],
  ['مغترب', 'المملكة العربية السعودية'],
];

/** [occupation, workplace] pairs for mothers and other female guardians. */
export const FEMALE_JOBS: ReadonlyArray<readonly [string, string | null]> = [
  ['ربة منزل', null],
  ['ربة منزل', null],
  ['معلمة', 'مدرسة الحارة 21 الأساسية'],
  ['ممرضة', 'مستشفى البان جديد'],
  ['موظفة', 'وزارة التربية والتعليم'],
  ['طبيبة', 'مستشفى الخرطوم التعليمي'],
];

/** Weighted relation of a student's primary guardian. */
export const GUARDIAN_RELATIONS: ReadonlyArray<readonly [Relation, number]> = [
  ['father', 76],
  ['mother', 14],
  ['uncle', 5],
  ['brother', 3],
  ['grandparent', 2],
];

/** Mobile prefixes in Sudan (Zain, MTN, Sudani). */
export const PHONE_PREFIXES = ['091', '090', '096', '092', '099', '012', '011'] as const;

// ───────────────────────────── Staff ─────────────────────────────

export interface ExtraStaff {
  phone: string;
  fullName: string;
}

/** Extra supervisor (middle school). */
export const EXTRA_SUPERVISOR: ExtraStaff = { phone: '0900000004', fullName: 'عفاف حمدان سليمان' };

/** Extra teachers; the timetable/assignment plan refers to them by key. */
export const EXTRA_TEACHERS = {
  mMath: { phone: '0900001001', fullName: 'محمد الحسن بابكر' },
  mArabicA: { phone: '0900001002', fullName: 'آمنة عبدالقادر محمد' },
  mArabicB: { phone: '0900001003', fullName: 'حسن الطيب إدريس' },
  mEnglish: { phone: '0900001004', fullName: 'سامية مختار عثمان' },
  mScience: { phone: '0900001005', fullName: 'نجلاء صالح يوسف' },
  mIslamic: { phone: '0900001006', fullName: 'عبدالباقي حمد النور' },
  mQuran: { phone: '0900001007', fullName: 'مدثر الحاج آدم' },
  mComputer: { phone: '0900001008', fullName: 'هالة كمال ميرغني' },
  sMath: { phone: '0900001009', fullName: 'عبدالمنعم الزين محجوب' },
  sPhysics: { phone: '0900001010', fullName: 'خالد بشير موسى' },
  sChemistry: { phone: '0900001011', fullName: 'رحاب فيصل جعفر' },
  sBiology: { phone: '0900001012', fullName: 'إيمان السر عبدالوهاب' },
  sArabic: { phone: '0900001013', fullName: 'صديق المبارك أبوزيد' },
  sEnglish: { phone: '0900001014', fullName: 'مروة التجاني خليل' },
  sQuran: { phone: '0900001015', fullName: 'أبوبكر قسم السيد علي' },
} as const satisfies Record<string, ExtraStaff>;

export type TeacherKey = keyof typeof EXTRA_TEACHERS | 'demo';

// ───────────────────────────── Curriculum ─────────────────────────────

export type SubjectKind = 'math' | 'arabic' | 'english' | 'science' | 'islamic' | 'quran' | 'computer';

export interface QuranSurah {
  name: string;
  ayat: number;
  /** Mushaf page of the first ayah. */
  page: number;
}

export interface SubjectDef {
  name: string;
  kind: SubjectKind;
  /** Periods per week in the timetable (each school's subjects add up to 30 = 5 days × 6 periods). */
  weeklyPeriods: number;
  /** Lesson titles in teaching order (unused for Quran). */
  topics: readonly string[];
  /** Quran only: the surahs memorised this term. */
  surahs?: readonly QuranSurah[];
  /** Max score of a monthly exam / a term exam / a quiz. */
  monthlyMax: number;
  termMax: number;
  quizMax: number;
}

const MIDDLE_SUBJECTS: SubjectDef[] = [
  {
    name: 'الرياضيات',
    kind: 'math',
    weeklyPeriods: 6,
    monthlyMax: 50,
    termMax: 100,
    quizMax: 30,
    topics: [
      'الأعداد الصحيحة والعمليات عليها',
      'الكسور الاعتيادية',
      'جمع الكسور وطرحها',
      'ضرب الكسور وقسمتها',
      'الكسور العشرية',
      'النسبة والتناسب',
      'النسبة المئوية',
      'المقادير الجبرية',
      'المعادلات من الدرجة الأولى',
      'حل المعادلات بخطوتين',
      'المتباينات',
      'الزوايا وأنواعها',
      'المثلثات وخواصها',
      'مساحة المستطيل والمربع',
      'محيط الدائرة ومساحتها',
      'تمارين عامة على الوحدة',
    ],
  },
  {
    name: 'اللغة العربية',
    kind: 'arabic',
    weeklyPeriods: 6,
    monthlyMax: 50,
    termMax: 100,
    quizMax: 20,
    topics: [
      'المبتدأ والخبر',
      'كان وأخواتها',
      'إن وأخواتها',
      'نص: النيل العظيم',
      'الفاعل ونائب الفاعل',
      'المفعول به',
      'قراءة: فضل العلم',
      'الإملاء: الهمزة المتوسطة',
      'التعبير: وصف رحلة مدرسية',
      'الأفعال الخمسة',
      'الجملة الاسمية والجملة الفعلية',
      'نص: الأم مدرسة',
      'البلاغة: التشبيه',
      'الإملاء: التاء المربوطة والتاء المفتوحة',
    ],
  },
  {
    name: 'اللغة الإنجليزية',
    kind: 'english',
    weeklyPeriods: 5,
    monthlyMax: 50,
    termMax: 100,
    quizMax: 20,
    topics: [
      'Unit 3: My Family',
      'Grammar: Present Simple',
      'Reading: The River Nile',
      'Vocabulary: Jobs',
      'Grammar: Present Continuous',
      'Writing: A Letter to a Friend',
      'Unit 4: Daily Routine',
      'Grammar: Past Simple',
      'Reading: A Trip to Port Sudan',
      'Vocabulary: Food and Drinks',
      'Grammar: Comparatives',
      'Unit 5: Health',
    ],
  },
  {
    name: 'العلوم',
    kind: 'science',
    weeklyPeriods: 4,
    monthlyMax: 50,
    termMax: 100,
    quizMax: 20,
    topics: [
      'الخلية ومكوناتها',
      'الجهاز الهضمي',
      'الجهاز التنفسي',
      'الدورة الدموية',
      'المادة وحالاتها',
      'الخلائط والمحاليل',
      'الضوء وانعكاسه',
      'الصوت وانتقاله',
      'المغناطيسية',
      'الكهرباء الساكنة',
      'النبات الزهري وأجزاؤه',
      'السلسلة الغذائية',
      'الطاقة وأشكالها',
    ],
  },
  {
    name: 'التربية الإسلامية',
    kind: 'islamic',
    weeklyPeriods: 3,
    monthlyMax: 50,
    termMax: 100,
    quizMax: 20,
    topics: [
      'أركان الإسلام',
      'الوضوء وصفته',
      'صلاة الجماعة وفضلها',
      'بر الوالدين',
      'الصدق والأمانة',
      'غزوة بدر الكبرى',
      'الهجرة النبوية',
      'آداب الطريق',
      'حقوق الجار',
      'الزكاة ومصارفها',
      'حديث: الدين النصيحة',
      'آداب المسجد',
    ],
  },
  {
    name: 'القرآن الكريم',
    kind: 'quran',
    weeklyPeriods: 3,
    monthlyMax: 30,
    termMax: 50,
    quizMax: 30,
    topics: [],
    surahs: [
      { name: 'النور', ayat: 64, page: 350 },
      { name: 'الفرقان', ayat: 77, page: 359 },
    ],
  },
  {
    name: 'الحاسوب',
    kind: 'computer',
    weeklyPeriods: 3,
    monthlyMax: 50,
    termMax: 100,
    quizMax: 20,
    topics: [
      'مكونات الحاسوب',
      'وحدات الإدخال والإخراج',
      'نظام التشغيل ويندوز',
      'إدارة الملفات والمجلدات',
      'معالج النصوص Word',
      'تنسيق المستندات',
      'الجداول الإلكترونية Excel',
      'المعادلات في Excel',
      'الإنترنت والبريد الإلكتروني',
      'أمن المعلومات',
      'مقدمة في البرمجة بلغة Scratch',
      'العروض التقديمية PowerPoint',
    ],
  },
];

const SECONDARY_SUBJECTS: SubjectDef[] = [
  {
    name: 'الرياضيات',
    kind: 'math',
    weeklyPeriods: 6,
    monthlyMax: 50,
    termMax: 100,
    quizMax: 30,
    topics: [
      'الدوال وأنواعها',
      'النهايات',
      'الاتصال',
      'التفاضل: المشتقة الأولى',
      'قواعد الاشتقاق',
      'مشتقات الدوال المثلثية',
      'تطبيقات التفاضل',
      'التكامل غير المحدد',
      'التكامل بالتعويض',
      'التكامل المحدد',
      'المصفوفات',
      'المحددات',
      'المتتاليات الحسابية',
      'المتتاليات الهندسية',
      'تمارين عامة على الوحدة',
    ],
  },
  {
    name: 'الفيزياء',
    kind: 'science',
    weeklyPeriods: 4,
    monthlyMax: 50,
    termMax: 100,
    quizMax: 20,
    topics: [
      'الكميات الفيزيائية والوحدات',
      'الحركة في خط مستقيم',
      'السرعة والتسارع',
      'قوانين نيوتن للحركة',
      'الشغل والطاقة',
      'القدرة',
      'كمية الحركة والدفع',
      'الحركة الدائرية',
      'الجاذبية الكونية',
      'الموجات وخصائصها',
      'انكسار الضوء',
      'قانون أوم',
    ],
  },
  {
    name: 'الكيمياء',
    kind: 'science',
    weeklyPeriods: 4,
    monthlyMax: 50,
    termMax: 100,
    quizMax: 20,
    topics: [
      'تركيب الذرة',
      'الجدول الدوري',
      'الروابط الكيميائية',
      'الرابطة الأيونية',
      'الرابطة التساهمية',
      'المول والحسابات الكيميائية',
      'وزن المعادلات الكيميائية',
      'الأحماض والقواعد',
      'الأملاح',
      'الأكسدة والاختزال',
      'الهيدروكربونات',
    ],
  },
  {
    name: 'الأحياء',
    kind: 'science',
    weeklyPeriods: 4,
    monthlyMax: 50,
    termMax: 100,
    quizMax: 20,
    topics: [
      'الخلية الحية',
      'الانقسام الخلوي',
      'قوانين مندل في الوراثة',
      'الحمض النووي DNA',
      'تصنيف الكائنات الحية',
      'الأنسجة النباتية',
      'البناء الضوئي',
      'التنفس الخلوي',
      'الجهاز العصبي',
      'الغدد الصماء والهرمونات',
      'جهاز المناعة',
    ],
  },
  {
    name: 'اللغة العربية',
    kind: 'arabic',
    weeklyPeriods: 5,
    monthlyMax: 50,
    termMax: 100,
    quizMax: 20,
    topics: [
      'البلاغة: الاستعارة',
      'البلاغة: الكناية',
      'الممنوع من الصرف',
      'أسلوب الشرط',
      'أسلوب التعجب',
      'الأدب: الشعر في العصر العباسي',
      'نص: من شعر المتنبي',
      'العروض: البحر الكامل',
      'التعبير: كتابة المقال',
      'النقد الأدبي: الصورة الشعرية',
      'المشتقات: اسم الفاعل واسم المفعول',
      'نص: الصوفي المعذب للتيجاني يوسف بشير',
    ],
  },
  {
    name: 'اللغة الإنجليزية',
    kind: 'english',
    weeklyPeriods: 4,
    monthlyMax: 50,
    termMax: 100,
    quizMax: 20,
    topics: [
      'Unit 5: Health and Fitness',
      'Grammar: Passive Voice',
      'Reading: Renewable Energy',
      'Grammar: Reported Speech',
      'Writing: An Argumentative Essay',
      'Grammar: Conditional Sentences',
      'Vocabulary: Technology',
      'Literature: Oliver Twist - Chapter 3',
      'Unit 6: Travel and Tourism',
      'Grammar: Relative Clauses',
      'Reading: The Pyramids of Meroe',
    ],
  },
  {
    name: 'القرآن الكريم',
    kind: 'quran',
    weeklyPeriods: 3,
    monthlyMax: 30,
    termMax: 50,
    quizMax: 30,
    topics: [],
    surahs: [
      { name: 'يس', ayat: 83, page: 440 },
      { name: 'الصافات', ayat: 182, page: 446 },
    ],
  },
];

// ───────────────────────────── School structure ─────────────────────────────

export interface ClassDef {
  section: string;
  /** Teacher of each subject (by subject name) in this class. */
  teachers: Record<string, TeacherKey>;
}

export interface GradeDef {
  name: string;
  /** Age (in years) at the start of the academic year. */
  age: number;
  classes: ClassDef[];
}

export interface SchoolDef {
  key: 'middle' | 'secondary';
  stage: string;
  phone: string;
  address: string;
  subjects: SubjectDef[];
  grades: GradeDef[];
}

const middleTeachers = (math: TeacherKey, arabic: TeacherKey, science: TeacherKey): Record<string, TeacherKey> => ({
  الرياضيات: math,
  'اللغة العربية': arabic,
  'اللغة الإنجليزية': 'mEnglish',
  العلوم: science,
  'التربية الإسلامية': 'mIslamic',
  'القرآن الكريم': 'mQuran',
  الحاسوب: 'mComputer',
});

const secondaryTeachers: Record<string, TeacherKey> = {
  الرياضيات: 'sMath',
  الفيزياء: 'sPhysics',
  الكيمياء: 'sChemistry',
  الأحياء: 'sBiology',
  'اللغة العربية': 'sArabic',
  'اللغة الإنجليزية': 'sEnglish',
  'القرآن الكريم': 'sQuran',
};

/**
 * The two demo schools. The demo teacher teaches الرياضيات in الصف الخامس أ and ب and العلوم in
 * الصف السادس أ; every other class × subject has one of the extra teachers.
 */
export const SCHOOL_DEFS: readonly SchoolDef[] = [
  {
    key: 'middle',
    stage: 'المرحلة المتوسطة',
    phone: '0187551234',
    address: 'كرري - الثورة الحارة 21، أم درمان',
    subjects: MIDDLE_SUBJECTS,
    grades: [
      {
        name: 'الصف الخامس',
        age: 10,
        classes: [
          { section: 'أ', teachers: middleTeachers('demo', 'mArabicA', 'mScience') },
          { section: 'ب', teachers: middleTeachers('demo', 'mArabicA', 'mScience') },
        ],
      },
      {
        name: 'الصف السادس',
        age: 11,
        classes: [{ section: 'أ', teachers: middleTeachers('mMath', 'mArabicB', 'demo') }],
      },
      {
        name: 'الصف السابع',
        age: 12,
        classes: [{ section: 'أ', teachers: middleTeachers('mMath', 'mArabicB', 'mScience') }],
      },
    ],
  },
  {
    key: 'secondary',
    stage: 'المرحلة الثانوية',
    phone: '0187551260',
    address: 'كرري - الحتانة، أم درمان',
    subjects: SECONDARY_SUBJECTS,
    grades: [
      { name: 'الصف الأول الثانوي', age: 14, classes: [{ section: 'أ', teachers: secondaryTeachers }] },
      { name: 'الصف الثاني الثانوي', age: 15, classes: [{ section: 'أ', teachers: secondaryTeachers }] },
    ],
  },
];

/** Shown in the guardian's lesson card (P5) — short, generic and true for any lesson. */
export const LESSON_DETAILS: Record<SubjectKind, readonly string[]> = {
  math: [
    'شرح الدرس مع حل أمثلة محلولة من الكتاب المدرسي',
    'مراجعة الدرس السابق ثم شرح الدرس الجديد وحل تمارين على السبورة',
    'تمارين تطبيقية داخل الفصل على الدرس',
  ],
  arabic: [
    'قراءة الدرس ومناقشة الأفكار الرئيسية',
    'شرح القاعدة مع أمثلة وتدريبات شفهية',
    'مراجعة الدرس السابق ثم شرح الدرس الجديد',
  ],
  english: [
    'Reading and new vocabulary, with class practice',
    'شرح القاعدة مع أمثلة وتمارين شفهية',
    'Listening and speaking practice in pairs',
  ],
  science: [
    'شرح الدرس باستخدام وسائل توضيحية',
    'تجربة عملية داخل الفصل ومناقشة النتائج',
    'مراجعة الدرس السابق ثم شرح الدرس الجديد',
  ],
  islamic: [
    'شرح الدرس واستخلاص الدروس المستفادة',
    'قراءة الأدلة الشرعية ومناقشتها',
    'مراجعة الدرس السابق ثم شرح الدرس الجديد',
  ],
  quran: ['تلاوة جماعية وتصحيح التلاوة', 'شرح معاني الكلمات ثم التسميع', 'تسميع فردي وتصحيح أحكام التجويد'],
  computer: [
    'شرح نظري ثم تطبيق عملي في المعمل',
    'تطبيق عملي على أجهزة المعمل',
    'مراجعة الدرس السابق ثم شرح الدرس الجديد',
  ],
};

/** Homework text for a lesson; `pages` is the lesson's last page. */
export function homeworkText(kind: SubjectKind, page: number, variant: number): string {
  const options: Record<Exclude<SubjectKind, 'quran'>, string[]> = {
    math: [`حل تمارين صفحة ${page} من (1) إلى (6)`, `حل المسائل الواردة في كراسة التمارين صفحة ${page}`],
    arabic: [
      `إعراب الجمل الواردة في تدريبات صفحة ${page}`,
      'كتابة فقرة من خمسة أسطر عن الدرس',
      `حل أسئلة الفهم والاستيعاب صفحة ${page}`,
    ],
    english: [`Workbook page ${page}: exercises A and B`, 'Learn the new words and write each one in a sentence'],
    science: [`الإجابة عن أسئلة نهاية الدرس صفحة ${page}`, 'رسم الشكل التوضيحي للدرس في الكراسة مع البيانات'],
    islamic: ['حفظ الحديث الشريف الوارد في الدرس', `الإجابة عن أسئلة التقويم صفحة ${page}`],
    computer: [`الإجابة عن أسئلة نهاية الدرس صفحة ${page}`, 'تلخيص خطوات الدرس في الكراسة'],
  };
  if (kind === 'quran') return 'حفظ الآيات المقررة وتسميعها';
  const list = options[kind];
  return list[variant % list.length];
}

// ───────────────────────────── Fees ─────────────────────────────

/** Installments of the yearly fee plan (SDG): middle 600,000, secondary 750,000. */
export const FEE_INSTALLMENTS: Record<SchoolDef['key'], readonly number[]> = {
  middle: [300_000, 150_000, 150_000],
  secondary: [350_000, 200_000, 200_000],
};

// ───────────────────────────── Behavior ─────────────────────────────

export interface RegulationDef {
  title: string;
  defaultPenalty: string;
  /** Incident details as [male, female] wording. */
  details: readonly [string, string];
}

export const REGULATIONS: readonly RegulationDef[] = [
  {
    title: 'مخالفة الزي المدرسي',
    defaultPenalty: 'تنبيه شفهي وإخطار ولي الأمر',
    details: ['حضر بدون الزي المدرسي الرسمي', 'حضرت بدون الزي المدرسي الرسمي'],
  },
  {
    title: 'حلاقة غير لائقة',
    defaultPenalty: 'إنذار كتابي وتعديل الحلاقة خلال يومين',
    details: ['حلاقة غير مسموح بها في المدرسة', 'حلاقة غير مسموح بها في المدرسة'],
  },
  {
    title: 'التأخر الصباحي',
    defaultPenalty: 'تنبيه وتسجيل في كشف التأخير',
    details: ['تأخر عن طابور الصباح 20 دقيقة', 'تأخرت عن طابور الصباح 20 دقيقة'],
  },
  {
    title: 'الغياب بدون عذر',
    defaultPenalty: 'استدعاء ولي الأمر',
    details: ['غياب يومين متتاليين بدون عذر', 'غياب يومين متتاليين بدون عذر'],
  },
  {
    title: 'استخدام الهاتف داخل الفصل',
    defaultPenalty: 'مصادرة الهاتف وتسليمه لولي الأمر',
    details: ['استخدام الهاتف أثناء الحصة', 'استخدام الهاتف أثناء الحصة'],
  },
  {
    title: 'الشجار',
    defaultPenalty: 'إنذار كتابي واستدعاء ولي الأمر',
    details: ['شجار مع زميل في الفسحة', 'شجار مع زميلة في الفسحة'],
  },
  {
    title: 'عدم أداء الواجب',
    defaultPenalty: 'إعادة الواجب وإخطار ولي الأمر',
    details: ['لم يؤدِّ الواجب المنزلي للمرة الثالثة', 'لم تؤدِّ الواجب المنزلي للمرة الثالثة'],
  },
  {
    title: 'إتلاف ممتلكات المدرسة',
    defaultPenalty: 'إصلاح التلف على نفقة ولي الأمر',
    details: ['الكتابة على طاولة الفصل', 'الكتابة على طاولة الفصل'],
  },
];

/** Evaluation comments (S17) as [male, female] wording, per rating. */
export const EVALUATION_COMMENTS: Record<EvaluationRating, ReadonlyArray<readonly [string, string]>> = {
  excellent: [
    ['مشاركة ممتازة في الحصة', 'مشاركة ممتازة في الحصة'],
    ['متميز في حل التمارين', 'متميزة في حل التمارين'],
    ['مستوى رائع، نتمنى له الاستمرار', 'مستوى رائع، نتمنى لها الاستمرار'],
  ],
  calm: [
    ['هادئ ومنتبه أثناء الشرح', 'هادئة ومنتبهة أثناء الشرح'],
    ['ملتزم بالهدوء داخل الفصل', 'ملتزمة بالهدوء داخل الفصل'],
  ],
  needs_attention: [
    ['يحتاج إلى متابعة في حل الواجبات', 'تحتاج إلى متابعة في حل الواجبات'],
    ['يحتاج إلى مزيد من التركيز داخل الحصة', 'تحتاج إلى مزيد من التركيز داخل الحصة'],
    ['مستواه في تراجع، نرجو المتابعة من المنزل', 'مستواها في تراجع، نرجو المتابعة من المنزل'],
  ],
  disruptive: [
    ['كثير الحديث أثناء الشرح', 'كثيرة الحديث أثناء الشرح'],
    ['يشغل زملاءه داخل الفصل', 'تشغل زميلاتها داخل الفصل'],
  ],
};

export const ABSENCE_NOTES = ['مريض', 'ظرف عائلي', 'سفر مع الأسرة', 'موعد طبي'] as const;

/** Picks the wording for a student's gender from a [male, female] pair. */
export function byGender<T>(pair: readonly [T, T], gender: Gender): T {
  return gender === 'female' ? pair[1] : pair[0];
}

import { useState, type ChangeEvent, type ReactNode } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Grid,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm, type UseFormReturnType } from '@mantine/form';
import { IconArrowRight, IconCircleCheck, IconWand } from '@tabler/icons-react';
import { Link, useNavigate, useParams } from 'react-router';
import { joinName, type Gender, type Relation } from '@slash/shared';
import { ApiError } from '../../../api/client';
import { usePublicConfig, useScope } from '../../../api/hooks';
import { AdminPage } from '../../../components/AdminPage';
import { IsoDateInput } from '../../../components/IsoDateInput';
import { PageLoader, QueryState } from '../../../components/States';
import { notifyError, notifySuccess } from '../../../lib/notify';
import { useSchoolId } from '../../../lib/params';
import {
  useAdmitStudent,
  useSchoolStructure,
  useStudentProfile,
  useUpdateStudent,
  type AdmissionResult,
  type GuardianLinkPatch,
  type SchoolStructure,
  type StudentProfile,
} from './api';
import {
  demoPerson,
  GENDER_OPTIONS,
  optionalPhone,
  orNull,
  pick,
  RELATION_OPTIONS,
  required,
  requiredPhone,
} from './helpers';
import { IssuedGuardianCard, useSchoolName } from './shared';

interface FormValues {
  firstName: string;
  fatherName: string;
  grandfatherName: string;
  greatGrandfatherName: string;
  gender: Gender | null;
  birthDate: string | null;
  stageId: string | null;
  gradeLevelId: string | null;
  classSectionId: string | null;
  registeredAt: string | null;
  gFirstName: string;
  gFatherName: string;
  gGrandfatherName: string;
  gGreatGrandfatherName: string;
  gPhone: string;
  gWhatsapp: string;
  relation: Relation;
  occupation: string;
  workplace: string;
  locality: string;
  residence: string;
  mFirstName: string;
  mFatherName: string;
  mGrandfatherName: string;
  mPhone: string;
  mWhatsapp: string;
  motherAccount: boolean;
}

type Form = UseFormReturnType<FormValues>;

/** API error path → form field (admission body, student PATCH and guardian-link PATCH). */
const SERVER_FIELDS: Record<string, keyof FormValues> = {
  'student.firstName': 'firstName',
  'student.fatherName': 'fatherName',
  'student.grandfatherName': 'grandfatherName',
  'student.greatGrandfatherName': 'greatGrandfatherName',
  'student.gender': 'gender',
  'student.birthDate': 'birthDate',
  'student.gradeLevelId': 'gradeLevelId',
  'student.classSectionId': 'classSectionId',
  'student.registeredAt': 'registeredAt',
  'guardian.firstName': 'gFirstName',
  'guardian.fatherName': 'gFatherName',
  'guardian.grandfatherName': 'gGrandfatherName',
  'guardian.greatGrandfatherName': 'gGreatGrandfatherName',
  'guardian.phone': 'gPhone',
  'guardian.whatsapp': 'gWhatsapp',
  'guardian.relation': 'relation',
  'guardian.occupation': 'occupation',
  'guardian.workplace': 'workplace',
  'guardian.locality': 'locality',
  'guardian.residence': 'residence',
  'mother.name': 'mFirstName',
  'mother.phone': 'mPhone',
  'mother.whatsapp': 'mWhatsapp',
  firstName: 'firstName',
  fatherName: 'fatherName',
  grandfatherName: 'grandfatherName',
  greatGrandfatherName: 'greatGrandfatherName',
  gender: 'gender',
  birthDate: 'birthDate',
  gradeLevelId: 'gradeLevelId',
  classSectionId: 'classSectionId',
  registeredAt: 'registeredAt',
  motherName: 'mFirstName',
  motherPhone: 'mPhone',
  motherWhatsapp: 'mWhatsapp',
  whatsapp: 'gWhatsapp',
  relation: 'relation',
  occupation: 'occupation',
  workplace: 'workplace',
  locality: 'locality',
  residence: 'residence',
};

function stageOfGrade(structure: SchoolStructure, gradeLevelId: string | null): string | null {
  if (!gradeLevelId) return null;
  return structure.stages.find((s) => s.gradeLevels.some((g) => g.id === gradeLevelId))?.id ?? null;
}

/** "آمنة علي حسن محمد" → ['آمنة', 'علي', 'حسن محمد'] */
function splitName3(name: string | null): [string, string, string] {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return [parts[0] ?? '', parts[1] ?? '', parts.slice(2).join(' ')];
}

function initialValues(structure: SchoolStructure, today: string | null, profile?: StudentProfile): FormValues {
  const primary = profile?.guardians.find((g) => g.isPrimary) ?? profile?.guardians[0];
  const [mFirstName, mFatherName, mGrandfatherName] = splitName3(profile?.motherName ?? null);
  return {
    firstName: profile?.firstName ?? '',
    fatherName: profile?.fatherName ?? '',
    grandfatherName: profile?.grandfatherName ?? '',
    greatGrandfatherName: profile?.greatGrandfatherName ?? '',
    gender: profile?.gender ?? null,
    birthDate: profile?.birthDate ?? null,
    stageId:
      stageOfGrade(structure, profile?.gradeLevelId ?? null) ??
      (structure.stages.length === 1 ? structure.stages[0].id : null),
    gradeLevelId: profile?.gradeLevelId ?? null,
    classSectionId: profile?.classSectionId ?? null,
    registeredAt: profile?.registeredAt ?? today,
    gFirstName: '',
    gFatherName: '',
    gGrandfatherName: '',
    gGreatGrandfatherName: '',
    gPhone: primary?.phone ?? '',
    gWhatsapp: primary?.whatsapp ?? '',
    relation: primary?.relation ?? 'father',
    occupation: primary?.occupation ?? '',
    workplace: primary?.workplace ?? '',
    locality: primary?.locality ?? '',
    residence: primary?.residence ?? '',
    mFirstName,
    mFatherName,
    mGrandfatherName,
    mPhone: profile?.motherPhone ?? '',
    mWhatsapp: profile?.motherWhatsapp ?? '',
    motherAccount: false,
  };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper withBorder radius="md" p="md" h="100%">
      <Title order={4} mb="sm">
        {title}
      </Title>
      <Stack gap="sm">{children}</Stack>
    </Paper>
  );
}

/** Four (or three) name-part inputs under one label, e.g. "اسم الطالب". */
function NameParts({
  form,
  label,
  fields,
  requiredCount,
}: {
  form: Form;
  label: string;
  fields: Array<keyof FormValues>;
  requiredCount: number;
}) {
  const labels = ['الاسم الاول', 'الاسم الثاني', 'الاسم الثالث', 'الاسم الرابع'];
  return (
    <div>
      <Text fw={600} size="sm" mb={4}>
        {label}
      </Text>
      <SimpleGrid cols={{ base: 2, sm: fields.length }} spacing="xs">
        {fields.map((f, i) => (
          <TextInput key={f} label={labels[i]} required={i < requiredCount} maxLength={60} {...form.getInputProps(f)} />
        ))}
      </SimpleGrid>
    </div>
  );
}

/** Optional phone input (LTR digits). */
function PhoneInput({ form, field, label }: { form: Form; field: keyof FormValues; label: string }) {
  return (
    <TextInput
      label={label}
      type="tel"
      inputMode="tel"
      dir="ltr"
      placeholder="09xxxxxxxx"
      maxLength={20}
      {...form.getInputProps(field)}
    />
  );
}

/** Input props for a phone whose typing also fills an empty (or still mirrored) WhatsApp number. */
function mirrorWhatsapp(form: Form, phoneField: 'gPhone' | 'mPhone', waField: 'gWhatsapp' | 'mWhatsapp') {
  const props = form.getInputProps(phoneField);
  return {
    ...props,
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      const next = e.currentTarget.value;
      const v = form.getValues();
      if (!v[waField] || v[waField] === v[phoneField]) form.setFieldValue(waField, next);
      form.setFieldValue(phoneField, next);
    },
  };
}

function AdmissionForm({
  schoolId,
  structure,
  today,
  profile,
  onCreated,
}: {
  schoolId: string;
  structure: SchoolStructure;
  today: string | null;
  profile?: StudentProfile;
  onCreated: (result: AdmissionResult) => void;
}) {
  const navigate = useNavigate();
  const demoMode = usePublicConfig().data?.demoMode ?? false;
  const editing = !!profile;
  const primary = profile?.guardians.find((g) => g.isPrimary) ?? profile?.guardians[0];
  const admit = useAdmitStudent(schoolId);
  const update = useUpdateStudent(schoolId, profile?.id ?? '');

  const form = useForm<FormValues>({
    mode: 'controlled',
    initialValues: initialValues(structure, today, profile),
    validate: {
      firstName: required(),
      fatherName: required(),
      grandfatherName: required(),
      gender: (v) => (v ? null : 'اختر الجنس'),
      birthDate: (v) => (v && today && v >= today ? 'تاريخ الميلاد يجب أن يكون قبل اليوم' : null),
      stageId: (v) => (v ? null : 'اختر المرحلة الدراسية'),
      gradeLevelId: (v) => (v ? null : 'اختر السنة الدراسية'),
      gFirstName: (v) => (editing ? null : required()(v)),
      gFatherName: (v) => (editing ? null : required()(v)),
      gGrandfatherName: (v) => (editing ? null : required()(v)),
      gPhone: (v) => (editing ? null : requiredPhone(v)),
      gWhatsapp: optionalPhone,
      mPhone: (v, values) =>
        values.motherAccount && !v.trim() ? 'رقم الوالدة مطلوب لإنشاء حساب لها' : optionalPhone(v),
      mWhatsapp: optionalPhone,
      mFirstName: (v, values) => (values.motherAccount && !v.trim() ? 'اسم الوالدة مطلوب لإنشاء حساب لها' : null),
    },
  });
  const v = form.values;

  const stage = structure.stages.find((s) => s.id === v.stageId);
  const grade = stage?.gradeLevels.find((g) => g.id === v.gradeLevelId);

  const showServerErrors = (err: unknown) => {
    if (err instanceof ApiError && err.details?.length) {
      const errors: Partial<Record<keyof FormValues, string>> = {};
      for (const d of err.details) {
        const field = SERVER_FIELDS[d.path];
        if (field) errors[field] = d.message;
      }
      form.setErrors(errors);
    }
    notifyError(err);
  };

  const motherName = (values: FormValues) =>
    orNull(joinName(values.mFirstName, values.mFatherName, values.mGrandfatherName));

  const submit = form.onSubmit((values) => {
    if (!editing) {
      admit.mutate(
        {
          student: {
            firstName: values.firstName.trim(),
            fatherName: values.fatherName.trim(),
            grandfatherName: values.grandfatherName.trim(),
            greatGrandfatherName: orNull(values.greatGrandfatherName),
            gender: values.gender,
            birthDate: values.birthDate,
            gradeLevelId: values.gradeLevelId,
            classSectionId: values.classSectionId,
            registeredAt: values.registeredAt ?? undefined,
          },
          mother: { name: motherName(values), phone: orNull(values.mPhone), whatsapp: orNull(values.mWhatsapp) },
          guardian: {
            firstName: values.gFirstName.trim(),
            fatherName: values.gFatherName.trim(),
            grandfatherName: values.gGrandfatherName.trim(),
            greatGrandfatherName: orNull(values.gGreatGrandfatherName),
            phone: values.gPhone.trim(),
            whatsapp: orNull(values.gWhatsapp),
            relation: values.relation,
            occupation: orNull(values.occupation),
            workplace: orNull(values.workplace),
            locality: orNull(values.locality),
            residence: orNull(values.residence),
          },
          motherAccount: values.motherAccount,
        },
        {
          onSuccess: (result) => {
            notifySuccess('تم تسجيل الطالب');
            onCreated(result);
          },
          onError: showServerErrors,
        },
      );
      return;
    }

    let guardian: { userId: string; patch: GuardianLinkPatch } | undefined;
    if (primary) {
      const patch: GuardianLinkPatch = {};
      if (values.relation !== primary.relation) patch.relation = values.relation;
      const text = {
        whatsapp: values.gWhatsapp,
        occupation: values.occupation,
        workplace: values.workplace,
        locality: values.locality,
        residence: values.residence,
      };
      for (const [k, val] of Object.entries(text) as Array<[keyof typeof text, string]>) {
        if (orNull(val) !== (primary[k] ?? null)) patch[k] = orNull(val);
      }
      if (Object.keys(patch).length) guardian = { userId: primary.userId, patch };
    }
    update.mutate(
      {
        student: {
          firstName: values.firstName.trim(),
          fatherName: values.fatherName.trim(),
          grandfatherName: values.grandfatherName.trim(),
          greatGrandfatherName: orNull(values.greatGrandfatherName),
          gender: values.gender ?? undefined,
          birthDate: values.birthDate,
          gradeLevelId: values.gradeLevelId ?? undefined,
          classSectionId: values.classSectionId,
          registeredAt: values.registeredAt ?? undefined,
          motherName: motherName(values),
          motherPhone: orNull(values.mPhone),
          motherWhatsapp: orNull(values.mWhatsapp),
        },
        guardian,
      },
      {
        onSuccess: (saved) => {
          notifySuccess('تم حفظ بيانات الطالب');
          navigate(`/a/${schoolId}/students/${saved.id}`);
        },
        onError: showServerErrors,
      },
    );
  });

  const fillDemo = () => {
    const p = demoPerson();
    const stages = structure.stages.filter((s) => s.gradeLevels.length);
    const st = stages.length ? pick(stages) : undefined;
    const gl = st ? pick(st.gradeLevels) : undefined;
    const cls = gl?.classSections.length ? pick(gl.classSections) : undefined;
    form.setValues({
      firstName: p.firstName,
      fatherName: p.fatherName,
      grandfatherName: p.grandfatherName,
      greatGrandfatherName: p.greatGrandfatherName,
      gender: p.gender,
      birthDate: p.birthDate,
      stageId: st?.id ?? null,
      gradeLevelId: gl?.id ?? null,
      classSectionId: cls?.id ?? null,
      gFirstName: p.guardian.firstName,
      gFatherName: p.guardian.fatherName,
      gGrandfatherName: p.guardian.grandfatherName,
      gGreatGrandfatherName: p.guardian.greatGrandfatherName,
      gPhone: p.guardian.phone,
      gWhatsapp: p.guardian.whatsapp,
      relation: 'father',
      occupation: p.guardian.occupation,
      workplace: p.guardian.workplace,
      locality: p.guardian.locality,
      residence: p.guardian.residence,
      mFirstName: p.mother.firstName,
      mFatherName: p.mother.fatherName,
      mGrandfatherName: p.mother.grandfatherName,
      mPhone: p.mother.phone,
      mWhatsapp: p.mother.phone,
      motherAccount: false,
    });
    form.clearErrors();
  };

  const noStructure = structure.stages.every((s) => s.gradeLevels.length === 0);

  return (
    <form onSubmit={submit} noValidate>
      <Stack gap="md">
        {noStructure && (
          <Alert color="orange" title="لم يتم إعداد السنوات الدراسية بعد">
            أضف المراحل والسنوات الدراسية والفصول من صفحة{' '}
            <Text component={Link} to={`/a/${schoolId}/classes`} inherit c="blue" td="underline">
              الفصول والمواد
            </Text>{' '}
            قبل تسجيل الطلاب.
          </Alert>
        )}
        {!editing && demoMode && (
          <Group justify="flex-end">
            <Button variant="light" color="grape" leftSection={<IconWand size={16} />} onClick={fillDemo}>
              تعبئة ببيانات تجريبية
            </Button>
          </Group>
        )}

        <Section title="بيانات الطالب">
          <NameParts
            form={form}
            label="اسم الطالب"
            fields={['firstName', 'fatherName', 'grandfatherName', 'greatGrandfatherName']}
            requiredCount={3}
          />
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
            <Select label="الجنس" placeholder="اختر" required data={GENDER_OPTIONS} {...form.getInputProps('gender')} />
            <IsoDateInput
              label="تاريخ الميلاد"
              placeholder="اختياري"
              clearable
              maxDate={today ?? undefined}
              value={v.birthDate}
              onChange={(d) => form.setFieldValue('birthDate', d)}
              error={form.errors.birthDate}
            />
            <IsoDateInput
              label="تاريخ التسجيل"
              value={v.registeredAt}
              onChange={(d) => form.setFieldValue('registeredAt', d)}
              error={form.errors.registeredAt}
            />
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
            <Select
              label="المرحلة الدراسية"
              placeholder="اختر المرحلة"
              required
              data={structure.stages.map((s) => ({ value: s.id, label: s.name }))}
              value={v.stageId}
              onChange={(id) => {
                form.setValues({ stageId: id, gradeLevelId: null, classSectionId: null });
                form.clearFieldError('stageId');
              }}
              error={form.errors.stageId}
              nothingFoundMessage="لا توجد مراحل"
            />
            <Select
              label="السنة الدراسية"
              placeholder="اختر السنة"
              required
              disabled={!stage}
              data={(stage?.gradeLevels ?? []).map((g) => ({ value: g.id, label: g.name }))}
              value={v.gradeLevelId}
              onChange={(id) => {
                form.setValues({ gradeLevelId: id, classSectionId: null });
                form.clearFieldError('gradeLevelId');
              }}
              error={form.errors.gradeLevelId}
              nothingFoundMessage="لا توجد سنوات دراسية"
            />
            <Select
              label="الفصل"
              placeholder={grade && !grade.classSections.length ? 'لا توجد فصول' : 'اختياري'}
              clearable
              disabled={!grade || !grade.classSections.length}
              data={(grade?.classSections ?? []).map((c) => ({ value: c.id, label: c.name }))}
              {...form.getInputProps('classSectionId')}
            />
          </SimpleGrid>
        </Section>

        <Grid gutter="md">
          <Grid.Col span={{ base: 12, lg: 7 }}>
            <Section title="بيانات ولي الأمر">
              {editing ? (
                primary ? (
                  <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                    <TextInput label="اسم ولي الامر" value={primary.fullName} disabled />
                    <TextInput label="رقم ولي الامر" value={primary.phone} dir="ltr" disabled />
                    <Text size="xs" c="dimmed" style={{ gridColumn: '1 / -1' }}>
                      لتغيير ولي الأمر أو إضافة ولي أمر آخر استخدم بطاقة أولياء الأمور في ملف الطالب.
                    </Text>
                  </SimpleGrid>
                ) : (
                  <Text size="sm" c="dimmed">
                    لا يوجد ولي أمر لهذا الطالب — أضفه من ملف الطالب.
                  </Text>
                )
              ) : (
                <>
                  <NameParts
                    form={form}
                    label="اسم ولي الامر"
                    fields={['gFirstName', 'gFatherName', 'gGrandfatherName', 'gGreatGrandfatherName']}
                    requiredCount={3}
                  />
                </>
              )}
              {(!editing || primary) && (
                <>
                  <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                    {!editing && (
                      <TextInput
                        label="رقم ولي الامر"
                        required
                        type="tel"
                        inputMode="tel"
                        dir="ltr"
                        placeholder="09xxxxxxxx"
                        maxLength={20}
                        {...mirrorWhatsapp(form, 'gPhone', 'gWhatsapp')}
                      />
                    )}
                    <PhoneInput form={form} field="gWhatsapp" label="رقم ولي الامر (واتساب)" />
                    <Select
                      label="صلة القرابة"
                      required
                      data={RELATION_OPTIONS}
                      allowDeselect={false}
                      {...form.getInputProps('relation')}
                    />
                    <TextInput label="مهنة ولي الامر" maxLength={120} {...form.getInputProps('occupation')} />
                    <TextInput label="مكان العمل" maxLength={120} {...form.getInputProps('workplace')} />
                    <TextInput label="المحلية" maxLength={120} {...form.getInputProps('locality')} />
                    <TextInput label="مكان الاقامة" maxLength={200} {...form.getInputProps('residence')} />
                  </SimpleGrid>
                </>
              )}
            </Section>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 5 }}>
            <Section title="بيانات الوالدة">
              <NameParts
                form={form}
                label="اسم الوالدة"
                fields={['mFirstName', 'mFatherName', 'mGrandfatherName']}
                requiredCount={0}
              />
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <TextInput
                  label="رقم الوالدة"
                  type="tel"
                  inputMode="tel"
                  dir="ltr"
                  placeholder="09xxxxxxxx"
                  maxLength={20}
                  {...mirrorWhatsapp(form, 'mPhone', 'mWhatsapp')}
                />
                <PhoneInput form={form} field="mWhatsapp" label="رقم الوالدة (واتساب)" />
              </SimpleGrid>
              {!editing && (
                <Checkbox
                  label="إنشاء حساب للوالدة في التطبيق"
                  description="تتابع الوالدة الطالب من هاتفها برمز تفعيل خاص بها"
                  {...form.getInputProps('motherAccount', { type: 'checkbox' })}
                />
              )}
            </Section>
          </Grid.Col>
        </Grid>

        <Group justify="flex-end">
          <Button
            variant="default"
            component={Link}
            to={profile ? `/a/${schoolId}/students/${profile.id}` : `/a/${schoolId}/students`}
          >
            إلغاء
          </Button>
          <Button type="submit" loading={admit.isPending || update.isPending} disabled={noStructure}>
            {editing ? 'حفظ التعديلات' : 'تسجيل الطالب'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

/** After admission: the new student's code and each guardian's activation code. */
function AdmissionDone({
  schoolId,
  result,
  onAnother,
}: {
  schoolId: string;
  result: AdmissionResult;
  onAnother: () => void;
}) {
  const schoolName = useSchoolName(schoolId);
  return (
    <Stack gap="md" maw={760}>
      <Alert color="teal" icon={<IconCircleCheck />} title="تم تسجيل الطالب">
        {result.student.fullName} — الكود{' '}
        <Text span fw={700} dir="ltr" inherit>
          {result.student.code}
        </Text>
      </Alert>
      <Stack gap={4}>
        <Title order={4}>رموز تفعيل أولياء الأمور</Title>
        <Text size="sm" c="dimmed">
          أرسل الرمز لولي الأمر عبر واتساب أو اكتبه له على ورقة. يفتح التطبيق، يدخل الرمز، ثم يختار رقماً سرياً.
        </Text>
      </Stack>
      {result.guardians.map((g) => (
        <IssuedGuardianCard key={g.userId} guardian={g} students={[result.student.fullName]} schoolName={schoolName} />
      ))}
      <Group>
        <Button component={Link} to={`/a/${schoolId}/students/${result.student.id}`}>
          عرض ملف الطالب
        </Button>
        <Button variant="default" onClick={onAnother}>
          تسجيل طالب آخر
        </Button>
        <Button variant="subtle" component={Link} to={`/a/${schoolId}/students`}>
          قائمة الطلاب
        </Button>
      </Group>
    </Stack>
  );
}

/** D3 "القبول والتسجيل" (students/new) and its edit mode (students/:studentId/edit). */
export function AdmissionPage() {
  const schoolId = useSchoolId();
  const { studentId } = useParams();
  const scope = useScope(schoolId);
  const structure = useSchoolStructure(schoolId);
  const profile = useStudentProfile(schoolId, studentId);
  const [result, setResult] = useState<AdmissionResult | null>(null);
  const [formKey, setFormKey] = useState(0);
  const today = scope.data?.school.today ?? null;
  const editing = !!studentId;

  const back = (
    <Button
      variant="default"
      component={Link}
      to={editing ? `/a/${schoolId}/students/${studentId}` : `/a/${schoolId}/students`}
      leftSection={<IconArrowRight size={16} />}
    >
      الرجوع
    </Button>
  );

  return (
    <AdminPage
      title={editing ? 'تعديل بيانات الطالب' : 'القبول والتسجيل'}
      subtitle={editing ? profile.data?.fullName : 'الحقول المميزة بـ * مطلوبة'}
      actions={back}
    >
      {scope.isLoading ? (
        <PageLoader />
      ) : result ? (
        <AdmissionDone
          schoolId={schoolId}
          result={result}
          onAnother={() => {
            setResult(null);
            setFormKey((k) => k + 1);
          }}
        />
      ) : (
        <QueryState query={structure}>
          {(s) =>
            editing ? (
              <QueryState query={profile}>
                {(p) => (
                  <AdmissionForm schoolId={schoolId} structure={s} today={today} profile={p} onCreated={setResult} />
                )}
              </QueryState>
            ) : (
              <AdmissionForm key={formKey} schoolId={schoolId} structure={s} today={today} onCreated={setResult} />
            )
          }
        </QueryState>
      )}
    </AdminPage>
  );
}

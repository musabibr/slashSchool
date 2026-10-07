import { useState } from 'react';
import { Alert, Anchor, Button, Divider, Select, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconInfoCircle, IconSend } from '@tabler/icons-react';
import { ApiError } from '../../api/client';
import { useClassStudents, useScope } from '../../api/hooks';
import { ClassSubjectSelect } from '../../components/ClassSubjectSelect';
import { IsoDateInput } from '../../components/IsoDateInput';
import { MobilePage } from '../../components/MobilePage';
import { QueryState } from '../../components/States';
import { notifyError, notifySuccess } from '../../lib/notify';
import { useSchoolId } from '../../lib/params';
import { useRecordIncident, useRegulations, type Regulation } from './api';
import { RegulationFormModal } from './RegulationFormModal';
import { StaffIncidentList } from './StaffIncidentList';
import { RegulationSelect } from './ui';

interface FormValues {
  regulationId: string | null;
  classId: string | null;
  studentId: string | null;
  date: string | null;
  details: string;
  penalty: string;
}

/** API field → form field, to show server validation messages next to the right input. */
const SERVER_FIELDS: Record<string, keyof FormValues> = {
  regulationId: 'regulationId',
  studentId: 'studentId',
  date: 'date',
  details: 'details',
  penalty: 'penalty',
};

/** S15 — record a behavior violation (supervisors and the director), then the class's recent incidents. */
export function BehaviorRecordPage() {
  const schoolId = useSchoolId();
  const scope = useScope(schoolId);
  return (
    <MobilePage title="السلوك والإنضباط">
      <QueryState query={scope}>
        {(s) =>
          s.school.roles.some((r) => r === 'admin' || r === 'supervisor') ? (
            <BehaviorRecordForm schoolId={schoolId} today={s.school.today} />
          ) : (
            <Alert color="yellow" icon={<IconInfoCircle />}>
              تسجيل المخالفات متاح للمشرفين والإدارة فقط
            </Alert>
          )
        }
      </QueryState>
    </MobilePage>
  );
}

function BehaviorRecordForm({ schoolId, today }: { schoolId: string; today: string }) {
  const regulations = useRegulations(schoolId);
  const record = useRecordIncident(schoolId);
  const [addingRegulation, setAddingRegulation] = useState(false);

  const form = useForm<FormValues>({
    initialValues: { regulationId: null, classId: null, studentId: null, date: today, details: '', penalty: '' },
    validate: {
      regulationId: (v) => (v ? null : 'اختر اللائحة'),
      classId: (v) => (v ? null : 'اختر الفصل'),
      studentId: (v) => (v ? null : 'اختر الطالب'),
      date: (v) => (!v ? 'اختر التاريخ' : v > today ? 'لا يمكن اختيار تاريخ لاحق لليوم' : null),
    },
  });
  const students = useClassStudents(schoolId, form.values.classId);
  const regs = regulations.data ?? [];

  /** Picking a regulation pre-fills its default penalty (still editable). */
  const pickRegulation = (r: Regulation | null) => {
    form.setValues({ regulationId: r?.id ?? null, penalty: r?.defaultPenalty ?? '' });
    form.clearFieldError('regulationId');
  };

  const submit = form.onSubmit((v) =>
    record.mutate(
      {
        studentId: v.studentId ?? '',
        regulationId: v.regulationId ?? '',
        date: v.date ?? today,
        details: v.details.trim() || null,
        penalty: v.penalty.trim() || null,
      },
      {
        onSuccess: () => {
          notifySuccess('تم تسجيل المخالفة');
          // Keep the class and date for the next student.
          form.setValues({ regulationId: null, studentId: null, details: '', penalty: '' });
        },
        onError: (err) => {
          if (err instanceof ApiError && err.details?.length) {
            const errors: Partial<Record<keyof FormValues, string>> = {};
            for (const d of err.details) {
              const field = SERVER_FIELDS[d.path];
              if (field) errors[field] = d.message;
            }
            form.setErrors(errors);
          }
          notifyError(err);
        },
      },
    ),
  );

  const selected = regs.find((r) => r.id === form.values.regulationId);

  return (
    <Stack gap="lg">
      <form onSubmit={submit} noValidate>
        <Stack gap="sm">
          {regulations.isSuccess && regs.length === 0 && (
            <Alert color="yellow" icon={<IconInfoCircle />}>
              لا توجد لوائح مدرسية بعد. أضف لائحة أولاً لتسجيل المخالفات.
            </Alert>
          )}
          <div>
            <RegulationSelect
              regulations={regs}
              value={form.values.regulationId}
              onPick={pickRegulation}
              error={form.errors.regulationId}
              loading={regulations.isLoading}
            />
            <Anchor component="button" type="button" size="xs" mt={4} onClick={() => setAddingRegulation(true)}>
              إضافة لائحة جديدة
            </Anchor>
          </div>
          <div>
            <ClassSubjectSelect
              schoolId={schoolId}
              classId={form.values.classId}
              withSubject={false}
              required
              onChange={({ classId }) => {
                form.setValues({ classId, studentId: null });
                form.clearFieldError('classId');
              }}
            />
            {form.errors.classId && (
              <Text c="red" size="xs" mt={4}>
                {form.errors.classId}
              </Text>
            )}
          </div>
          <Select
            label="الطالب"
            placeholder={form.values.classId ? 'اختر الطالب' : 'اختر الفصل أولاً'}
            data={(students.data ?? []).map((s) => ({ value: s.id, label: s.fullName }))}
            searchable
            required
            disabled={!form.values.classId || students.isLoading}
            nothingFoundMessage="لا يوجد طلاب"
            comboboxProps={{ withinPortal: true }}
            {...form.getInputProps('studentId')}
          />
          <IsoDateInput
            label="التاريخ"
            required
            maxDate={today}
            value={form.values.date}
            onChange={(v) => form.setFieldValue('date', v)}
            error={form.errors.date}
          />
          <Textarea
            label="الملاحظة"
            placeholder="تفاصيل المخالفة"
            autosize
            minRows={3}
            maxRows={8}
            maxLength={2000}
            {...form.getInputProps('details')}
          />
          <TextInput
            label="العقوبة"
            placeholder="اتركها فارغة إن لم توجد عقوبة"
            description={selected?.defaultPenalty ? 'العقوبة الافتراضية للائحة، ويمكنك تعديلها' : undefined}
            maxLength={300}
            {...form.getInputProps('penalty')}
          />
          <Button type="submit" size="md" mt="xs" loading={record.isPending} leftSection={<IconSend size={18} />}>
            ارسال
          </Button>
        </Stack>
      </form>

      <Stack gap="xs">
        <Divider label={form.values.classId ? 'آخر مخالفات الفصل' : 'آخر المخالفات'} labelPosition="center" />
        <StaffIncidentList
          schoolId={schoolId}
          filters={{ classId: form.values.classId, limit: 20 }}
          empty={form.values.classId ? 'لا توجد مخالفات مسجلة لهذا الفصل' : 'لا توجد مخالفات مسجلة'}
        />
      </Stack>

      <RegulationFormModal
        schoolId={schoolId}
        opened={addingRegulation}
        onClose={() => setAddingRegulation(false)}
        onSaved={pickRegulation}
      />
    </Stack>
  );
}

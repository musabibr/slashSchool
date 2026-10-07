import { useState } from 'react';
import { Button, Group, Modal, Stack, Textarea, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconPlus } from '@tabler/icons-react';
import { ApiError } from '../../api/client';
import { useScope } from '../../api/hooks';
import { IsoDateInput } from '../../components/IsoDateInput';
import { QueryState } from '../../components/States';
import { notifyError, notifySuccess } from '../../lib/notify';
import {
  useDeleteIncident,
  useRecordIncident,
  useRegulations,
  useStudentBehavior,
  type Regulation,
  type StudentBehavior,
} from './api';
import { StudentBehaviorView } from './StudentBehaviorView';
import { ConfirmDialog, RegulationSelect } from './ui';

type IncidentItem = StudentBehavior['incidents'][number];

/**
 * Director's student profile (D4) — behavior: the counters, incidents (with delete), a
 * "تسجيل مخالفة" button and the latest teacher evaluations.
 */
export function StudentBehaviorPanel({ studentId, schoolId }: { studentId: string; schoolId: string }) {
  const q = useStudentBehavior(studentId);
  const scope = useScope(schoolId);
  const canManage = !!scope.data?.school.roles.some((r) => r === 'admin' || r === 'supervisor');
  const [recording, setRecording] = useState(false);
  const [deleting, setDeleting] = useState<IncidentItem | null>(null);
  const remove = useDeleteIncident(schoolId);

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={4}>السلوك والإنضباط</Title>
        {canManage && (
          <Button leftSection={<IconPlus size={18} />} onClick={() => setRecording(true)}>
            تسجيل مخالفة
          </Button>
        )}
      </Group>
      <QueryState query={q}>
        {(data) => <StudentBehaviorView data={data} onDeleteIncident={canManage ? setDeleting : undefined} />}
      </QueryState>

      <Modal opened={recording} onClose={() => setRecording(false)} title="تسجيل مخالفة" centered size="md">
        {recording && scope.data && (
          <RecordIncidentForm
            schoolId={schoolId}
            studentId={studentId}
            today={scope.data.school.today}
            onDone={() => setRecording(false)}
          />
        )}
      </Modal>
      <ConfirmDialog
        opened={!!deleting}
        title="حذف المخالفة"
        message={deleting ? `حذف مخالفة "${deleting.regulationTitle}"؟` : ''}
        loading={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              notifySuccess('تم حذف المخالفة');
              setDeleting(null);
            },
            onError: notifyError,
          })
        }
      />
    </Stack>
  );
}

interface FormValues {
  regulationId: string | null;
  date: string | null;
  details: string;
  penalty: string;
}

function RecordIncidentForm({
  schoolId,
  studentId,
  today,
  onDone,
}: {
  schoolId: string;
  studentId: string;
  today: string;
  onDone: () => void;
}) {
  const regulations = useRegulations(schoolId);
  const record = useRecordIncident(schoolId);
  const form = useForm<FormValues>({
    initialValues: { regulationId: null, date: today, details: '', penalty: '' },
    validate: {
      regulationId: (v) => (v ? null : 'اختر اللائحة'),
      date: (v) => (!v ? 'اختر التاريخ' : v > today ? 'لا يمكن اختيار تاريخ لاحق لليوم' : null),
    },
  });

  const pickRegulation = (r: Regulation | null) => {
    form.setValues({ regulationId: r?.id ?? null, penalty: r?.defaultPenalty ?? '' });
    form.clearFieldError('regulationId');
  };

  const submit = form.onSubmit((v) =>
    record.mutate(
      {
        studentId,
        regulationId: v.regulationId ?? '',
        date: v.date ?? today,
        details: v.details.trim() || null,
        penalty: v.penalty.trim() || null,
      },
      {
        onSuccess: () => {
          notifySuccess('تم تسجيل المخالفة');
          onDone();
        },
        onError: (err) => {
          if (err instanceof ApiError && err.details?.length) {
            const errors: Partial<Record<keyof FormValues, string>> = {};
            for (const d of err.details) {
              if (d.path === 'regulationId' || d.path === 'date' || d.path === 'details' || d.path === 'penalty') {
                errors[d.path] = d.message;
              }
            }
            form.setErrors(errors);
          }
          notifyError(err);
        },
      },
    ),
  );

  return (
    <form onSubmit={submit} noValidate>
      <Stack gap="sm">
        <RegulationSelect
          regulations={regulations.data ?? []}
          value={form.values.regulationId}
          onPick={pickRegulation}
          error={form.errors.regulationId}
          loading={regulations.isLoading}
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
          maxLength={300}
          {...form.getInputProps('penalty')}
        />
        <Group grow mt="xs">
          <Button type="submit" loading={record.isPending}>
            ارسال
          </Button>
          <Button variant="default" onClick={onDone} disabled={record.isPending}>
            إلغاء
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

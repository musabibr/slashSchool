import { useCallback, useState } from 'react';
import { Alert, Button, Group, Modal, Paper, Stack, Switch, Text, Textarea, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconAlertTriangle, IconTrash } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../../api/client';
import { useScope } from '../../api/hooks';
import { ClassSubjectSelect } from '../../components/ClassSubjectSelect';
import { IsoDateInput } from '../../components/IsoDateInput';
import { MobilePage } from '../../components/MobilePage';
import { PageLoader, QueryState } from '../../components/States';
import { notifyError, notifySuccess } from '../../lib/notify';
import { useSchoolId } from '../../lib/params';
import { AttachmentEditor } from './Attachments';
import { staffKeys, useStaffLesson } from './queries';
import type { LessonAttachment, LessonPayload, StaffLesson } from './types';

interface FormValues {
  classId: string | null;
  subjectId: string | null;
  date: string | null;
  title: string;
  pages: string;
  details: string;
  hasHomework: boolean;
  homeworkDetails: string;
  homeworkDueDate: string | null;
}

/** API field → form field, to show server validation messages next to the right input. */
const SERVER_FIELDS: Record<string, keyof FormValues> = {
  classSectionId: 'classId',
  subjectId: 'subjectId',
  date: 'date',
  title: 'title',
  pages: 'pages',
  details: 'details',
  hasHomework: 'hasHomework',
  homeworkDetails: 'homeworkDetails',
  homeworkDueDate: 'homeworkDueDate',
};

function LessonForm({ schoolId, lesson, today }: { schoolId: string; lesson?: StaffLesson; today: string | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const listPath = `/s/${schoolId}/lessons/list`;
  const [attachments, setAttachments] = useState<LessonAttachment[]>(lesson?.attachments ?? []);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const onBusyChange = useCallback((busy: boolean) => setUploading(busy), []);

  const form = useForm<FormValues>({
    initialValues: {
      classId: lesson?.classSectionId ?? null,
      subjectId: lesson?.subjectId ?? null,
      date: lesson?.date ?? today,
      title: lesson?.title ?? '',
      pages: lesson?.pages ?? '',
      details: lesson?.details ?? '',
      hasHomework: lesson?.hasHomework ?? false,
      homeworkDetails: lesson?.homeworkDetails ?? '',
      homeworkDueDate: lesson?.homeworkDueDate ?? null,
    },
    validate: {
      classId: (v) => (v ? null : 'اختر الفصل'),
      subjectId: (v) => (v ? null : 'اختر المادة'),
      date: (v) => (v ? null : 'اختر التاريخ'),
      title: (v) => (v.trim() ? null : 'عنوان الدرس مطلوب'),
      homeworkDetails: (v, values) => (values.hasHomework && !v.trim() ? 'تفاصيل الواجب المنزلي مطلوبة' : null),
      homeworkDueDate: (v, values) =>
        values.hasHomework && v && values.date && v < values.date ? 'موعد التسليم يجب ألا يسبق تاريخ الدرس' : null,
    },
  });

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

  const save = useMutation({
    mutationFn: (payload: LessonPayload) =>
      lesson
        ? api.patch<StaffLesson>(`/api/schools/${schoolId}/lessons/${lesson.id}`, payload)
        : api.post<StaffLesson>(`/api/schools/${schoolId}/lessons`, payload),
    onSuccess: () => {
      notifySuccess(lesson ? 'تم تعديل الدرس' : 'تمت إضافة الدرس');
      void qc.invalidateQueries({ queryKey: staffKeys.all(schoolId) });
      navigate(listPath);
    },
    onError: showServerErrors,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/schools/${schoolId}/lessons/${id}`),
    onSuccess: (_res, id) => {
      notifySuccess('تم حذف الدرس');
      setConfirmDelete(false);
      qc.removeQueries({ queryKey: staffKeys.detail(schoolId, id) });
      void qc.invalidateQueries({ queryKey: staffKeys.all(schoolId) });
      navigate(listPath, { replace: true });
    },
    onError: notifyError,
  });

  const submit = form.onSubmit((v) =>
    save.mutate({
      classSectionId: v.classId ?? '',
      subjectId: v.subjectId ?? '',
      date: v.date ?? '',
      title: v.title.trim(),
      pages: v.pages.trim() || null,
      details: v.details.trim() || null,
      hasHomework: v.hasHomework,
      homeworkDetails: v.hasHomework ? v.homeworkDetails.trim() || null : null,
      homeworkDueDate: v.hasHomework ? v.homeworkDueDate : null,
      attachmentIds: attachments.map((a) => a.id),
    }),
  );

  const classError = form.errors.classId ?? form.errors.subjectId;

  return (
    <>
      <form onSubmit={submit} noValidate>
        <Stack gap="sm">
          <div>
            <ClassSubjectSelect
              schoolId={schoolId}
              classId={form.values.classId}
              subjectId={form.values.subjectId}
              required
              onChange={({ classId, subjectId }) => {
                form.setValues({ classId, subjectId });
                form.clearFieldError('classId');
                form.clearFieldError('subjectId');
              }}
            />
            {classError && (
              <Text c="red" size="xs" mt={4}>
                {classError}
              </Text>
            )}
          </div>
          <IsoDateInput
            label="التاريخ"
            required
            value={form.values.date}
            onChange={(v) => form.setFieldValue('date', v)}
            error={form.errors.date}
          />
          <TextInput label="عنوان الدرس" required maxLength={200} {...form.getInputProps('title')} />
          <TextInput label="الصفحات" placeholder="مثال: 15 - 50" maxLength={100} {...form.getInputProps('pages')} />
          <Textarea label="تفاصيل عن الدرس" autosize minRows={3} maxRows={10} {...form.getInputProps('details')} />

          <Paper withBorder radius="md" p="sm">
            <Switch size="md" label="واجب منزلي؟" {...form.getInputProps('hasHomework', { type: 'checkbox' })} />
            {form.values.hasHomework && (
              <Stack gap="sm" mt="sm">
                <Textarea
                  label="تفاصيل الواجب المنزلي"
                  required
                  autosize
                  minRows={2}
                  maxRows={8}
                  {...form.getInputProps('homeworkDetails')}
                />
                <IsoDateInput
                  label="موعد التسليم"
                  placeholder="اختياري"
                  clearable
                  minDate={form.values.date ?? undefined}
                  value={form.values.homeworkDueDate}
                  onChange={(v) => form.setFieldValue('homeworkDueDate', v)}
                  error={form.errors.homeworkDueDate}
                />
              </Stack>
            )}
          </Paper>

          <AttachmentEditor
            schoolId={schoolId}
            value={attachments}
            setValue={setAttachments}
            onBusyChange={onBusyChange}
          />

          <Group grow mt="sm">
            <Button type="submit" size="md" loading={save.isPending} disabled={uploading}>
              {lesson ? 'تعديل' : 'إضافة'}
            </Button>
            {lesson && (
              <Button
                size="md"
                color="red"
                variant="light"
                leftSection={<IconTrash size={18} />}
                onClick={() => setConfirmDelete(true)}
              >
                حذف
              </Button>
            )}
          </Group>
          {uploading && (
            <Text size="xs" c="dimmed" ta="center">
              انتظر حتى يكتمل رفع المرفقات
            </Text>
          )}
        </Stack>
      </form>

      {lesson && (
        <Modal opened={confirmDelete} onClose={() => setConfirmDelete(false)} title="حذف الدرس" centered>
          <Text size="sm">
            هل تريد حذف درس «{lesson.title}»؟ سيُحذف معه الواجب المنزلي والمرفقات من صفحات أولياء الأمور.
          </Text>
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={() => setConfirmDelete(false)}>
              إلغاء
            </Button>
            <Button color="red" loading={remove.isPending} onClick={() => remove.mutate(lesson.id)}>
              حذف
            </Button>
          </Group>
        </Modal>
      )}
    </>
  );
}

/** S5 / T4 (new, /s/:schoolId/lessons/new) and S7 / T6 (edit, /s/:schoolId/lessons/:lessonId). */
export function LessonFormPage() {
  const schoolId = useSchoolId();
  const { lessonId } = useParams();
  const scope = useScope(schoolId);
  const lesson = useStaffLesson(schoolId, lessonId);
  const today = scope.data?.school.today ?? null;

  if (lessonId) {
    return (
      <MobilePage title="تعديل الدرس" backTo={`/s/${schoolId}/lessons/list`}>
        <QueryState query={lesson}>
          {(l) => <LessonForm key={l.id} schoolId={schoolId} lesson={l} today={today} />}
        </QueryState>
      </MobilePage>
    );
  }

  return (
    <MobilePage title="إضافة درس جديد">
      {scope.isLoading ? (
        <PageLoader />
      ) : scope.data && scope.data.classes.length === 0 ? (
        <Alert color="orange" icon={<IconAlertTriangle />} title="لا توجد فصول مسندة إليك">
          لا يمكنك إضافة دروس قبل أن تسند إليك الإدارة فصلاً ومادة.
        </Alert>
      ) : (
        <LessonForm schoolId={schoolId} today={today} />
      )}
    </MobilePage>
  );
}

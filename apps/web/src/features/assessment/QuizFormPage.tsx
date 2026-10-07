import { useState } from 'react';
import { Alert, Button, Group, Modal, NumberInput, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconAlertTriangle, IconListNumbers, IconTrash } from '@tabler/icons-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ApiError } from '../../api/client';
import { useScope } from '../../api/hooks';
import { ClassSubjectSelect } from '../../components/ClassSubjectSelect';
import { IsoDateInput } from '../../components/IsoDateInput';
import { MobilePage } from '../../components/MobilePage';
import { PageLoader, QueryState } from '../../components/States';
import { notifyError, notifySuccess } from '../../lib/notify';
import { useSchoolId } from '../../lib/params';
import { useAssessment, useDeleteQuiz, useSaveQuiz } from './api';
import { dayLabel } from './format';
import { gradesLink } from './StaffPages';
import type { Assessment } from './types';

/** Highest max score the API accepts. */
const MAX_SCORE_LIMIT = 1000;
const DEFAULT_MAX_SCORE = 20;

interface FormValues {
  classId: string | null;
  subjectId: string | null;
  title: string;
  details: string;
  date: string | null;
  maxScore: number | '';
}

/** API field → form field, to show server validation messages next to the right input. */
const SERVER_FIELDS: Record<string, keyof FormValues> = {
  classSectionId: 'classId',
  subjectId: 'subjectId',
  title: 'title',
  details: 'details',
  date: 'date',
  maxScore: 'maxScore',
};

function QuizForm({
  schoolId,
  quiz,
  today,
  initialClassId,
  initialSubjectId,
}: {
  schoolId: string;
  quiz?: Assessment;
  today: string | null;
  initialClassId?: string | null;
  initialSubjectId?: string | null;
}) {
  const navigate = useNavigate();
  const scope = useScope(schoolId);
  const listPath = `/s/${schoolId}/exams/quizzes`;
  const save = useSaveQuiz(schoolId, quiz?.id);
  const remove = useDeleteQuiz(schoolId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The title follows the subject ("اختبار الرياضيات") until the user types their own.
  const [titleTouched, setTitleTouched] = useState(!!quiz);

  const subjectName = (classId: string | null, subjectId: string | null) =>
    scope.data?.classes.find((c) => c.id === classId)?.subjects.find((s) => s.id === subjectId)?.name;

  const form = useForm<FormValues>({
    initialValues: {
      classId: quiz?.classSectionId ?? initialClassId ?? null,
      subjectId: quiz?.subjectId ?? initialSubjectId ?? null,
      title:
        quiz?.title ??
        (() => {
          const name = subjectName(initialClassId ?? null, initialSubjectId ?? null);
          return name ? `اختبار ${name}` : '';
        })(),
      details: quiz?.details ?? '',
      date: quiz?.date ?? today,
      maxScore: quiz?.maxScore ?? DEFAULT_MAX_SCORE,
    },
    validate: {
      classId: (v) => (v ? null : 'اختر الفصل'),
      subjectId: (v) => (v ? null : 'اختر المادة'),
      title: (v) => (v.trim() ? null : 'عنوان الإختبار مطلوب'),
      date: (v) => (v ? null : 'اختر تاريخ الإختبار'),
      maxScore: (v) =>
        typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_SCORE_LIMIT
          ? null
          : `الدرجة النهائية رقم صحيح من 1 إلى ${MAX_SCORE_LIMIT}`,
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

  const submit = form.onSubmit((v) =>
    save.mutate(
      {
        classSectionId: v.classId ?? '',
        subjectId: v.subjectId ?? '',
        title: v.title.trim(),
        details: v.details.trim() || null,
        date: v.date ?? '',
        maxScore: typeof v.maxScore === 'number' ? v.maxScore : 0,
      },
      {
        onSuccess: () => {
          notifySuccess(quiz ? 'تم تعديل إعلان الإختبار' : 'تمت إضافة إعلان الإختبار');
          navigate(listPath);
        },
        onError: showServerErrors,
      },
    ),
  );

  const classError = form.errors.classId ?? form.errors.subjectId;
  const locked = !!quiz && quiz.scoredCount > 0;

  return (
    <>
      <form onSubmit={submit} noValidate>
        <Stack gap="sm">
          {quiz && (
            <Group justify="space-between" gap="xs">
              <Text size="sm" c="dimmed">
                تم رصد درجات {quiz.scoredCount} من {quiz.studentCount} طالب
              </Text>
              <Button
                component={Link}
                to={gradesLink(schoolId, quiz)}
                size="compact-sm"
                variant="light"
                leftSection={<IconListNumbers size={16} />}
              >
                رصد الدرجات
              </Button>
            </Group>
          )}
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
                const name = subjectName(classId, subjectId);
                if (!titleTouched && name) form.setFieldValue('title', `اختبار ${name}`);
              }}
            />
            {classError && (
              <Text c="red" size="xs" mt={4}>
                {classError}
              </Text>
            )}
            {locked && (
              <Text c="dimmed" size="xs" mt={4}>
                لا يمكن تغيير الفصل أو المادة بعد رصد الدرجات.
              </Text>
            )}
          </div>
          <TextInput
            label="عنوان الإختبار"
            placeholder="مثال: اختبار قصير - الكسور"
            required
            maxLength={200}
            {...form.getInputProps('title')}
            onChange={(e) => {
              setTitleTouched(true);
              form.setFieldValue('title', e.currentTarget.value);
            }}
          />
          <Textarea
            label="تفاصيل عن الإختبار"
            placeholder="مثال: سورة النور 1 - 50"
            autosize
            minRows={3}
            maxRows={8}
            maxLength={2000}
            {...form.getInputProps('details')}
          />
          <Group grow align="flex-start" gap="xs">
            <IsoDateInput
              label="تاريخ الإختبار"
              required
              value={form.values.date}
              onChange={(v) => form.setFieldValue('date', v)}
              error={form.errors.date}
              description={form.values.date ? dayLabel(form.values.date) : undefined}
            />
            <NumberInput
              label="الدرجة النهائية"
              required
              min={1}
              max={MAX_SCORE_LIMIT}
              allowDecimal={false}
              allowNegative={false}
              inputMode="numeric"
              {...form.getInputProps('maxScore')}
            />
          </Group>

          <Group grow mt="sm">
            <Button type="submit" size="md" loading={save.isPending}>
              {quiz ? 'تعديل' : 'اضافة'}
            </Button>
            {quiz && (
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
        </Stack>
      </form>

      {quiz && (
        <Modal opened={confirmDelete} onClose={() => setConfirmDelete(false)} title="حذف إعلان الإختبار" centered>
          {locked ? (
            <Text size="sm">تم رصد درجات لهذا الإختبار. احذف الدرجات من صفحة رصد الدرجات أولاً إذا كنت تريد حذفه.</Text>
          ) : (
            <Text size="sm">هل تريد حذف إعلان «{quiz.title}»؟ سيختفي من صفحات أولياء الأمور.</Text>
          )}
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={() => setConfirmDelete(false)}>
              إلغاء
            </Button>
            <Button
              color="red"
              disabled={locked}
              loading={remove.isPending}
              onClick={() =>
                remove.mutate(quiz.id, {
                  onSuccess: () => {
                    notifySuccess('تم حذف إعلان الإختبار');
                    setConfirmDelete(false);
                    navigate(listPath, { replace: true });
                  },
                  onError: notifyError,
                })
              }
            >
              حذف
            </Button>
          </Group>
        </Modal>
      )}
    </>
  );
}

/** S13 — add (/s/:schoolId/exams/quizzes/new) or edit (/s/:schoolId/exams/quizzes/:assessmentId) a quiz. */
export function QuizFormPage() {
  const schoolId = useSchoolId();
  const { assessmentId } = useParams();
  const [params] = useSearchParams();
  const scope = useScope(schoolId);
  const quiz = useAssessment(schoolId, assessmentId);
  const today = scope.data?.school.today ?? null;
  // Prefill from the quiz list filters, only with a class + subject the user may act on.
  const initialClass = scope.data?.classes.find((c) => c.id === params.get('classId'));
  const initialSubject = initialClass?.subjects.find((s) => s.id === params.get('subjectId'));

  if (assessmentId) {
    return (
      <MobilePage title="تعديل اعلان اختبار" backTo={`/s/${schoolId}/exams/quizzes`}>
        <QueryState query={quiz}>
          {(q) =>
            q.kind === 'quiz' ? (
              <QuizForm key={q.id} schoolId={schoolId} quiz={q} today={today} />
            ) : (
              <Alert color="orange" icon={<IconAlertTriangle />} title="امتحان ضمن جدول امتحانات">
                «{q.examPeriodName}» يُعدّل من صفحة جدول الإمتحانات.
              </Alert>
            )
          }
        </QueryState>
      </MobilePage>
    );
  }

  return (
    <MobilePage title="اضافة اعلان اختبار">
      {scope.isLoading ? (
        <PageLoader />
      ) : scope.data && scope.data.classes.length === 0 ? (
        <Alert color="orange" icon={<IconAlertTriangle />} title="لا توجد فصول مسندة إليك">
          لا يمكنك إضافة اختبارات قبل أن تسند إليك الإدارة فصلاً ومادة.
        </Alert>
      ) : (
        <QuizForm
          schoolId={schoolId}
          today={today}
          initialClassId={initialClass?.id ?? null}
          initialSubjectId={initialSubject?.id ?? null}
        />
      )}
    </MobilePage>
  );
}

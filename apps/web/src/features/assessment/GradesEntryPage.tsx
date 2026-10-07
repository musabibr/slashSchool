import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Group, NumberInput, Paper, Select, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconInfoCircle } from '@tabler/icons-react';
import { useSearchParams } from 'react-router';
import { ASSESSMENT_KIND_LABELS, formatDate } from '@slash/shared';
import { useScope } from '../../api/hooks';
import { ClassSubjectSelect } from '../../components/ClassSubjectSelect';
import { MobilePage } from '../../components/MobilePage';
import { EmptyState, PageLoader, QueryState } from '../../components/States';
import { notifyError, notifySuccess } from '../../lib/notify';
import { useSchoolId } from '../../lib/params';
import { useAssessments, useSaveScores, useScoreSheet } from './api';
import type { Assessment, ScoreSheet } from './types';

/** What the score input holds: a number, '' (empty) or an intermediate string such as '1.'. */
type Value = number | string;

/** The score to send: null for an empty input, NaN when the text is not a number. */
function toScore(v: Value): number | null {
  if (typeof v === 'number') return v;
  return v.trim() === '' ? null : Number(v);
}

/** Picker label: the quiz title, or the exam period's name for a timetable sitting. */
function assessmentLabel(a: Assessment): string {
  const name = a.kind === 'quiz' ? a.title : (a.examPeriodName ?? ASSESSMENT_KIND_LABELS[a.kind]);
  return `${name} — ${formatDate(a.date)}`;
}

/** The most recent assessment that has already taken place (else the earliest upcoming one). */
function defaultAssessment(list: Assessment[], today: string | undefined): Assessment | undefined {
  if (!list.length) return undefined;
  const past = today ? list.find((a) => a.date <= today) : list[0];
  return past ?? list[list.length - 1];
}

/** ?classId&subjectId&assessmentId in the URL, so links from the quiz list open the right sheet. */
function useGradeParams() {
  const [params, setParams] = useSearchParams();
  const value = {
    classId: params.get('classId') || null,
    subjectId: params.get('subjectId') || null,
    assessmentId: params.get('assessmentId') || null,
  };
  const set = (next: Partial<typeof value>) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        for (const [key, v] of Object.entries(next)) {
          if (v) p.set(key, v);
          else p.delete(key);
        }
        return p;
      },
      { replace: true },
    );
  return { ...value, set };
}

function ScoreEditor({ schoolId, sheet }: { schoolId: string; sheet: ScoreSheet }) {
  const { assessment } = sheet;
  const max = assessment.maxScore;
  const initial = useMemo(
    () => Object.fromEntries(sheet.students.map((s) => [s.id, s.score ?? ''])) as Record<string, Value>,
    [sheet],
  );
  const [values, setValues] = useState<Record<string, Value>>(initial);
  const [showErrors, setShowErrors] = useState(false);
  useEffect(() => setValues(initial), [initial]);
  const save = useSaveScores(schoolId);

  const errorOf = (v: Value) => {
    const score = toScore(v);
    return score !== null && (Number.isNaN(score) || score < 0 || score > max) ? `من 0 إلى ${max}` : null;
  };
  const changed = sheet.students.filter((s) => toScore(values[s.id] ?? '') !== s.score);
  const hasScores = sheet.students.some((s) => s.score !== null);
  const filled = sheet.students.filter((s) => toScore(values[s.id] ?? '') !== null).length;

  const submit = () => {
    if (changed.some((s) => errorOf(values[s.id] ?? ''))) {
      setShowErrors(true);
      return;
    }
    if (!changed.length) {
      notifySuccess('لا توجد تغييرات للحفظ');
      return;
    }
    save.mutate(
      {
        id: assessment.id,
        scores: changed.map((s) => ({ studentId: s.id, score: toScore(values[s.id] ?? '') })),
      },
      {
        onSuccess: () => {
          setShowErrors(false);
          notifySuccess(hasScores ? 'تم تعديل الدرجات' : 'تمت إضافة الدرجات');
        },
        onError: notifyError,
      },
    );
  };

  if (!sheet.students.length) return <EmptyState message="لا يوجد طلاب في هذا الفصل" />;

  return (
    <Stack gap="sm">
      <Group justify="space-between" gap="xs">
        <Text size="sm" fw={600}>
          الدرجة النهائية: {max}
        </Text>
        <Badge variant="light" color={filled === sheet.students.length ? 'teal' : 'blue'}>
          تم رصد {filled}/{sheet.students.length}
        </Badge>
      </Group>
      {sheet.students.map((s, i) => {
        const v = values[s.id] ?? '';
        const error = showErrors ? errorOf(v) : null;
        return (
          <Paper key={s.id} withBorder radius="md" px="sm" py={8}>
            <Group justify="space-between" wrap="nowrap" gap="xs">
              <Stack gap={0} style={{ minWidth: 0 }}>
                <Text fw={600} truncate>
                  {i + 1}. {s.fullName}
                </Text>
                <Text size="xs" c="dimmed">
                  {s.code}
                </Text>
              </Stack>
              <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
                <NumberInput
                  aria-label={`درجة ${s.fullName}`}
                  w={84}
                  min={0}
                  max={max}
                  step={0.5}
                  decimalScale={2}
                  allowNegative={false}
                  hideControls
                  inputMode="decimal"
                  placeholder="—"
                  value={v}
                  error={error ? true : undefined}
                  styles={{ input: { textAlign: 'center', fontWeight: 700 } }}
                  onChange={(next) => setValues((prev) => ({ ...prev, [s.id]: next }))}
                />
                <Text size="sm" c="dimmed" w={48}>
                  من {max}
                </Text>
              </Group>
            </Group>
            {error && (
              <Text c="red" size="xs" mt={4}>
                الدرجة يجب أن تكون {error}
              </Text>
            )}
          </Paper>
        );
      })}
      {changed.length > 0 && (
        <Text size="xs" c="orange.8" ta="center">
          {changed.length} تغيير لم يُحفظ بعد
        </Text>
      )}
      <Button fullWidth size="md" loading={save.isPending} onClick={submit}>
        {hasScores ? 'تعديل' : 'اضافة'}
      </Button>
      <Text size="xs" c="dimmed" ta="center">
        اترك الخانة فارغة لحذف درجة الطالب. الدرجات المحفوظة تظهر لولي الأمر فوراً في الاختبارات، وبعد نشر النتائج في
        الامتحانات.
      </Text>
    </Stack>
  );
}

function AssessmentPicker({
  schoolId,
  classId,
  subjectId,
  assessmentId,
  onChange,
}: {
  schoolId: string;
  classId: string;
  subjectId: string;
  assessmentId: string | null;
  onChange: (id: string | null) => void;
}) {
  const today = useScope(schoolId).data?.school.today;
  const list = useAssessments(schoolId, { classId, subjectId });
  const items = list.isPlaceholderData ? undefined : list.data;
  const selected = items?.find((a) => a.id === assessmentId);

  // Preselect the latest assessment that already took place.
  useEffect(() => {
    if (!items || selected) return;
    const fallback = defaultAssessment(items, today);
    if (fallback && fallback.id !== assessmentId) onChange(fallback.id);
  }, [items, selected, today, assessmentId, onChange]);

  const quizzes = (items ?? []).filter((a) => a.kind === 'quiz');
  const exams = (items ?? []).filter((a) => a.kind !== 'quiz');
  const data = [
    ...(quizzes.length ? [{ group: 'الاختبارات', items: quizzes.map((a) => ({ value: a.id, label: assessmentLabel(a) })) }] : []),
    ...(exams.length ? [{ group: 'الإمتحانات', items: exams.map((a) => ({ value: a.id, label: assessmentLabel(a) })) }] : []),
  ];

  return (
    <QueryState
      query={list}
      empty="لا توجد اختبارات أو امتحانات لهذه المادة في هذا الفصل بعد"
      isEmpty={(l) => l.length === 0}
    >
      {() => (
        <Stack gap="sm">
          <Select
            label="الاختبار / الامتحان"
            placeholder="اختر الاختبار"
            data={data}
            value={selected ? selected.id : null}
            onChange={onChange}
            allowDeselect={false}
            comboboxProps={{ withinPortal: true }}
          />
          {selected ? (
            <ScoreSheetLoader schoolId={schoolId} assessment={selected} />
          ) : (
            <PageLoader />
          )}
        </Stack>
      )}
    </QueryState>
  );
}

function ScoreSheetLoader({ schoolId, assessment }: { schoolId: string; assessment: Assessment }) {
  const sheet = useScoreSheet(schoolId, assessment.id);
  const today = useScope(schoolId).data?.school.today;
  return (
    <Stack gap="sm">
      {today && assessment.date > today && (
        <Alert color="orange" variant="light" icon={<IconInfoCircle />} p="xs">
          <Text size="sm">موعد هذا الاختبار لم يحن بعد ({formatDate(assessment.date)}).</Text>
        </Alert>
      )}
      <QueryState query={sheet}>
        {(data) => <ScoreEditor key={data.assessment.id} schoolId={schoolId} sheet={data} />}
      </QueryState>
    </Stack>
  );
}

/** S14 / T7 — "الدرجات": class + subject, an assessment picker, then one score per student. */
export function GradesEntryPage() {
  const schoolId = useSchoolId();
  const scope = useScope(schoolId);
  const { classId, subjectId, assessmentId, set } = useGradeParams();
  const classes = scope.data?.classes ?? [];
  const cls = classes.find((c) => c.id === classId);
  const validClass = cls ? classId : null;
  const validSubject = cls?.subjects.some((s) => s.id === subjectId) ? subjectId : null;

  return (
    <MobilePage title="الدرجات">
      {scope.isLoading ? (
        <PageLoader />
      ) : classes.length === 0 ? (
        <Alert color="orange" icon={<IconAlertTriangle />} title="لا توجد فصول مسندة إليك">
          لا يمكنك رصد الدرجات قبل أن تسند إليك الإدارة فصلاً ومادة.
        </Alert>
      ) : (
        <Stack gap="md">
          <ClassSubjectSelect
            schoolId={schoolId}
            classId={validClass}
            subjectId={validSubject}
            required
            onChange={(next) => set({ ...next, assessmentId: null })}
          />
          {validClass && validSubject ? (
            <AssessmentPicker
              key={`${validClass}:${validSubject}`}
              schoolId={schoolId}
              classId={validClass}
              subjectId={validSubject}
              assessmentId={assessmentId}
              onChange={(id) => set({ assessmentId: id })}
            />
          ) : (
            <Text c="dimmed" size="sm" ta="center" py="md">
              اختر الفصل والمادة لعرض الطلاب
            </Text>
          )}
        </Stack>
      )}
    </MobilePage>
  );
}

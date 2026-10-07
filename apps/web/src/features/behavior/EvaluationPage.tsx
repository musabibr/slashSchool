import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  ColorSwatch,
  Group,
  Menu,
  Paper,
  Select,
  Stack,
  Text,
  Textarea,
  UnstyledButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconChevronDown, IconMessagePlus, IconSend } from '@tabler/icons-react';
import { useSearchParams } from 'react-router';
import { EVALUATION_RATINGS, isIsoDate, type EvaluationRating } from '@slash/shared';
import { useClassStudents, useScope } from '../../api/hooks';
import type { ClassStudent } from '../../api/types';
import { ClassSubjectSelect } from '../../components/ClassSubjectSelect';
import { IsoDateInput } from '../../components/IsoDateInput';
import { MobilePage } from '../../components/MobilePage';
import { EmptyState, ErrorState, PageLoader } from '../../components/States';
import { notifyError, notifySuccess } from '../../lib/notify';
import { useSchoolId } from '../../lib/params';
import { useEvaluations, useSaveEvaluations, type EvaluationEntry } from './api';
import { RATING_COLORS, RATING_OPTIONS } from './ui';

interface Selection {
  classId: string | null;
  subjectId: string | null;
  date: string | null;
}

/** ?classId&subjectId&date in the URL, so a reload or "back" keeps the sheet. */
function useSelectionParams(): [Selection, (next: Selection) => void] {
  const [params, setParams] = useSearchParams();
  const rawDate = params.get('date');
  const value: Selection = {
    classId: params.get('classId') || null,
    subjectId: params.get('subjectId') || null,
    date: rawDate && isIsoDate(rawDate) ? rawDate : null,
  };
  const set = (next: Selection) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        for (const key of ['classId', 'subjectId', 'date'] as const) {
          const v = next[key];
          if (v) p.set(key, v);
          else p.delete(key);
        }
        return p;
      },
      { replace: true },
    );
  return [value, set];
}

/** S17 / T9 — "تقييم الطلبة": class + subject + day, then a rating and an optional comment per student. */
export function EvaluationPage() {
  const schoolId = useSchoolId();
  const scope = useScope(schoolId);
  const [selection, setSelection] = useSelectionParams();
  const today = scope.data?.school.today ?? null;
  const date = selection.date ?? today;
  const classes = scope.data?.classes;

  // Only one class and subject to choose from (a typical teacher): pick them straight away.
  useEffect(() => {
    if (selection.classId || !classes || classes.length !== 1) return;
    const [only] = classes;
    setSelection({
      ...selection,
      classId: only.id,
      subjectId: only.subjects.length === 1 ? only.subjects[0].id : null,
    });
  }, [classes, selection, setSelection]);

  return (
    <MobilePage title="تقييم الطلبة">
      <Stack gap="md">
        <ClassSubjectSelect
          schoolId={schoolId}
          classId={selection.classId}
          subjectId={selection.subjectId}
          autoSelect
          required
          onChange={({ classId, subjectId }) => setSelection({ classId, subjectId, date: selection.date })}
        />
        <IsoDateInput
          label="التاريخ"
          required
          maxDate={today ?? undefined}
          value={date}
          onChange={(v) => setSelection({ ...selection, date: v })}
        />
        {scope.error ? (
          <ErrorState error={scope.error} onRetry={() => scope.refetch()} />
        ) : !selection.classId || !selection.subjectId ? (
          <Text c="dimmed" size="sm" ta="center" py="md">
            اختر الفصل والمادة لعرض قائمة الطلاب
          </Text>
        ) : !date ? (
          <Text c="dimmed" size="sm" ta="center" py="md">
            اختر التاريخ
          </Text>
        ) : (
          <EvaluationSheet
            key={`${selection.classId}:${selection.subjectId}:${date}`}
            schoolId={schoolId}
            classId={selection.classId}
            subjectId={selection.subjectId}
            date={date}
          />
        )}
      </Stack>
    </MobilePage>
  );
}

function EvaluationSheet({
  schoolId,
  classId,
  subjectId,
  date,
}: {
  schoolId: string;
  classId: string;
  subjectId: string;
  date: string;
}) {
  const students = useClassStudents(schoolId, classId);
  const saved = useEvaluations(schoolId, classId, subjectId, date);
  if (students.isLoading || saved.isLoading) return <PageLoader />;
  const error = students.error ?? saved.error;
  if (error) {
    return (
      <ErrorState
        error={error}
        onRetry={() => {
          void students.refetch();
          void saved.refetch();
        }}
      />
    );
  }
  if (!students.data || !saved.data) return null;
  if (!students.data.length) return <EmptyState message="لا يوجد طلاب منتظمون في هذا الفصل" />;
  return (
    <SheetEditor
      schoolId={schoolId}
      classId={classId}
      subjectId={subjectId}
      date={date}
      students={students.data}
      saved={saved.data}
    />
  );
}

interface Row {
  rating: EvaluationRating | null;
  comment: string;
  /** The comment box is shown. */
  open: boolean;
}

function initialRows(students: ClassStudent[], saved: EvaluationEntry[]): Record<string, Row> {
  const byId = new Map(saved.map((e) => [e.studentId, e]));
  return Object.fromEntries(
    students.map((s) => {
      const e = byId.get(s.id);
      return [s.id, { rating: e?.rating ?? null, comment: e?.comment ?? '', open: !!e?.comment }];
    }),
  );
}

function SheetEditor({
  schoolId,
  classId,
  subjectId,
  date,
  students,
  saved,
}: {
  schoolId: string;
  classId: string;
  subjectId: string;
  date: string;
  students: ClassStudent[];
  saved: EvaluationEntry[];
}) {
  const [rows, setRows] = useState<Record<string, Row>>(() => initialRows(students, saved));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useSaveEvaluations(schoolId);

  const dirty = useMemo(() => {
    const byId = new Map(saved.map((e) => [e.studentId, e]));
    return students.some((s) => {
      const row = rows[s.id];
      const prev = byId.get(s.id);
      return (row?.rating ?? null) !== (prev?.rating ?? null) || (row?.comment.trim() ?? '') !== (prev?.comment ?? '');
    });
  }, [rows, saved, students]);
  const ratedCount = students.filter((s) => rows[s.id]?.rating).length;

  const update = (id: string, patch: Partial<Row>) => {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    if (errors[id]) setErrors(({ [id]: _removed, ...rest }) => rest);
  };

  const rateAll = (rating: EvaluationRating) => {
    setRows((prev) => Object.fromEntries(Object.entries(prev).map(([id, row]) => [id, { ...row, rating }])));
    setErrors({});
  };

  const submit = () => {
    const problems: Record<string, string> = {};
    for (const s of students) {
      const row = rows[s.id];
      if (row && !row.rating && row.comment.trim()) problems[s.id] = 'اختر التقييم قبل إضافة تعليق';
    }
    setErrors(problems);
    if (Object.keys(problems).length) {
      notifications.show({ color: 'red', message: 'اختر التقييم للطلاب الذين أضفت لهم تعليقاً', autoClose: 5000 });
      return;
    }
    save.mutate(
      {
        classSectionId: classId,
        subjectId,
        date,
        items: students.map((s) => {
          const row = rows[s.id];
          return {
            studentId: s.id,
            rating: row?.rating ?? null,
            comment: row?.rating ? row.comment.trim() || null : null,
          };
        }),
      },
      { onSuccess: () => notifySuccess('تم حفظ التقييم'), onError: notifyError },
    );
  };

  return (
    <Stack gap="sm">
      <Group justify="space-between" wrap="nowrap">
        <Text size="sm" c="dimmed">
          تم تقييم {ratedCount} من {students.length} طالب
        </Text>
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <Button variant="light" size="xs" rightSection={<IconChevronDown size={14} />}>
              تقييم الجميع
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            {RATING_OPTIONS.map((o) => (
              <Menu.Item
                key={o.value}
                leftSection={<ColorSwatch size={12} color={`var(--mantine-color-${RATING_COLORS[o.value]}-6)`} />}
                onClick={() => rateAll(o.value)}
              >
                {o.label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      </Group>

      {students.map((s) => {
        const row = rows[s.id] ?? { rating: null, comment: '', open: false };
        return (
          <Paper key={s.id} withBorder radius="md" p="sm">
            <Group justify="space-between" wrap="nowrap" gap="xs">
              <Text fw={600} size="sm" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                {s.fullName}
              </Text>
              <Select
                aria-label={`تقييم ${s.fullName}`}
                placeholder="التقييم"
                data={RATING_OPTIONS}
                value={row.rating}
                onChange={(v) => update(s.id, { rating: isRating(v) ? v : null })}
                clearable
                w={150}
                style={{ flexShrink: 0 }}
                leftSection={
                  row.rating ? (
                    <ColorSwatch size={12} color={`var(--mantine-color-${RATING_COLORS[row.rating]}-6)`} />
                  ) : undefined
                }
                comboboxProps={{ withinPortal: true }}
              />
            </Group>
            {row.open ? (
              <Textarea
                mt="xs"
                placeholder="التعليق"
                autosize
                minRows={2}
                maxRows={6}
                maxLength={500}
                value={row.comment}
                onChange={(e) => update(s.id, { comment: e.currentTarget.value })}
                error={errors[s.id]}
              />
            ) : (
              <UnstyledButton mt={6} onClick={() => update(s.id, { open: true })}>
                <Group gap={4} c="cyan.8">
                  <IconMessagePlus size={16} />
                  <Text size="xs" fw={600}>
                    اضف تعليق
                  </Text>
                </Group>
              </UnstyledButton>
            )}
          </Paper>
        );
      })}

      <Box
        pos="sticky"
        bottom={0}
        py="sm"
        style={{ background: 'var(--mantine-color-body)', borderTop: '1px solid var(--mantine-color-gray-2)' }}
      >
        <Button fullWidth size="md" onClick={submit} loading={save.isPending} leftSection={<IconSend size={18} />}>
          ارسال
        </Button>
        {!dirty && saved.length > 0 && (
          <Text size="xs" c="dimmed" ta="center" mt={4}>
            التقييم محفوظ، ويمكنك تعديله في أي وقت
          </Text>
        )}
      </Box>
    </Stack>
  );
}

function isRating(v: string | null): v is EvaluationRating {
  return !!v && (EVALUATION_RATINGS as readonly string[]).includes(v);
}

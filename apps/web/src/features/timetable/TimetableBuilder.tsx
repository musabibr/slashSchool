import { useMemo, useRef, useState } from 'react';
import { ActionIcon, Button, Group, Paper, Select, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { MAX_PERIODS_PER_DAY, periodLabel, WEEKDAY_LABELS } from '@slash/shared';
import { useScope } from '../../api/hooks';
import { ClassSubjectSelect } from '../../components/ClassSubjectSelect';
import { EmptyState, QueryState } from '../../components/States';
import { notifyError, notifySuccess } from '../../lib/notify';
import { defaultWeekday, useClassTimetable, useSaveTimetableDay, type ClassSlot, type SlotInput } from './api';
import { DaySelect } from './DaySelect';

const ALL_PERIODS = Array.from({ length: MAX_PERIODS_PER_DAY }, (_, i) => i + 1);

interface Row {
  key: string;
  period: number;
  subjectId: string | null;
  teacherId: string | null;
}

const toRows = (slots: ClassSlot[]): Row[] =>
  slots.map((s) => ({ key: s.id, period: s.period, subjectId: s.subjectId, teacherId: s.teacherId }));

const signature = (rows: Array<Pick<Row, 'period' | 'subjectId' | 'teacherId'>>) =>
  [...rows]
    .sort((a, b) => a.period - b.period)
    .map((r) => `${r.period}:${r.subjectId ?? ''}:${r.teacherId ?? ''}`)
    .join('|');

/** S16 — class + day pickers, then one row per period (subject, teacher, delete), "+" and "ارسال". */
export function TimetableBuilder({ schoolId }: { schoolId: string }) {
  const scope = useScope(schoolId);
  const [classId, setClassId] = useState<string | null>(null);
  const [weekday, setWeekday] = useState(() => defaultWeekday(scope.data?.school.today));
  const q = useClassTimetable(schoolId, classId);
  return (
    <Stack gap="md">
      <ClassSubjectSelect
        schoolId={schoolId}
        classId={classId}
        withSubject={false}
        autoSelect
        required
        onChange={(next) => setClassId(next.classId)}
      />
      <DaySelect value={weekday} onChange={setWeekday} />
      {!classId ? (
        <Text c="dimmed" size="sm" ta="center" py="md">
          اختر الفصل لعرض جدوله
        </Text>
      ) : (
        <QueryState query={q}>
          {(slots) => (
            <DayEditor
              key={`${classId}:${weekday}`}
              schoolId={schoolId}
              classId={classId}
              weekday={weekday}
              initial={slots.filter((s) => s.weekday === weekday)}
            />
          )}
        </QueryState>
      )}
    </Stack>
  );
}

function DayEditor({
  schoolId,
  classId,
  weekday,
  initial,
}: {
  schoolId: string;
  classId: string;
  weekday: number;
  initial: ClassSlot[];
}) {
  const scope = useScope(schoolId);
  const subjects = useMemo(
    () => (scope.data?.subjects ?? []).map((s) => ({ value: s.id, label: s.name })),
    [scope.data?.subjects],
  );
  const teachers = useMemo(
    () => (scope.data?.teachers ?? []).map((t) => ({ value: t.id, label: t.fullName })),
    [scope.data?.teachers],
  );
  const [rows, setRows] = useState<Row[]>(() => toRows(initial));
  const [baseline, setBaseline] = useState(() => signature(toRows(initial)));
  const [showErrors, setShowErrors] = useState(false);
  const nextKey = useRef(0);
  const save = useSaveTimetableDay(schoolId);
  const dirty = signature(rows) !== baseline;
  const full = rows.length >= MAX_PERIODS_PER_DAY;

  const update = (key: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)).sort((a, b) => a.period - b.period));

  const addRow = () => {
    const used = new Set(rows.map((r) => r.period));
    const period = ALL_PERIODS.find((p) => !used.has(p));
    if (!period) return;
    nextKey.current += 1;
    setRows((prev) =>
      [...prev, { key: `new-${nextKey.current}`, period, subjectId: null, teacherId: null }].sort(
        (a, b) => a.period - b.period,
      ),
    );
  };

  const submit = () => {
    if (rows.some((r) => !r.subjectId)) {
      setShowErrors(true);
      return;
    }
    const slots: SlotInput[] = rows.map((r) => ({
      period: r.period,
      subjectId: r.subjectId ?? '',
      teacherId: r.teacherId,
    }));
    save.mutate(
      { classId, weekday, slots },
      {
        onSuccess: (saved) => {
          setBaseline(signature(toRows(saved)));
          setShowErrors(false);
          notifySuccess(`تم حفظ جدول يوم ${WEEKDAY_LABELS[weekday]}`);
        },
        onError: notifyError,
      },
    );
  };

  return (
    <Stack gap="sm">
      {rows.length === 0 && <EmptyState message="لا توجد حصص في هذا اليوم، اضغط + لإضافة حصة" />}
      {rows.map((row) => {
        const taken = new Set(rows.filter((r) => r.key !== row.key).map((r) => r.period));
        return (
          <Paper key={row.key} withBorder radius="md" p="xs">
            <Group justify="space-between" wrap="nowrap" mb={6}>
              <Select
                size="xs"
                w={150}
                aria-label="الحصة"
                data={ALL_PERIODS.filter((p) => !taken.has(p)).map((p) => ({
                  value: String(p),
                  label: periodLabel(p),
                }))}
                value={String(row.period)}
                onChange={(v) => v && update(row.key, { period: Number(v) })}
                allowDeselect={false}
                comboboxProps={{ withinPortal: true }}
                styles={{ input: { fontWeight: 700 } }}
              />
              <ActionIcon
                variant="subtle"
                color="red"
                aria-label={`حذف ${periodLabel(row.period)}`}
                onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
              >
                <IconTrash size={18} />
              </ActionIcon>
            </Group>
            <SimpleGrid cols={2} spacing="xs">
              <Select
                aria-label="المادة"
                placeholder="المادة"
                data={subjects}
                value={row.subjectId}
                onChange={(v) => update(row.key, { subjectId: v })}
                searchable
                nothingFoundMessage="لا توجد مواد"
                error={showErrors && !row.subjectId ? 'اختر المادة' : undefined}
                comboboxProps={{ withinPortal: true }}
              />
              <Select
                aria-label="الأستاذ"
                placeholder="الأستاذ"
                data={teachers}
                value={row.teacherId}
                onChange={(v) => update(row.key, { teacherId: v })}
                searchable
                clearable
                nothingFoundMessage="لا يوجد أساتذة"
                comboboxProps={{ withinPortal: true }}
              />
            </SimpleGrid>
          </Paper>
        );
      })}
      <Button variant="light" leftSection={<IconPlus size={18} />} onClick={addRow} disabled={full}>
        {full ? `الحد الأقصى ${MAX_PERIODS_PER_DAY} حصص` : 'إضافة حصة'}
      </Button>
      {dirty && (
        <Text size="xs" c="orange.8" ta="center">
          لم يتم حفظ التغييرات بعد
        </Text>
      )}
      <Button fullWidth size="md" loading={save.isPending} onClick={submit}>
        ارسال
      </Button>
    </Stack>
  );
}

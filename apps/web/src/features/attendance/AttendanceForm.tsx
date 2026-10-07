import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { IconCheck, IconChevronLeft } from '@tabler/icons-react';
import { weekdayOf, WEEKDAY_LABELS } from '@slash/shared';
import { useScope } from '../../api/hooks';
import { ClassSubjectSelect } from '../../components/ClassSubjectSelect';
import { IsoDateInput } from '../../components/IsoDateInput';
import { EmptyState, QueryState } from '../../components/States';
import { dayjs } from '../../lib/dayjs';
import { notifyError, notifySuccess } from '../../lib/notify';
import { useAttendanceSessions, useClassAttendance, useSaveAttendance, type ClassAttendance } from './api';
import { dayLabel, type ClassDate } from './helpers';

/**
 * S9/S10 record form: class + date pickers, then the student checklist (checked = absent).
 * With `recentWhenNoDate`, choosing a class without a date lists its previously recorded days.
 */
export function AttendanceForm({
  schoolId,
  classId,
  date,
  onChange,
  recentWhenNoDate = false,
  dateClearable = false,
  inline = false,
}: ClassDate & {
  schoolId: string;
  onChange: (next: ClassDate) => void;
  recentWhenNoDate?: boolean;
  dateClearable?: boolean;
  /** Class and date side by side (desktop). */
  inline?: boolean;
}) {
  const scope = useScope(schoolId);
  const today = scope.data?.school.today;
  const yearStart = scope.data?.academicYear?.startsOn;

  return (
    <Stack gap="md">
      <SimpleGrid cols={inline ? 2 : 1} spacing="sm">
        <ClassSubjectSelect
          schoolId={schoolId}
          classId={classId}
          withSubject={false}
          autoSelect
          required
          onChange={(next) => onChange({ classId: next.classId, date })}
        />
        <IsoDateInput
          label="التاريخ"
          placeholder="اختر التاريخ"
          value={date}
          onChange={(v) => onChange({ classId, date: v })}
          maxDate={today}
          minDate={yearStart}
          clearable={dateClearable}
          description={date ? WEEKDAY_LABELS[weekdayOf(date)] : undefined}
          required
        />
      </SimpleGrid>
      {!classId ? (
        <Text c="dimmed" size="sm" ta="center" py="md">
          اختر الفصل لعرض قائمة الطلاب
        </Text>
      ) : !date ? (
        recentWhenNoDate ? (
          <RecentSessions schoolId={schoolId} classId={classId} onPick={(d) => onChange({ classId, date: d })} />
        ) : (
          <Text c="dimmed" size="sm" ta="center" py="md">
            اختر التاريخ
          </Text>
        )
      ) : (
        <AttendanceChecklist key={`${classId}:${date}`} schoolId={schoolId} classId={classId} date={date} />
      )}
    </Stack>
  );
}

/** Previously recorded days of a class (newest first); picking one opens it for editing. */
export function RecentSessions({
  schoolId,
  classId,
  selectedDate,
  onPick,
}: {
  schoolId: string;
  classId: string;
  selectedDate?: string | null;
  onPick: (date: string) => void;
}) {
  const q = useAttendanceSessions(schoolId, classId);
  return (
    <Stack gap="xs">
      <Text fw={700}>السجلات السابقة</Text>
      <QueryState query={q} empty="لم يسجل غياب لهذا الفصل بعد" isEmpty={(rows) => rows.length === 0}>
        {(rows) => (
          <Stack gap={6}>
            {rows.map((s) => (
              <UnstyledButton key={s.date} onClick={() => onPick(s.date)} aria-label={dayLabel(s.date)}>
                <Paper
                  withBorder
                  radius="md"
                  px="sm"
                  py={8}
                  bg={selectedDate === s.date ? 'cyan.0' : undefined}
                  style={{ borderColor: selectedDate === s.date ? 'var(--mantine-color-cyan-5)' : undefined }}
                >
                  <Group justify="space-between" wrap="nowrap" gap="xs">
                    <Box style={{ minWidth: 0 }}>
                      <Text fw={600} size="sm">
                        {dayLabel(s.date)}
                      </Text>
                      {s.recordedByName && (
                        <Text size="xs" c="dimmed" truncate>
                          {s.recordedByName}
                        </Text>
                      )}
                    </Box>
                    <Group gap={6} wrap="nowrap">
                      <Badge color={s.absentCount ? 'red' : 'teal'} variant="light">
                        {s.absentCount ? `${s.absentCount} غائب` : 'لا غياب'}
                      </Badge>
                      <IconChevronLeft size={16} color="var(--mantine-color-gray-6)" />
                    </Group>
                  </Group>
                </Paper>
              </UnstyledButton>
            ))}
          </Stack>
        )}
      </QueryState>
    </Stack>
  );
}

function AttendanceChecklist({ schoolId, classId, date }: { schoolId: string; classId: string; date: string }) {
  const q = useClassAttendance(schoolId, classId, date);
  return <QueryState query={q}>{(data) => <ChecklistEditor schoolId={schoolId} data={data} />}</QueryState>;
}

function initialNotes(data: ClassAttendance): Record<string, string> {
  return Object.fromEntries(data.students.filter((s) => s.note).map((s) => [s.id, s.note ?? '']));
}

function ChecklistEditor({ schoolId, data }: { schoolId: string; data: ClassAttendance }) {
  const [absent, setAbsent] = useState<Set<string>>(
    () => new Set(data.students.filter((s) => s.absent).map((s) => s.id)),
  );
  const [notes, setNotes] = useState<Record<string, string>>(() => initialNotes(data));
  const [justSaved, setJustSaved] = useState(false);
  const save = useSaveAttendance(schoolId);

  const dirty = useMemo(() => {
    const saved = data.students.filter((s) => s.absent);
    if (saved.length !== absent.size) return true;
    return saved.some((s) => !absent.has(s.id) || (s.note ?? '') !== (notes[s.id] ?? '').trim());
  }, [data, absent, notes]);

  if (!data.students.length) return <EmptyState message="لا يوجد طلاب منتظمون في هذا الفصل" />;

  const toggle = (id: string, checked: boolean) => {
    setJustSaved(false);
    setAbsent((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const submit = () => {
    const ids = data.students.filter((s) => absent.has(s.id)).map((s) => s.id);
    const payloadNotes: Record<string, string> = {};
    for (const id of ids) {
      const note = notes[id]?.trim();
      if (note) payloadNotes[id] = note;
    }
    save.mutate(
      { classId: data.classSectionId, date: data.date, absentStudentIds: ids, notes: payloadNotes },
      {
        onSuccess: (saved) => {
          setJustSaved(true);
          notifySuccess(data.recorded ? 'تم تحديث الغياب' : 'تم تسجيل الغياب');
          setNotes(initialNotes(saved));
        },
        onError: notifyError,
      },
    );
  };

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center" gap="xs">
        {data.recorded ? (
          <Stack gap={0}>
            <Badge color="teal" variant="light" w="fit-content">
              تم التسجيل
            </Badge>
            {data.updatedAt && (
              <Text size="xs" c="dimmed">
                {data.recordedByName ? `${data.recordedByName} — ` : ''}
                {dayjs(data.updatedAt).format('D/M/YYYY h:mm A')}
              </Text>
            )}
          </Stack>
        ) : (
          <Badge color="orange" variant="light">
            لم يسجل بعد
          </Badge>
        )}
        <Group gap="xs" wrap="nowrap">
          <Text fw={700} c={absent.size ? 'red.7' : undefined}>
            الغائبون: {absent.size} من {data.students.length}
          </Text>
          {absent.size > 0 && (
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => {
                setJustSaved(false);
                setAbsent(new Set());
              }}
            >
              الكل حاضر
            </Button>
          )}
        </Group>
      </Group>

      <Stack gap={6}>
        {data.students.map((s) => {
          const isAbsent = absent.has(s.id);
          return (
            <Paper
              key={s.id}
              withBorder
              radius="md"
              px="sm"
              py={8}
              bg={isAbsent ? 'red.0' : undefined}
              style={{ borderColor: isAbsent ? 'var(--mantine-color-red-5)' : undefined }}
            >
              <Checkbox
                color="red"
                size="md"
                checked={isAbsent}
                onChange={(e) => toggle(s.id, e.currentTarget.checked)}
                label={
                  <Group gap={6} wrap="nowrap">
                    <Text fw={600} c={isAbsent ? 'red.8' : undefined}>
                      {s.fullName}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {s.code}
                    </Text>
                  </Group>
                }
                styles={{ body: { alignItems: 'center' }, labelWrapper: { flex: 1 } }}
              />
              {isAbsent && (
                <TextInput
                  mt={6}
                  size="xs"
                  placeholder="ملاحظة (اختياري)"
                  aria-label={`ملاحظة غياب ${s.fullName}`}
                  maxLength={500}
                  value={notes[s.id] ?? ''}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setJustSaved(false);
                    setNotes((prev) => ({ ...prev, [s.id]: value }));
                  }}
                />
              )}
            </Paper>
          );
        })}
      </Stack>

      <Box py="xs" style={{ position: 'sticky', bottom: 0, background: 'var(--mantine-color-body)', zIndex: 2 }}>
        {justSaved && !dirty && (
          <Alert color="teal" variant="light" icon={<IconCheck size={18} />} mb="xs" py={6}>
            {data.recorded ? 'تم حفظ الغياب' : 'تم تسجيل الغياب'} — {dayLabel(data.date)}
          </Alert>
        )}
        <Button fullWidth size="md" color="red" loading={save.isPending} onClick={submit}>
          {data.recorded ? 'تحديث الغياب' : 'تسجيل الغياب'}
        </Button>
      </Box>
    </Stack>
  );
}

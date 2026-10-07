import { useMemo, useState } from 'react';
import { Alert, Button, Group, Modal, Paper, Select, Stack, Switch, Table, Text, UnstyledButton } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { MAX_PERIODS_PER_DAY, periodLabel, WEEKDAY_LABELS } from '@slash/shared';
import { useScope } from '../../api/hooks';
import { AdminPage } from '../../components/AdminPage';
import { EmptyState, PageLoader, QueryState } from '../../components/States';
import { errorMessage, notifySuccess } from '../../lib/notify';
import { useSchoolId } from '../../lib/params';
import css from './AdminTimetablePage.module.css';
import { useClassTimetable, useSaveTimetableDay, WEEK_COLUMNS, type ClassSlot, type SlotInput } from './api';

const PERIODS = Array.from({ length: MAX_PERIODS_PER_DAY }, (_, i) => i + 1);
const SATURDAY = 6;

interface Cell {
  weekday: number;
  period: number;
}

const toInput = (s: ClassSlot): SlotInput => ({ period: s.period, subjectId: s.subjectId, teacherId: s.teacherId });

/** Director's timetables page: weekly grid (periods × days) for one class; click a cell to edit it. */
export function AdminTimetablePage() {
  const schoolId = useSchoolId();
  const scope = useScope(schoolId);
  const classes = scope.data?.classes ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const classId = picked ?? classes[0]?.id ?? null;
  const classLabel = classes.find((c) => c.id === classId)?.label ?? '';
  const [saturday, setSaturday] = useState(false);
  const [editing, setEditing] = useState<Cell | null>(null);
  const q = useClassTimetable(schoolId, classId);
  const slots = useMemo(() => q.data ?? [], [q.data]);
  const hasSaturday = slots.some((s) => s.weekday === SATURDAY);
  const columns: number[] = saturday || hasSaturday ? [...WEEK_COLUMNS, SATURDAY] : [...WEEK_COLUMNS];
  const slotAt = (weekday: number, period: number) => slots.find((s) => s.weekday === weekday && s.period === period);

  return (
    <AdminPage
      title="الجداول الدراسية"
      subtitle="اضغط على أي حصة لتعديلها"
      actions={
        <>
          <Switch
            label="إظهار يوم السبت"
            checked={saturday || hasSaturday}
            disabled={hasSaturday}
            onChange={(e) => setSaturday(e.currentTarget.checked)}
          />
          <Select
            w={220}
            aria-label="الفصل"
            placeholder="اختر الفصل"
            data={classes.map((c) => ({ value: c.id, label: c.label }))}
            value={classId}
            onChange={(v) => v && setPicked(v)}
            allowDeselect={false}
            searchable
            nothingFoundMessage="لا توجد فصول"
          />
        </>
      }
    >
      {scope.isLoading ? (
        <PageLoader />
      ) : !classId ? (
        <EmptyState message="لا توجد فصول في العام الدراسي الحالي" />
      ) : (
        <Paper withBorder radius="md" p="md">
          <Text fw={700} mb="sm">
            {classLabel}
          </Text>
          <QueryState query={q}>
            {() => (
              <div className="table-scroll">
                <Table withTableBorder withColumnBorders layout="fixed" miw={720}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th w={120}>الحصة</Table.Th>
                      {columns.map((d) => (
                        <Table.Th key={d} ta="center">
                          {WEEKDAY_LABELS[d]}
                        </Table.Th>
                      ))}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {PERIODS.map((p) => (
                      <Table.Tr key={p}>
                        <Table.Td fw={600} bg="gray.0">
                          {periodLabel(p)}
                        </Table.Td>
                        {columns.map((d) => {
                          const slot = slotAt(d, p);
                          return (
                            <Table.Td key={d} p={0}>
                              <UnstyledButton
                                w="100%"
                                mih={58}
                                p="xs"
                                aria-label={`${periodLabel(p)} — ${WEEKDAY_LABELS[d]}`}
                                onClick={() => setEditing({ weekday: d, period: p })}
                                className={css.cell}
                                style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
                              >
                                {slot ? (
                                  <>
                                    <Text fw={600} size="sm" ta="center">
                                      {slot.subjectName}
                                    </Text>
                                    <Text size="xs" c="dimmed" ta="center" truncate>
                                      {slot.teacherName ?? 'بدون أستاذ'}
                                    </Text>
                                  </>
                                ) : (
                                  <Group justify="center">
                                    <IconPlus size={16} color="var(--mantine-color-gray-4)" />
                                  </Group>
                                )}
                              </UnstyledButton>
                            </Table.Td>
                          );
                        })}
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </div>
            )}
          </QueryState>
        </Paper>
      )}
      <Modal
        opened={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `${classLabel} — ${WEEKDAY_LABELS[editing.weekday]} — ${periodLabel(editing.period)}` : ''}
        centered
      >
        {editing && classId && (
          <SlotEditor
            key={`${classId}:${editing.weekday}:${editing.period}`}
            schoolId={schoolId}
            classId={classId}
            cell={editing}
            daySlots={slots.filter((s) => s.weekday === editing.weekday)}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
    </AdminPage>
  );
}

function SlotEditor({
  schoolId,
  classId,
  cell,
  daySlots,
  onDone,
}: {
  schoolId: string;
  classId: string;
  cell: Cell;
  daySlots: ClassSlot[];
  onDone: () => void;
}) {
  const scope = useScope(schoolId);
  const current = daySlots.find((s) => s.period === cell.period);
  const [subjectId, setSubjectId] = useState<string | null>(current?.subjectId ?? null);
  const [teacherId, setTeacherId] = useState<string | null>(current?.teacherId ?? null);
  const [action, setAction] = useState<'save' | 'clear'>('save');
  const save = useSaveTimetableDay(schoolId);
  const others = daySlots.filter((s) => s.period !== cell.period).map(toInput);

  const persist = (kind: 'save' | 'clear', slots: SlotInput[], message: string) => {
    setAction(kind);
    save.mutate(
      { classId, weekday: cell.weekday, slots },
      {
        onSuccess: () => {
          notifySuccess(message);
          onDone();
        },
      },
    );
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!subjectId) return;
        persist('save', [...others, { period: cell.period, subjectId, teacherId }], 'تم حفظ الحصة');
      }}
    >
      <Stack gap="sm">
        <Select
          label="المادة"
          placeholder="اختر المادة"
          data={(scope.data?.subjects ?? []).map((s) => ({ value: s.id, label: s.name }))}
          value={subjectId}
          onChange={setSubjectId}
          searchable
          required
          nothingFoundMessage="لا توجد مواد"
          comboboxProps={{ withinPortal: true }}
          data-autofocus
        />
        <Select
          label="الأستاذ"
          placeholder="اختر الأستاذ (اختياري)"
          data={(scope.data?.teachers ?? []).map((t) => ({ value: t.id, label: t.fullName }))}
          value={teacherId}
          onChange={setTeacherId}
          searchable
          clearable
          nothingFoundMessage="لا يوجد أساتذة"
          comboboxProps={{ withinPortal: true }}
        />
        {save.error && (
          <Alert color="red" variant="light">
            {errorMessage(save.error)}
          </Alert>
        )}
        <Group justify="space-between" mt="xs">
          {current ? (
            <Button
              variant="light"
              color="red"
              loading={save.isPending && action === 'clear'}
              disabled={save.isPending && action !== 'clear'}
              onClick={() => persist('clear', others, 'تم إفراغ الحصة')}
            >
              إفراغ الحصة
            </Button>
          ) : (
            <span />
          )}
          <Group gap="xs">
            <Button variant="default" onClick={onDone}>
              إلغاء
            </Button>
            <Button
              type="submit"
              disabled={!subjectId || (save.isPending && action !== 'save')}
              loading={save.isPending && action === 'save'}
            >
              حفظ
            </Button>
          </Group>
        </Group>
      </Stack>
    </form>
  );
}

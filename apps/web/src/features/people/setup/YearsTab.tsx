import { useState } from 'react';
import { Badge, Button, Group, Modal, Paper, Stack, Switch, Table, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconCheck, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { addDays, formatDate } from '@slash/shared';
import { ApiError } from '../../../api/client';
import { useScope } from '../../../api/hooks';
import { IsoDateInput } from '../../../components/IsoDateInput';
import { EmptyState } from '../../../components/States';
import { notifyError, notifySuccess } from '../../../lib/notify';
import { useStructureMutation, type AcademicYear, type Structure } from './api';
import { ConfirmModal, IconAction } from './dialogs';

interface YearValues {
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  isCurrent: boolean;
}

/** Defaults for a new year: the one after the latest year, else the school year containing today (July → June). */
function nextYearDefaults(years: AcademicYear[], today: string | undefined): YearValues {
  const latest = [...years].sort((a, b) => b.endsOn.localeCompare(a.endsOn))[0];
  if (latest) {
    const startsOn = addDays(latest.endsOn, 1);
    const y = Number(startsOn.slice(0, 4));
    return { name: `${y}/${y + 1}`, startsOn, endsOn: addDays(`${y + 1}${startsOn.slice(4)}`, -1), isCurrent: false };
  }
  const now = today ?? new Date().toISOString().slice(0, 10);
  const y = Number(now.slice(5, 7)) >= 7 ? Number(now.slice(0, 4)) : Number(now.slice(0, 4)) - 1;
  return { name: `${y}/${y + 1}`, startsOn: `${y}-07-01`, endsOn: `${y + 1}-06-30`, isCurrent: true };
}

function YearForm({
  schoolId,
  year,
  initial,
  onDone,
}: {
  schoolId: string;
  year: AcademicYear | null;
  initial: YearValues;
  onDone: () => void;
}) {
  const mutation = useStructureMutation(schoolId);
  const form = useForm<YearValues>({
    initialValues: initial,
    validate: {
      name: (v) => (v.trim() ? null : 'اسم العام مطلوب'),
      startsOn: (v) => (v ? null : 'تاريخ البداية مطلوب'),
      endsOn: (v, values) =>
        !v
          ? 'تاريخ النهاية مطلوب'
          : values.startsOn && v <= values.startsOn
            ? 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية'
            : null,
    },
  });

  const submit = form.onSubmit((v) => {
    const body = {
      name: v.name.trim(),
      startsOn: v.startsOn,
      endsOn: v.endsOn,
      ...(v.isCurrent ? { isCurrent: true } : {}),
    };
    mutation.mutate(
      year
        ? { kind: 'update', entity: 'academic-years', id: year.id, body }
        : { kind: 'create', entity: 'academic-years', body },
      {
        onSuccess: () => {
          notifySuccess(year ? 'تم حفظ العام الدراسي' : 'تمت إضافة العام الدراسي');
          onDone();
        },
        onError: (err) => {
          if (err instanceof ApiError && err.details?.length) {
            form.setErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
          }
          notifyError(err);
        },
      },
    );
  });

  return (
    <form onSubmit={submit}>
      <Stack gap="sm">
        <TextInput
          label="اسم العام الدراسي"
          placeholder="مثال: 2025/2026"
          withAsterisk
          {...form.getInputProps('name')}
        />
        <Group grow>
          <IsoDateInput
            label="من"
            withAsterisk
            value={form.values.startsOn}
            onChange={(v) => form.setFieldValue('startsOn', v)}
            error={form.errors.startsOn}
          />
          <IsoDateInput
            label="إلى"
            withAsterisk
            value={form.values.endsOn}
            onChange={(v) => form.setFieldValue('endsOn', v)}
            error={form.errors.endsOn}
          />
        </Group>
        {!year?.isCurrent && (
          <Switch
            label="العام الدراسي الحالي"
            description="تعمل الفصول والغياب والجداول على العام الحالي"
            {...form.getInputProps('isCurrent', { type: 'checkbox' })}
          />
        )}
        <Group justify="flex-end" gap="xs" mt="xs">
          <Button variant="default" onClick={onDone}>
            إلغاء
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {year ? 'حفظ' : 'إضافة'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

/** "الأعوام الدراسية" tab: academic years, which one is current. */
export function YearsTab({ schoolId, structure }: { schoolId: string; structure: Structure }) {
  const scope = useScope(schoolId);
  const mutation = useStructureMutation(schoolId);
  const [editing, setEditing] = useState<AcademicYear | 'new' | null>(null);
  const [toDelete, setToDelete] = useState<AcademicYear | null>(null);
  const [makingCurrent, setMakingCurrent] = useState<AcademicYear | null>(null);
  const years = structure.academicYears;

  const setCurrent = (year: AcademicYear) =>
    mutation.mutate(
      { kind: 'update', entity: 'academic-years', id: year.id, body: { isCurrent: true } },
      {
        onSuccess: () => {
          notifySuccess(`أصبح ${year.name} العام الدراسي الحالي`);
          setMakingCurrent(null);
        },
        onError: (err) => {
          setMakingCurrent(null);
          notifyError(err);
        },
      },
    );

  return (
    <Paper withBorder radius="md" p="md">
      <Group justify="space-between" mb="sm">
        <Text c="dimmed" size="sm">
          الفصول والغياب والجداول والرسوم تعمل على العام الدراسي الحالي.
        </Text>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
          إضافة عام دراسي
        </Button>
      </Group>
      {years.length === 0 ? (
        <EmptyState message="لا توجد أعوام دراسية بعد. أضف العام الحالي للبدء." />
      ) : (
        <div className="table-scroll">
          <Table highlightOnHover verticalSpacing="xs" miw={560}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>العام الدراسي</Table.Th>
                <Table.Th>من</Table.Th>
                <Table.Th>إلى</Table.Th>
                <Table.Th>الحالة</Table.Th>
                <Table.Th w={190} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {years.map((year) => (
                <Table.Tr key={year.id}>
                  <Table.Td fw={600}>{year.name}</Table.Td>
                  <Table.Td>{formatDate(year.startsOn)}</Table.Td>
                  <Table.Td>{formatDate(year.endsOn)}</Table.Td>
                  <Table.Td>
                    {year.isCurrent ? (
                      <Badge color="teal" variant="light" leftSection={<IconCheck size={12} />}>
                        العام الحالي
                      </Badge>
                    ) : null}
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap" justify="flex-end">
                      {!year.isCurrent && (
                        <Button size="compact-xs" variant="light" onClick={() => setMakingCurrent(year)}>
                          تعيين كعام حالي
                        </Button>
                      )}
                      <IconAction label="تعديل" onClick={() => setEditing(year)}>
                        <IconPencil size={16} />
                      </IconAction>
                      <IconAction label="حذف" color="red" onClick={() => setToDelete(year)}>
                        <IconTrash size={16} />
                      </IconAction>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </div>
      )}

      <Modal
        opened={!!editing}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'إضافة عام دراسي' : 'تعديل العام الدراسي'}
        centered
      >
        {editing && (
          <YearForm
            key={editing === 'new' ? 'new' : editing.id}
            schoolId={schoolId}
            year={editing === 'new' ? null : editing}
            initial={
              editing === 'new'
                ? nextYearDefaults(years, scope.data?.school.today)
                : {
                    name: editing.name,
                    startsOn: editing.startsOn,
                    endsOn: editing.endsOn,
                    isCurrent: editing.isCurrent,
                  }
            }
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
      <ConfirmModal
        opened={!!makingCurrent}
        title="تغيير العام الدراسي الحالي"
        message={
          makingCurrent
            ? `سيصبح ${makingCurrent.name} العام الدراسي الحالي، وستعرض الشاشات فصوله وجداوله بدلاً من فصول العام الحالي. هل تريد المتابعة؟`
            : ''
        }
        confirmLabel="تعيين كعام حالي"
        color="cyan"
        loading={mutation.isPending}
        onConfirm={() => makingCurrent && setCurrent(makingCurrent)}
        onClose={() => setMakingCurrent(null)}
      />
      <ConfirmModal
        opened={!!toDelete}
        title="حذف العام الدراسي"
        message={
          toDelete ? `هل تريد حذف العام الدراسي ${toDelete.name}؟ لا يمكن حذف عام له فصول أو امتحانات أو رسوم.` : ''
        }
        loading={mutation.isPending}
        onConfirm={() =>
          toDelete &&
          mutation.mutate(
            { kind: 'delete', entity: 'academic-years', id: toDelete.id },
            {
              onSuccess: () => {
                notifySuccess('تم حذف العام الدراسي');
                setToDelete(null);
              },
              onError: (err) => {
                setToDelete(null);
                notifyError(err);
              },
            },
          )
        }
        onClose={() => setToDelete(null)}
      />
    </Paper>
  );
}

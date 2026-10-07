import { useState } from 'react';
import { Button, Group, Paper, Table, Text } from '@mantine/core';
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { EmptyState } from '../../../components/States';
import { notifyError, notifySuccess } from '../../../lib/notify';
import { useStructureMutation, type Structure, type Subject } from './api';
import { ConfirmModal, IconAction, NameModal, type NameValues } from './dialogs';

/** "المواد" tab: the school's subjects (name + display order). */
export function SubjectsTab({ schoolId, structure }: { schoolId: string; structure: Structure }) {
  const mutation = useStructureMutation(schoolId);
  const [editing, setEditing] = useState<Subject | 'new' | null>(null);
  const [toDelete, setToDelete] = useState<Subject | null>(null);
  const classesBySubject = new Map<string, number>();
  for (const a of structure.assignments) {
    classesBySubject.set(a.subjectId, (classesBySubject.get(a.subjectId) ?? 0) + 1);
  }

  const open = (target: Subject | 'new') => {
    mutation.reset();
    setEditing(target);
  };

  const submit = (values: NameValues) => {
    const onSuccess = () => {
      notifySuccess(editing === 'new' ? 'تمت إضافة المادة' : 'تم حفظ المادة');
      setEditing(null);
    };
    if (editing === 'new') mutation.mutate({ kind: 'create', entity: 'subjects', body: values }, { onSuccess });
    else if (editing)
      mutation.mutate({ kind: 'update', entity: 'subjects', id: editing.id, body: values }, { onSuccess });
  };

  return (
    <Paper withBorder radius="md" p="md">
      <Group justify="space-between" mb="sm">
        <Text c="dimmed" size="sm">
          المواد التي تُدرّس في المدرسة. تظهر لأولياء الأمور حسب توزيعها على الفصول.
        </Text>
        <Button leftSection={<IconPlus size={16} />} onClick={() => open('new')}>
          إضافة مادة
        </Button>
      </Group>
      {structure.subjects.length === 0 ? (
        <EmptyState message="لا توجد مواد بعد" />
      ) : (
        <div className="table-scroll">
          <Table highlightOnHover verticalSpacing="xs" miw={420}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={80}>الترتيب</Table.Th>
                <Table.Th>المادة</Table.Th>
                <Table.Th>عدد الفصول</Table.Th>
                <Table.Th w={90} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {structure.subjects.map((subject) => (
                <Table.Tr key={subject.id}>
                  <Table.Td c="dimmed">{subject.sort}</Table.Td>
                  <Table.Td fw={600}>{subject.name}</Table.Td>
                  <Table.Td>{classesBySubject.get(subject.id) ?? 0}</Table.Td>
                  <Table.Td>
                    <Group gap={0} wrap="nowrap" justify="flex-end">
                      <IconAction label="تعديل" onClick={() => open(subject)}>
                        <IconPencil size={16} />
                      </IconAction>
                      <IconAction label="حذف" color="red" onClick={() => setToDelete(subject)}>
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

      {editing && (
        <NameModal
          key={editing === 'new' ? 'new' : editing.id}
          opened
          title={editing === 'new' ? 'إضافة مادة' : 'تعديل المادة'}
          label="اسم المادة"
          placeholder="مثال: الرياضيات"
          initial={editing === 'new' ? undefined : { name: editing.name, sort: editing.sort }}
          withSort
          submitLabel={editing === 'new' ? 'إضافة' : 'حفظ'}
          loading={mutation.isPending}
          error={mutation.error}
          onSubmit={submit}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmModal
        opened={!!toDelete}
        title="حذف المادة"
        message={
          toDelete
            ? `هل تريد حذف مادة «${toDelete.name}»؟ سيُلغى توزيعها على الفصول. لا يمكن حذف مادة لها دروس أو امتحانات مسجلة.`
            : ''
        }
        loading={mutation.isPending}
        onConfirm={() =>
          toDelete &&
          mutation.mutate(
            { kind: 'delete', entity: 'subjects', id: toDelete.id },
            {
              onSuccess: () => {
                notifySuccess('تم حذف المادة');
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

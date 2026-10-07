import { useMemo, useState } from 'react';
import { Alert, Group, Loader, Paper, Select, Table, Text } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { EmptyState, QueryState } from '../../../components/States';
import { notifyError, notifySuccess } from '../../../lib/notify';
import { useSaveAssignment, useStaff, type Structure } from './api';

interface ClassRow {
  id: string;
  label: string;
  gradeLevelId: string;
}

const cellKey = (classSectionId: string, subjectId: string) => `${classSectionId}:${subjectId}`;

/** "توزيع المواد" tab: for each class of the current year, the teacher of every subject. */
export function AssignmentsTab({ schoolId, structure }: { schoolId: string; structure: Structure }) {
  const staffQ = useStaff(schoolId, 'all');
  const save = useSaveAssignment(schoolId);
  const [gradeFilter, setGradeFilter] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const grades = structure.stages.flatMap((st) => st.gradeLevels);
  const classes: ClassRow[] = grades.flatMap((g) =>
    g.classSections.map((c) => ({ id: c.id, label: `${g.name} - ${c.name}`, gradeLevelId: g.id })),
  );
  const visible = gradeFilter ? classes.filter((c) => c.gradeLevelId === gradeFilter) : classes;
  const teacherBy = useMemo(
    () => new Map(structure.assignments.map((a) => [cellKey(a.classSectionId, a.subjectId), a.teacherId])),
    [structure.assignments],
  );
  const unassigned = classes.length * structure.subjects.length - structure.assignments.length;

  if (!classes.length) return <EmptyState message="لا توجد فصول في العام الدراسي الحالي. أضفها من تبويب «الفصول»." />;
  if (!structure.subjects.length) return <EmptyState message="لا توجد مواد بعد. أضفها من تبويب «المواد»." />;

  const change = (classSectionId: string, subjectId: string, teacherId: string | null) => {
    const key = cellKey(classSectionId, subjectId);
    setSaving(key);
    save.mutate(
      { classSectionId, subjectId, teacherId },
      {
        onSuccess: () => notifySuccess(teacherId ? 'تم حفظ أستاذ المادة' : 'تم إلغاء توزيع المادة'),
        onError: notifyError,
        onSettled: () => setSaving((k) => (k === key ? null : k)),
      },
    );
  };

  return (
    <Paper withBorder radius="md" p="md">
      <Group justify="space-between" mb="sm" align="flex-end">
        <Text c="dimmed" size="sm" maw={560}>
          اختر أستاذ كل مادة في كل فصل. يرى الأستاذ في تطبيقه الفصول والمواد الموزعة عليه فقط، ويُحفظ كل اختيار مباشرة.
        </Text>
        <Select
          w={220}
          aria-label="الصف"
          placeholder="كل الصفوف"
          data={grades.filter((g) => g.classSections.length).map((g) => ({ value: g.id, label: g.name }))}
          value={gradeFilter}
          onChange={setGradeFilter}
          clearable
        />
      </Group>
      {unassigned > 0 && (
        <Alert color="yellow" variant="light" icon={<IconInfoCircle />} mb="sm" py="xs">
          {unassigned} مادة في الفصول بدون أستاذ
        </Alert>
      )}
      <QueryState query={staffQ}>
        {(staff) => {
          const teachers = staff
            .filter((m) => m.roles.includes('teacher') || m.roles.includes('supervisor'))
            .map((m) => ({ value: m.userId, label: m.fullName }));
          return (
            <div className="table-scroll">
              <Table withTableBorder withColumnBorders verticalSpacing={6} miw={160 + structure.subjects.length * 170}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={150}>الفصل</Table.Th>
                    {structure.subjects.map((subject) => (
                      <Table.Th key={subject.id} miw={160}>
                        {subject.name}
                      </Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {visible.map((cls) => (
                    <Table.Tr key={cls.id}>
                      <Table.Td fw={700} bg="gray.0">
                        {cls.label}
                      </Table.Td>
                      {structure.subjects.map((subject) => {
                        const key = cellKey(cls.id, subject.id);
                        const value = teacherBy.get(key) ?? null;
                        return (
                          <Table.Td key={subject.id} p={4}>
                            <Select
                              size="xs"
                              aria-label={`أستاذ ${subject.name} — ${cls.label}`}
                              placeholder="بدون أستاذ"
                              data={teachers}
                              value={value}
                              onChange={(v) => v !== value && change(cls.id, subject.id, v)}
                              clearable
                              searchable
                              nothingFoundMessage="لا يوجد أساتذة"
                              disabled={saving === key}
                              rightSection={saving === key ? <Loader size={12} /> : undefined}
                              comboboxProps={{ withinPortal: true }}
                            />
                          </Table.Td>
                        );
                      })}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>
          );
        }}
      </QueryState>
    </Paper>
  );
}

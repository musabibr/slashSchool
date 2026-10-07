import { useState } from 'react';
import { ActionIcon, Anchor, Badge, Box, Button, Group, Paper, Table, Text, Title, Tooltip } from '@mantine/core';
import { IconEdit, IconPlus, IconTrash } from '@tabler/icons-react';
import { Link } from 'react-router';
import { formatDate } from '@slash/shared';
import { AdminPage } from '../../components/AdminPage';
import { ClassSubjectSelect } from '../../components/ClassSubjectSelect';
import { QueryState } from '../../components/States';
import { notifyError, notifySuccess } from '../../lib/notify';
import { useSchoolId } from '../../lib/params';
import {
  useDeleteIncident,
  useDeleteRegulation,
  useIncidents,
  useRegulations,
  type Incident,
  type Regulation,
} from './api';
import { RegulationFormModal } from './RegulationFormModal';
import { ConfirmDialog } from './ui';

/** Director "اللوائح المدرسية": the regulations catalog (add / edit / delete) and the latest incidents. */
export function AdminRegulationsPage() {
  const schoolId = useSchoolId();
  const regulations = useRegulations(schoolId);
  const remove = useDeleteRegulation(schoolId);
  const [editing, setEditing] = useState<Regulation | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<Regulation | null>(null);

  return (
    <AdminPage
      title="اللوائح المدرسية"
      subtitle="اللوائح التي تُسجَّل عليها مخالفات الطلاب، والعقوبة الافتراضية لكل منها"
      actions={
        <Button leftSection={<IconPlus size={18} />} onClick={() => setAdding(true)}>
          إضافة لائحة
        </Button>
      }
    >
      <QueryState query={regulations} empty="لا توجد لوائح بعد — أضف أول لائحة" isEmpty={(rows) => rows.length === 0}>
        {(rows) => (
          <Paper withBorder radius="md">
            <Table.ScrollContainer minWidth={640}>
              <Table striped highlightOnHover verticalSpacing="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={80}>الرقم</Table.Th>
                    <Table.Th>اللائحة</Table.Th>
                    <Table.Th>العقوبة الافتراضية</Table.Th>
                    <Table.Th w={120}>عدد المخالفات</Table.Th>
                    <Table.Th w={96} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((r) => (
                    <Table.Tr key={r.id}>
                      <Table.Td>{r.code ?? '—'}</Table.Td>
                      <Table.Td fw={600}>{r.title}</Table.Td>
                      <Table.Td c={r.defaultPenalty ? undefined : 'dimmed'}>
                        {r.defaultPenalty ?? 'بدون عقوبة'}
                      </Table.Td>
                      <Table.Td>
                        <Badge color={r.incidentCount ? 'red' : 'gray'} variant="light">
                          {r.incidentCount}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4} justify="flex-end" wrap="nowrap">
                          <Tooltip label="تعديل">
                            <ActionIcon variant="subtle" onClick={() => setEditing(r)} aria-label="تعديل">
                              <IconEdit size={18} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label={r.incidentCount ? 'لا يمكن حذف لائحة مسجل عليها مخالفات' : 'حذف'}>
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              disabled={r.incidentCount > 0}
                              onClick={() => setDeleting(r)}
                              aria-label="حذف"
                            >
                              <IconTrash size={18} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Paper>
        )}
      </QueryState>

      <RecentIncidents schoolId={schoolId} />

      <RegulationFormModal
        schoolId={schoolId}
        opened={adding || !!editing}
        regulation={editing}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
      />
      <ConfirmDialog
        opened={!!deleting}
        title="حذف اللائحة"
        message={deleting ? `حذف اللائحة "${deleting.title}"؟` : ''}
        loading={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              notifySuccess('تم حذف اللائحة');
              setDeleting(null);
            },
            onError: notifyError,
          })
        }
      />
    </AdminPage>
  );
}

/** The school's latest incidents, optionally for one class. */
function RecentIncidents({ schoolId }: { schoolId: string }) {
  const [classId, setClassId] = useState<string | null>(null);
  const incidents = useIncidents(schoolId, { classId, limit: 50 });
  const remove = useDeleteIncident(schoolId);
  const [deleting, setDeleting] = useState<Incident | null>(null);

  return (
    <Box mt="md">
      <Group justify="space-between" align="flex-end" mb="sm">
        <Title order={4}>آخر المخالفات المسجلة</Title>
        <Box w={260}>
          <ClassSubjectSelect
            schoolId={schoolId}
            classId={classId}
            withSubject={false}
            clearable
            onChange={(next) => setClassId(next.classId)}
          />
        </Box>
      </Group>
      <QueryState query={incidents} empty="لا توجد مخالفات مسجلة" isEmpty={(rows) => rows.length === 0}>
        {(rows) => (
          <Paper withBorder radius="md">
            <Table.ScrollContainer minWidth={860}>
              <Table striped verticalSpacing="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>التاريخ</Table.Th>
                    <Table.Th>الطالب</Table.Th>
                    <Table.Th>الفصل</Table.Th>
                    <Table.Th>اللائحة</Table.Th>
                    <Table.Th>التفاصيل</Table.Th>
                    <Table.Th>العقوبة</Table.Th>
                    <Table.Th>سجلها</Table.Th>
                    <Table.Th w={48} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((i) => (
                    <Table.Tr key={i.id}>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDate(i.date)}</Table.Td>
                      <Table.Td>
                        <Anchor component={Link} to={`/a/${schoolId}/students/${i.studentId}`} size="sm" fw={600}>
                          {i.studentName}
                        </Anchor>
                      </Table.Td>
                      <Table.Td>{i.classLabel ?? '—'}</Table.Td>
                      <Table.Td>{i.regulationTitle}</Table.Td>
                      <Table.Td maw={260}>
                        <Text size="sm" lineClamp={2}>
                          {i.details ?? '—'}
                        </Text>
                      </Table.Td>
                      <Table.Td c={i.penalty ? 'red.8' : 'dimmed'}>{i.penalty ?? 'بدون عقوبة'}</Table.Td>
                      <Table.Td c="dimmed">{i.recordedByName ?? '—'}</Table.Td>
                      <Table.Td>
                        <Tooltip label="حذف المخالفة">
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            onClick={() => setDeleting(i)}
                            aria-label="حذف المخالفة"
                          >
                            <IconTrash size={18} />
                          </ActionIcon>
                        </Tooltip>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Paper>
        )}
      </QueryState>
      <ConfirmDialog
        opened={!!deleting}
        title="حذف المخالفة"
        message={deleting ? `حذف مخالفة "${deleting.regulationTitle}" للطالب ${deleting.studentName}؟` : ''}
        loading={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              notifySuccess('تم حذف المخالفة');
              setDeleting(null);
            },
            onError: notifyError,
          })
        }
      />
    </Box>
  );
}

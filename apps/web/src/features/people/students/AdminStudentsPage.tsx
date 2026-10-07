import { useMemo, useState } from 'react';
import { Badge, Button, Group, Pagination, Paper, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { useDebouncedCallback } from '@mantine/hooks';
import { IconFileImport, IconSearch, IconUserPlus } from '@tabler/icons-react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { formatDate, type StudentStatus } from '@slash/shared';
import { useScope } from '../../../api/hooks';
import { AdminPage } from '../../../components/AdminPage';
import { QueryState } from '../../../components/States';
import { useSchoolId } from '../../../lib/params';
import { useStudentList } from './api';
import { PAGE_SIZE, STUDENT_STATUS_OPTIONS } from './helpers';
import { StudentStatusBadge } from './shared';

/** "c:<classId>", "g:<gradeLevelId>" or "none" (not placed in a class). */
function parseFilter(value: string | null): { classId: string | null; gradeLevelId: string | null } {
  if (value === 'none') return { classId: 'none', gradeLevelId: null };
  if (value?.startsWith('c:')) return { classId: value.slice(2), gradeLevelId: null };
  if (value?.startsWith('g:')) return { classId: null, gradeLevelId: value.slice(2) };
  return { classId: null, gradeLevelId: null };
}

/** D2 — the students table with class/grade filter, search, status and pagination. */
export function AdminStudentsPage() {
  const schoolId = useSchoolId();
  const navigate = useNavigate();
  const scope = useScope(schoolId);
  const [params, setParams] = useSearchParams();
  const filter = params.get('f');
  const status = (params.get('status') as StudentStatus | null) || null;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const q = params.get('q') ?? '';
  const [search, setSearch] = useState(q);

  const update = (next: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(next)) {
          if (v) p.set(k, v);
          else p.delete(k);
        }
        return p;
      },
      { replace: true },
    );

  const syncSearch = useDebouncedCallback((v: string) => update({ q: v.trim() || null, page: null }), 300);

  const filterOptions = useMemo(() => {
    const classes = scope.data?.classes ?? [];
    const grades = [...new Map(classes.map((c) => [c.gradeLevelId, c.gradeLevelName])).entries()];
    return [
      { group: 'السنة الدراسية', items: grades.map(([id, name]) => ({ value: `g:${id}`, label: name })) },
      { group: 'الفصل', items: classes.map((c) => ({ value: `c:${c.id}`, label: c.label })) },
      { group: 'أخرى', items: [{ value: 'none', label: 'بدون فصل' }] },
    ];
  }, [scope.data]);

  const { classId, gradeLevelId } = parseFilter(filter);
  const list = useStudentList(schoolId, {
    q,
    classId,
    gradeLevelId,
    status,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE_SIZE));
  const filtered = !!(filter || status || q);

  return (
    <AdminPage
      title="الطلاب"
      subtitle={list.data ? `عدد الطلاب: ${list.data.total}` : undefined}
      actions={
        <>
          <Button
            component={Link}
            to={`/a/${schoolId}/students/import`}
            variant="default"
            leftSection={<IconFileImport size={16} />}
          >
            استيراد
          </Button>
          <Button component={Link} to={`/a/${schoolId}/students/new`} leftSection={<IconUserPlus size={16} />}>
            تسجيل طالب جديد
          </Button>
        </>
      }
    >
      <Paper withBorder radius="md" p="md">
        <Stack gap="md">
          <Group grow align="flex-end" gap="sm" wrap="wrap">
            <Select
              label="الصف"
              placeholder="إختر الصف"
              data={filterOptions}
              value={filter}
              onChange={(v) => update({ f: v, page: null })}
              clearable
              searchable
              nothingFoundMessage="لا توجد نتائج"
              miw={200}
            />
            <TextInput
              label="بحث"
              placeholder="إبحث عن طالب (الاسم أو الكود)"
              leftSection={<IconSearch size={16} />}
              value={search}
              onChange={(e) => {
                setSearch(e.currentTarget.value);
                syncSearch(e.currentTarget.value);
              }}
              miw={220}
            />
            <Select
              label="الحالة"
              placeholder="كل الحالات"
              data={STUDENT_STATUS_OPTIONS}
              value={status}
              onChange={(v) => update({ status: v, page: null })}
              clearable
              miw={160}
            />
          </Group>

          <QueryState
            query={list}
            empty={filtered ? 'لا يوجد طلاب مطابقون للبحث' : 'لا يوجد طلاب مسجلون بعد — ابدأ بتسجيل طالب جديد أو استيراد ملف'}
            isEmpty={(d) => d.items.length === 0}
          >
            {(data) => (
              <Stack gap="sm">
                <div className="table-scroll">
                  <Table highlightOnHover verticalSpacing="sm" miw={640}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>الكود</Table.Th>
                        <Table.Th>إسم الطالب</Table.Th>
                        <Table.Th>الصف</Table.Th>
                        <Table.Th>تاريخ التسجيل</Table.Th>
                        <Table.Th>الحالة</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody style={{ opacity: list.isPlaceholderData ? 0.6 : 1 }}>
                      {data.items.map((s) => {
                        const open = () => navigate(`/a/${schoolId}/students/${s.id}`);
                        return (
                          <Table.Tr
                            key={s.id}
                            style={{ cursor: 'pointer' }}
                            tabIndex={0}
                            onClick={open}
                            onKeyDown={(e) => e.key === 'Enter' && open()}
                          >
                            <Table.Td dir="ltr" style={{ textAlign: 'right' }}>
                              {s.code}
                            </Table.Td>
                            <Table.Td>
                              <Group gap={6} wrap="nowrap">
                                <Text fw={600} size="sm">
                                  {s.fullName}
                                </Text>
                                {s.guardianCount === 0 && (
                                  <Badge size="xs" color="orange" variant="light">
                                    بدون ولي أمر
                                  </Badge>
                                )}
                              </Group>
                            </Table.Td>
                            <Table.Td>
                              {s.classLabel ?? (
                                <Text span size="sm" c="dimmed">
                                  {s.gradeLevelName ? `${s.gradeLevelName} (بدون فصل)` : '—'}
                                </Text>
                              )}
                            </Table.Td>
                            <Table.Td dir="ltr" style={{ textAlign: 'right' }}>
                              {formatDate(s.registeredAt)}
                            </Table.Td>
                            <Table.Td>
                              <StudentStatusBadge status={s.status} />
                            </Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </div>
                {pages > 1 && (
                  <Group justify="center">
                    <Pagination
                      total={pages}
                      value={Math.min(page, pages)}
                      onChange={(p) => update({ page: p > 1 ? String(p) : null })}
                      size="sm"
                    />
                  </Group>
                )}
              </Stack>
            )}
          </QueryState>
        </Stack>
      </Paper>
    </AdminPage>
  );
}

import { useState } from 'react';
import { Anchor, Badge, Group, Pagination, Paper, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { useDebouncedCallback } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { Link, useSearchParams } from 'react-router';
import { formatDate, STUDENT_STATUS_LABELS, type UserStatus } from '@slash/shared';
import { AdminPage } from '../../../components/AdminPage';
import { QueryState } from '../../../components/States';
import { useSchoolId } from '../../../lib/params';
import { useGuardianList } from './api';
import { PAGE_SIZE, STUDENT_STATUS_COLORS, USER_STATUS_LABELS } from './helpers';
import { IssueCodeButton, UserStatusBadge } from './shared';

const STATUS_OPTIONS = (Object.keys(USER_STATUS_LABELS) as UserStatus[]).map((s) => ({
  value: s,
  label: USER_STATUS_LABELS[s],
}));

/** Sidebar "أولياء الأمور": guardians with their children, account status and activation codes. */
export function AdminGuardiansPage() {
  const schoolId = useSchoolId();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const status = (params.get('status') as UserStatus | null) || null;
  const page = Math.max(1, Number(params.get('page')) || 1);
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

  const list = useGuardianList(schoolId, { q, status, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE_SIZE));

  return (
    <AdminPage title="أولياء الأمور" subtitle={list.data ? `عدد أولياء الأمور: ${list.data.total}` : undefined}>
      <Paper withBorder radius="md" p="md">
        <Stack gap="md">
          <Group grow align="flex-end" gap="sm" wrap="wrap">
            <TextInput
              label="بحث"
              placeholder="إبحث بالاسم أو رقم الهاتف أو اسم الطالب"
              leftSection={<IconSearch size={16} />}
              value={search}
              onChange={(e) => {
                setSearch(e.currentTarget.value);
                syncSearch(e.currentTarget.value);
              }}
              miw={240}
            />
            <Select
              label="حالة الحساب"
              placeholder="الكل"
              data={STATUS_OPTIONS}
              value={status}
              onChange={(v) => update({ status: v, page: null })}
              clearable
              miw={160}
            />
          </Group>

          <QueryState
            query={list}
            empty={q || status ? 'لا يوجد أولياء أمور مطابقون للبحث' : 'لا يوجد أولياء أمور بعد — يُضافون عند تسجيل الطلاب'}
            isEmpty={(d) => d.items.length === 0}
          >
            {(data) => (
              <Stack gap="sm">
                <div className="table-scroll">
                  <Table verticalSpacing="sm" miw={760}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>الاسم</Table.Th>
                        <Table.Th>رقم الهاتف</Table.Th>
                        <Table.Th>الأبناء</Table.Th>
                        <Table.Th>الحالة</Table.Th>
                        <Table.Th>آخر دخول</Table.Th>
                        <Table.Th />
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody style={{ opacity: list.isPlaceholderData ? 0.6 : 1 }}>
                      {data.items.map((g) => (
                        <Table.Tr key={g.userId}>
                          <Table.Td fw={600}>{g.fullName}</Table.Td>
                          <Table.Td dir="ltr" style={{ textAlign: 'right' }}>
                            {g.phone}
                          </Table.Td>
                          <Table.Td>
                            <Stack gap={2}>
                              {g.children.map((c) => (
                                <Group key={c.studentId} gap={6} wrap="nowrap">
                                  <Anchor component={Link} to={`/a/${schoolId}/students/${c.studentId}`} size="sm">
                                    {c.fullName}
                                  </Anchor>
                                  {c.classLabel && (
                                    <Text size="xs" c="dimmed">
                                      {c.classLabel}
                                    </Text>
                                  )}
                                  {c.status !== 'active' && (
                                    <Badge size="xs" color={STUDENT_STATUS_COLORS[c.status]} variant="light">
                                      {STUDENT_STATUS_LABELS[c.status]}
                                    </Badge>
                                  )}
                                </Group>
                              ))}
                            </Stack>
                          </Table.Td>
                          <Table.Td>
                            <UserStatusBadge status={g.status} />
                          </Table.Td>
                          <Table.Td dir="ltr" style={{ textAlign: 'right' }}>
                            {g.lastLoginAt ? formatDate(g.lastLoginAt) : '—'}
                          </Table.Td>
                          <Table.Td>
                            <IssueCodeButton
                              schoolId={schoolId}
                              userId={g.userId}
                              guardianName={g.fullName}
                              phone={g.whatsapp ?? g.phone}
                              students={g.children.map((c) => c.fullName)}
                              canIssue={g.canIssueCode}
                              size="compact-xs"
                            />
                          </Table.Td>
                        </Table.Tr>
                      ))}
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

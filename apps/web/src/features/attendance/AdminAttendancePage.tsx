import { Button, Grid, Paper, Stack, Table, Text, Title } from '@mantine/core';
import { useScope } from '../../api/hooks';
import { AdminPage } from '../../components/AdminPage';
import { PageLoader, QueryState } from '../../components/States';
import { useSchoolId } from '../../lib/params';
import { useAttendanceToday } from './api';
import { AttendanceForm, RecentSessions } from './AttendanceForm';
import { dayLabel, recordedSummary, useClassDateParams } from './helpers';
import { TodayStatusBadge } from './StaffAttendancePages';

/** Director's "تسجيل الغياب": today's overview next to the record/edit form. */
export function AdminAttendancePage() {
  const schoolId = useSchoolId();
  const scope = useScope(schoolId);
  const todayQ = useAttendanceToday(schoolId);
  const { classId, date, set } = useClassDateParams();
  const today = scope.data?.school.today ?? null;
  const effectiveDate = date ?? today;

  return (
    <AdminPage title="تسجيل الغياب" subtitle={today ? dayLabel(today) : undefined}>
      {scope.isLoading ? (
        <PageLoader />
      ) : (
        <Grid gutter="md" align="flex-start">
          <Grid.Col span={{ base: 12, lg: 5 }}>
            <Paper withBorder radius="md" p="md">
              <Title order={4} mb="xs">
                غياب اليوم
              </Title>
              <QueryState
                query={todayQ}
                empty="لا توجد فصول في العام الدراسي الحالي"
                isEmpty={(d) => d.classes.length === 0}
              >
                {(d) => (
                  <Stack gap="xs">
                    <Text size="sm" c="dimmed">
                      {recordedSummary(d)}
                    </Text>
                    <div className="table-scroll">
                      <Table highlightOnHover verticalSpacing="xs">
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>الفصل</Table.Th>
                            <Table.Th>الطلاب</Table.Th>
                            <Table.Th>الحالة</Table.Th>
                            <Table.Th />
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {d.classes.map((c) => {
                            const selected = c.classId === classId && effectiveDate === d.date;
                            return (
                              <Table.Tr
                                key={c.classId}
                                bg={selected ? 'cyan.0' : undefined}
                                style={{ cursor: 'pointer' }}
                                onClick={() => set({ classId: c.classId, date: d.date })}
                              >
                                <Table.Td fw={600}>{c.label}</Table.Td>
                                <Table.Td>{c.studentCount}</Table.Td>
                                <Table.Td>
                                  <TodayStatusBadge recorded={c.recorded} absentCount={c.absentCount} />
                                </Table.Td>
                                <Table.Td>
                                  <Button
                                    size="compact-xs"
                                    variant={c.recorded ? 'default' : 'filled'}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      set({ classId: c.classId, date: d.date });
                                    }}
                                  >
                                    {c.recorded ? 'تعديل' : 'تسجيل'}
                                  </Button>
                                </Table.Td>
                              </Table.Tr>
                            );
                          })}
                        </Table.Tbody>
                      </Table>
                    </div>
                  </Stack>
                )}
              </QueryState>
            </Paper>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 7 }}>
            <Stack gap="md">
              <Paper withBorder radius="md" p="md">
                <Title order={4} mb="xs">
                  تسجيل / تعديل الغياب
                </Title>
                <AttendanceForm schoolId={schoolId} classId={classId} date={effectiveDate} onChange={set} inline />
              </Paper>
              {classId && (
                <Paper withBorder radius="md" p="md">
                  <RecentSessions
                    schoolId={schoolId}
                    classId={classId}
                    selectedDate={effectiveDate}
                    onPick={(d) => set({ classId, date: d })}
                  />
                </Paper>
              )}
            </Stack>
          </Grid.Col>
        </Grid>
      )}
    </AdminPage>
  );
}

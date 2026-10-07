import { Group, Paper, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconCalendarX } from '@tabler/icons-react';
import { formatDate, WEEKDAY_LABELS } from '@slash/shared';
import { EmptyState, QueryState } from '../../components/States';
import { useStudentAttendance } from './api';

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Paper withBorder radius="lg" p="md">
      <Stack gap={4} align="center">
        <Text size="sm" c="dimmed" ta="center" lh={1.3}>
          {label}
        </Text>
        <Text fw={700} fz={32} c="red.7" lh={1}>
          {value}
        </Text>
      </Stack>
    </Paper>
  );
}

/**
 * P8 panel — absence counts and the list of absent days. Used by the guardian screen and by the
 * director's student profile (staff viewing does not clear the guardian's badge).
 */
export function StudentAttendanceSummary({ studentId }: { studentId: string }) {
  const q = useStudentAttendance(studentId);
  return (
    <QueryState query={q}>
      {(data) => (
        <Stack gap="md">
          <SimpleGrid cols={2} spacing="sm">
            <StatCard label="أيام الغياب هذا الشهر" value={data.thisMonth} />
            <StatCard label="الغياب الكلي" value={data.total} />
          </SimpleGrid>
          <Stack gap="xs">
            <Text fw={700}>أيام الغياب</Text>
            {data.days.length === 0 ? (
              <EmptyState message="لا توجد أيام غياب مسجلة هذا العام" icon={<IconCalendarX size={36} stroke={1.5} />} />
            ) : (
              data.days.map((d) => (
                <Paper key={d.date} withBorder radius="md" px="md" py="xs">
                  <Group justify="space-between" wrap="nowrap">
                    <Text fw={600}>{WEEKDAY_LABELS[d.weekday]}</Text>
                    <Text c="dimmed" dir="ltr">
                      {formatDate(d.date)}
                    </Text>
                  </Group>
                  {d.note && (
                    <Text size="sm" c="dimmed" mt={2}>
                      {d.note}
                    </Text>
                  )}
                </Paper>
              ))
            )}
          </Stack>
        </Stack>
      )}
    </QueryState>
  );
}

import { Alert, Paper, SimpleGrid, Stack, Table, Text } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { formatScore, gradeColor } from './format';
import type { ResultSheet } from './types';

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Paper withBorder radius="lg" p="md">
      <Stack gap={4} align="center">
        <Text size="sm" c="dimmed" ta="center" lh={1.3}>
          {label}
        </Text>
        <Text fw={700} fz={28} c={color} lh={1.1} ta="center">
          {value}
        </Text>
      </Stack>
    </Paper>
  );
}

/**
 * P13 — المادة / الدرجة / الدرجة النهائية, the "المجموع" row, then "النسبة المئوية" and "التقدير".
 * Every number comes from the server (computed from the school's grade bands).
 */
export function ResultSheetView({ sheet }: { sheet: ResultSheet }) {
  const hasScores = sheet.max > 0;
  const color = `${gradeColor(sheet.percentage)}.7`;
  return (
    <Stack gap="md">
      <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
        <Table striped verticalSpacing="xs" horizontalSpacing="sm" fz="sm">
          <Table.Thead bg="gray.1">
            <Table.Tr>
              <Table.Th>المادة</Table.Th>
              <Table.Th ta="center">الدرجة</Table.Th>
              <Table.Th ta="center">الدرجة النهائية</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {sheet.rows.map((row) => (
              <Table.Tr key={row.subjectId}>
                <Table.Td fw={600}>{row.subjectName}</Table.Td>
                <Table.Td ta="center" c={row.score === null ? 'dimmed' : undefined}>
                  {row.score === null ? '—' : formatScore(row.score)}
                </Table.Td>
                <Table.Td ta="center">{row.maxScore}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
          <Table.Tfoot bg="gray.1">
            <Table.Tr>
              <Table.Th>المجموع</Table.Th>
              <Table.Th ta="center">{formatScore(sheet.total)}</Table.Th>
              <Table.Th ta="center">{sheet.max}</Table.Th>
            </Table.Tr>
          </Table.Tfoot>
        </Table>
      </Paper>
      {hasScores ? (
        <SimpleGrid cols={2} spacing="sm">
          <StatCard label="النسبة المئوية" value={`${sheet.percentage}%`} color={color} />
          <StatCard label="التقدير" value={sheet.grade} color={color} />
        </SimpleGrid>
      ) : (
        <Text c="dimmed" size="sm" ta="center">
          لم يتم رصد أي درجة بعد
        </Text>
      )}
      {sheet.incomplete && hasScores && (
        <Alert color="orange" variant="light" icon={<IconInfoCircle />} p="sm">
          <Text size="sm">بعض المواد لم تُرصد درجاتها بعد؛ المجموع والنسبة محسوبان من المواد المرصودة فقط.</Text>
        </Alert>
      )}
    </Stack>
  );
}

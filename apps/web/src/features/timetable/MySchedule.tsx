import { useState } from 'react';
import { Stack, Table } from '@mantine/core';
import { periodLabel } from '@slash/shared';
import { useScope } from '../../api/hooks';
import { QueryState } from '../../components/States';
import { defaultWeekday, useMyTimetable } from './api';
import { DaySelect } from './DaySelect';

/** T8 — "جدول الحصص": the signed-in teacher's periods for one day (read-only). */
export function MySchedule({ schoolId }: { schoolId: string }) {
  const scope = useScope(schoolId);
  const [weekday, setWeekday] = useState(() => defaultWeekday(scope.data?.school.today));
  const q = useMyTimetable(schoolId, weekday);
  return (
    <Stack gap="md">
      <DaySelect value={weekday} onChange={setWeekday} />
      <QueryState query={q} empty="لا توجد حصص في هذا اليوم" isEmpty={(rows) => rows.length === 0}>
        {(rows) => (
          <Table striped withTableBorder verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>الصف</Table.Th>
                <Table.Th>الحصة</Table.Th>
                <Table.Th>المادة</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r) => (
                <Table.Tr key={`${r.period}:${r.classId}`}>
                  <Table.Td fw={600}>{r.classLabel}</Table.Td>
                  <Table.Td>{periodLabel(r.period)}</Table.Td>
                  <Table.Td>{r.subjectName}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </QueryState>
    </Stack>
  );
}

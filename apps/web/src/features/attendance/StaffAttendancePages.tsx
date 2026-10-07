import { Badge, Button, Divider, Group, Paper, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconChevronLeft, IconEdit, IconPlus } from '@tabler/icons-react';
import { Link } from 'react-router';
import { useScope } from '../../api/hooks';
import { MobilePage } from '../../components/MobilePage';
import { QueryState } from '../../components/States';
import { useSchoolId } from '../../lib/params';
import { useAttendanceToday } from './api';
import { AttendanceForm } from './AttendanceForm';
import { dayLabel, recordedSummary, useClassDateParams } from './helpers';

export function TodayStatusBadge({ recorded, absentCount }: { recorded: boolean; absentCount: number }) {
  if (!recorded)
    return (
      <Badge color="orange" variant="light">
        لم يسجل
      </Badge>
    );
  return (
    <Badge color={absentCount ? 'red' : 'teal'} variant="light">
      {absentCount ? `${absentCount} غائب` : 'لا غياب'}
    </Badge>
  );
}

/** S8 — absence hub: add today's absence, edit a previous one, and today's overview per class. */
export function AttendanceHubPage() {
  const schoolId = useSchoolId();
  const today = useAttendanceToday(schoolId);
  const recordPath = `/s/${schoolId}/attendance/record`;
  return (
    <MobilePage title="الغياب">
      <Stack gap="sm">
        <Button component={Link} to={recordPath} size="lg" leftSection={<IconPlus size={20} />}>
          إضافة غياب
        </Button>
        <Button
          component={Link}
          to={`${recordPath}?mode=edit`}
          size="lg"
          variant="default"
          leftSection={<IconEdit size={20} />}
        >
          تعديل الغياب السابق
        </Button>
        <Divider my="xs" label="غياب اليوم" labelPosition="center" />
        <QueryState query={today} empty="لا توجد فصول في العام الدراسي الحالي" isEmpty={(d) => d.classes.length === 0}>
          {(d) => (
            <Stack gap={6}>
              <Text size="sm" c="dimmed">
                {dayLabel(d.date)} — {recordedSummary(d)}
              </Text>
              {d.classes.map((c) => (
                <UnstyledButton
                  key={c.classId}
                  component={Link}
                  to={`${recordPath}?classId=${c.classId}&date=${d.date}`}
                  aria-label={c.label}
                >
                  <Paper withBorder radius="md" px="sm" py={10}>
                    <Group justify="space-between" wrap="nowrap" gap="xs">
                      <Stack gap={0} style={{ minWidth: 0 }}>
                        <Text fw={600} truncate>
                          {c.label}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {c.studentCount} طالب
                        </Text>
                      </Stack>
                      <Group gap={6} wrap="nowrap">
                        <TodayStatusBadge recorded={c.recorded} absentCount={c.absentCount} />
                        <IconChevronLeft size={16} color="var(--mantine-color-gray-6)" />
                      </Group>
                    </Group>
                  </Paper>
                </UnstyledButton>
              ))}
            </Stack>
          )}
        </QueryState>
      </Stack>
    </MobilePage>
  );
}

/**
 * S9 (record) / S10 (edit) — reads ?classId&date (&mode=edit) from the URL. Record defaults to today;
 * edit starts without a date and lists the class's previously recorded days.
 */
export function AttendanceRecordPage() {
  const schoolId = useSchoolId();
  const scope = useScope(schoolId);
  const { classId, date, mode, set } = useClassDateParams();
  const editMode = mode === 'edit';
  const effectiveDate = date ?? (editMode ? null : (scope.data?.school.today ?? null));
  return (
    <MobilePage title={editMode ? 'تعديل الغياب' : 'تسجيل الغياب'}>
      <AttendanceForm
        schoolId={schoolId}
        classId={classId}
        date={effectiveDate}
        onChange={set}
        recentWhenNoDate={editMode}
        dateClearable={editMode}
      />
    </MobilePage>
  );
}

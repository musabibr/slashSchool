import { useState } from 'react';
import { SegmentedControl, Stack } from '@mantine/core';
import { useScope } from '../../api/hooks';
import { MobilePage } from '../../components/MobilePage';
import { useSchoolId } from '../../lib/params';
import { MySchedule } from './MySchedule';
import { TimetableBuilder } from './TimetableBuilder';

type View = 'builder' | 'mine';

/**
 * Supervisors/admins: the S16 class timetable builder, with a toggle to their own schedule.
 * Teachers: T8 "جدول الحصص" (read-only).
 */
export function StaffTimetablePage() {
  const schoolId = useSchoolId();
  const scope = useScope(schoolId);
  const [view, setView] = useState<View>('builder');
  const canBuild = scope.data?.school.roles.some((r) => r === 'admin' || r === 'supervisor') ?? false;

  if (!canBuild) {
    return (
      <MobilePage title="جدول الحصص">
        <MySchedule schoolId={schoolId} />
      </MobilePage>
    );
  }
  return (
    <MobilePage title="الجداول الدراسية">
      <Stack gap="md">
        <SegmentedControl
          fullWidth
          value={view}
          onChange={(v) => setView(v as View)}
          data={[
            { value: 'builder', label: 'جداول الفصول' },
            { value: 'mine', label: 'جدولي' },
          ]}
        />
        {view === 'builder' ? <TimetableBuilder schoolId={schoolId} /> : <MySchedule schoolId={schoolId} />}
      </Stack>
    </MobilePage>
  );
}

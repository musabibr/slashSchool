import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MobilePage } from '../../components/MobilePage';
import { useStudentId } from '../../lib/params';
import { useStudentAttendance } from './api';
import { StudentAttendanceSummary } from './StudentAttendanceSummary';

/** P8 — "الغياب": this month, total, and the absent days. */
export function GuardianAttendancePage() {
  const studentId = useStudentId();
  const qc = useQueryClient();
  // Shares the panel's query; once the list is loaded the server has marked the module seen,
  // so refresh the home badges.
  const { dataUpdatedAt } = useStudentAttendance(studentId);
  useEffect(() => {
    if (dataUpdatedAt) void qc.invalidateQueries({ queryKey: ['students', studentId, 'summary'] });
  }, [dataUpdatedAt, qc, studentId]);

  return (
    <MobilePage title="الغياب">
      <StudentAttendanceSummary studentId={studentId} />
    </MobilePage>
  );
}

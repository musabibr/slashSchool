import { useParams } from 'react-router';

/** :schoolId from /s/:schoolId/* or /a/:schoolId/* */
export function useSchoolId(): string {
  const { schoolId } = useParams();
  if (!schoolId) throw new Error('schoolId route param missing');
  return schoolId;
}

/** :studentId from /g/:studentId/* */
export function useStudentId(): string {
  const { studentId } = useParams();
  if (!studentId) throw new Error('studentId route param missing');
  return studentId;
}

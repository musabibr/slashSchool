import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../../api/client';

/** GET /api/schools/:schoolId/attendance/today */
export interface AttendanceToday {
  date: string;
  classes: Array<{ classId: string; label: string; studentCount: number; recorded: boolean; absentCount: number }>;
}

/** GET /api/schools/:schoolId/attendance/sessions */
export interface AttendanceSessionRow {
  date: string;
  absentCount: number;
  recordedByName: string | null;
  updatedAt: string;
}

export interface AttendanceStudent {
  id: string;
  code: string;
  fullName: string;
  absent: boolean;
  note: string | null;
}

/** GET/PUT /api/schools/:schoolId/attendance/:classId/:date */
export interface ClassAttendance {
  classSectionId: string;
  classLabel: string;
  date: string;
  recorded: boolean;
  recordedByName: string | null;
  updatedAt: string | null;
  students: AttendanceStudent[];
}

/** GET /api/students/:studentId/attendance (P8) */
export interface StudentAttendance {
  thisMonth: number;
  total: number;
  days: Array<{ date: string; weekday: number; note: string | null }>;
}

const schoolKey = (schoolId: string) => ['schools', schoolId, 'attendance'] as const;

export function useAttendanceToday(schoolId: string) {
  return useQuery({
    queryKey: [...schoolKey(schoolId), 'today'],
    queryFn: () => api.get<AttendanceToday>(`/api/schools/${schoolId}/attendance/today`),
  });
}

export function useAttendanceSessions(schoolId: string, classId: string | null) {
  return useQuery({
    queryKey: [...schoolKey(schoolId), 'sessions', classId],
    queryFn: () => api.get<AttendanceSessionRow[]>(`/api/schools/${schoolId}/attendance/sessions${qs({ classId })}`),
    enabled: !!classId,
  });
}

export function useClassAttendance(schoolId: string, classId: string | null, date: string | null) {
  return useQuery({
    queryKey: [...schoolKey(schoolId), 'class', classId, date],
    queryFn: () => api.get<ClassAttendance>(`/api/schools/${schoolId}/attendance/${classId}/${date}`),
    enabled: !!classId && !!date,
  });
}

export function useStudentAttendance(studentId: string) {
  return useQuery({
    queryKey: ['students', studentId, 'attendance'],
    queryFn: () => api.get<StudentAttendance>(`/api/students/${studentId}/attendance`),
  });
}

export interface SaveAttendanceInput {
  classId: string;
  date: string;
  absentStudentIds: string[];
  notes: Record<string, string>;
}

/** Record (S9) or update (S10) one class+day; the server upsert is idempotent. */
export function useSaveAttendance(schoolId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ classId, date, absentStudentIds, notes }: SaveAttendanceInput) =>
      api.put<ClassAttendance>(`/api/schools/${schoolId}/attendance/${classId}/${date}`, { absentStudentIds, notes }),
    onSuccess: async (data) => {
      qc.setQueryData([...schoolKey(schoolId), 'class', data.classSectionId, data.date], data);
      await Promise.all([
        qc.invalidateQueries({
          queryKey: schoolKey(schoolId),
          predicate: (q) => q.queryKey[3] !== 'class',
        }),
        // Student attendance panels (admin student profile) of any student.
        qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'students' && q.queryKey[2] === 'attendance' }),
      ]);
    },
  });
}

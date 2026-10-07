import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { FeeAccount, InstallmentStatus, PaymentMethod } from '@slash/shared';
import { api } from '../../api/client';

// ───────────────────────────── Types (API responses) ─────────────────────────────

export interface PlanInstallment {
  id: string;
  seq: number;
  amount: number;
  dueDate: string;
}

/** GET /api/schools/:schoolId/fees/plans */
export interface FeePlan {
  id: string;
  name: string;
  academicYearId: string;
  academicYearName: string;
  gradeLevelId: string | null;
  gradeLevelName: string | null;
  total: number;
  installments: PlanInstallment[];
  studentCount: number;
  /** Payments are recorded under the plan (it cannot be deleted). */
  hasPayments: boolean;
}

export interface FeeTotals {
  total: number;
  discount: number;
  net: number;
  paid: number;
  remaining: number;
  overdue: number;
  credit: number;
}

export interface StaffPayment {
  id: string;
  studentFeeId: string;
  amount: number;
  paidAt: string;
  method: PaymentMethod;
  receiptNo: string | null;
  note: string | null;
  recordedByName: string | null;
  createdAt: string;
}

export interface StudentFeeAccount {
  studentFeeId: string;
  planId: string;
  planName: string;
  discount: number;
  account: FeeAccount;
}

/** GET /api/schools/:schoolId/fees/students/:studentId */
export interface StudentFees {
  /** The school's today (YYYY-MM-DD). */
  today: string;
  student: {
    id: string;
    code: string;
    fullName: string;
    status: string;
    classLabel: string | null;
    gradeLevelId: string | null;
  };
  accounts: StudentFeeAccount[];
  totals: FeeTotals;
  payments: StaffPayment[];
}

/** GET /api/schools/:schoolId/fees/overview */
export interface FeesOverview {
  expected: number;
  collected: number;
  outstanding: number;
  overdue: number;
  studentsWithArrears: number;
  arrears: Array<{
    studentId: string;
    code: string;
    fullName: string;
    classLabel: string | null;
    status: string;
    remaining: number;
    overdue: number;
  }>;
  recentPayments: Array<{
    id: string;
    studentId: string;
    studentName: string;
    code: string;
    planName: string;
    amount: number;
    paidAt: string;
    method: PaymentMethod;
    receiptNo: string | null;
    recordedByName: string | null;
    createdAt: string;
  }>;
}

/** POST /api/schools/:schoolId/fees/students/:studentId/notice */
export interface FeeNotice {
  announcementId: string;
  body: string;
  contacts: Array<{ fullName: string; phone: string; whatsappUrl: string }>;
}

/** GET /api/students/:studentId/fees (P9) */
export interface GuardianFees {
  today: string;
  plans: Array<{
    planName: string;
    total: number;
    discount: number;
    net: number;
    paid: number;
    remaining: number;
    overdue: number;
    credit: number;
    installments: Array<{
      seq: number;
      amount: number;
      due: number;
      paid: number;
      remaining: number;
      dueDate: string;
      status: InstallmentStatus;
    }>;
  }>;
  totals: FeeTotals;
  payments: Array<{ amount: number; paidAt: string; method: PaymentMethod; receiptNo: string | null }>;
}

export interface PlanInput {
  name: string;
  gradeLevelId: string | null;
  installments: Array<{ amount: number; dueDate: string }>;
}

export interface PaymentInput {
  amount: number;
  paidAt: string;
  method: PaymentMethod;
  receiptNo: string | null;
  note: string | null;
}

// ───────────────────────────── Keys ─────────────────────────────

export const feeKeys = {
  school: (schoolId: string) => ['schools', schoolId, 'fees'] as const,
  plans: (schoolId: string) => ['schools', schoolId, 'fees', 'plans'] as const,
  overview: (schoolId: string) => ['schools', schoolId, 'fees', 'overview'] as const,
  student: (schoolId: string, studentId: string) => ['schools', schoolId, 'fees', 'student', studentId] as const,
  guardian: (studentId: string) => ['students', studentId, 'fees'] as const,
};

/** Everything fee-related may change after any fee mutation: the school's views and every P9. */
function invalidateFees(qc: QueryClient, schoolId: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: feeKeys.school(schoolId) }),
    qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'students' && q.queryKey[2] === 'fees' }),
  ]);
}

// ───────────────────────────── Guardian ─────────────────────────────

/** P9. Loading it marks the fees badge as seen on the server, so the home summary is refreshed after. */
export function useGuardianFees(studentId: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: feeKeys.guardian(studentId),
    queryFn: () => api.get<GuardianFees>(`/api/students/${studentId}/fees`),
    refetchOnMount: 'always',
  });
  const { isSuccess, dataUpdatedAt } = query;
  const lastSynced = useRef(dataUpdatedAt);
  useEffect(() => {
    if (!isSuccess || dataUpdatedAt === lastSynced.current) return;
    lastSynced.current = dataUpdatedAt;
    void qc.invalidateQueries({ queryKey: ['students', studentId, 'summary'] });
  }, [qc, studentId, isSuccess, dataUpdatedAt]);
  return query;
}

// ───────────────────────────── Director ─────────────────────────────

export function useFeePlans(schoolId: string) {
  return useQuery({
    queryKey: feeKeys.plans(schoolId),
    queryFn: () => api.get<FeePlan[]>(`/api/schools/${schoolId}/fees/plans`),
  });
}

export function useFeesOverview(schoolId: string, enabled = true) {
  return useQuery({
    queryKey: feeKeys.overview(schoolId),
    queryFn: () => api.get<FeesOverview>(`/api/schools/${schoolId}/fees/overview`),
    enabled,
  });
}

export function useStudentFees(schoolId: string, studentId: string) {
  return useQuery({
    queryKey: feeKeys.student(schoolId, studentId),
    queryFn: () => api.get<StudentFees>(`/api/schools/${schoolId}/fees/students/${studentId}`),
  });
}

export function useSavePlan(schoolId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: PlanInput }) =>
      id
        ? api.patch<FeePlan>(`/api/schools/${schoolId}/fees/plans/${id}`, input)
        : api.post<FeePlan>(`/api/schools/${schoolId}/fees/plans`, input),
    onSuccess: () => invalidateFees(qc, schoolId),
  });
}

export function useDeletePlan(schoolId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/schools/${schoolId}/fees/plans/${id}`),
    onSuccess: () => invalidateFees(qc, schoolId),
  });
}

export function useAssignPlan(schoolId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      planId,
      ...body
    }: {
      planId: string;
      studentIds?: string[];
      gradeLevelId?: string;
      discount?: number;
    }) => api.post<{ assigned: number; skipped: number }>(`/api/schools/${schoolId}/fees/plans/${planId}/assign`, body),
    onSuccess: () => invalidateFees(qc, schoolId),
  });
}

export function useUpdateDiscount(schoolId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ studentFeeId, discount }: { studentFeeId: string; discount: number }) =>
      api.patch(`/api/schools/${schoolId}/fees/student-fees/${studentFeeId}`, { discount }),
    onSuccess: () => invalidateFees(qc, schoolId),
  });
}

export function useRemoveStudentFee(schoolId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (studentFeeId: string) => api.delete(`/api/schools/${schoolId}/fees/student-fees/${studentFeeId}`),
    onSuccess: () => invalidateFees(qc, schoolId),
  });
}

export function useRecordPayment(schoolId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ studentFeeId, input }: { studentFeeId: string; input: PaymentInput }) =>
      api.post<StaffPayment>(`/api/schools/${schoolId}/fees/student-fees/${studentFeeId}/payments`, input),
    onSuccess: () => invalidateFees(qc, schoolId),
  });
}

export function useDeletePayment(schoolId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (paymentId: string) => api.delete(`/api/schools/${schoolId}/fees/payments/${paymentId}`),
    onSuccess: () => invalidateFees(qc, schoolId),
  });
}

export function useSendFeeNotice(schoolId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (studentId: string) =>
      api.post<FeeNotice>(`/api/schools/${schoolId}/fees/students/${studentId}/notice`),
    // The notice is an announcement to the student's guardians.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schools', schoolId, 'announcements'] }),
  });
}

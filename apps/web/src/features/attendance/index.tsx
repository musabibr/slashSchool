// Feature entry point — pages and panels are imported by routes.tsx and other features.
// Placeholder implementations; replace each with the real screen.
import { AdminPage } from '../../components/AdminPage';
import { ComingSoon } from '../../components/States';
import { MobilePage } from '../../components/MobilePage';

export function GuardianAttendancePage() {
  return (
    <MobilePage title="الغياب">
      <ComingSoon title="الغياب" />
    </MobilePage>
  );
}

export function AttendanceHubPage() {
  return (
    <MobilePage title="الغياب">
      <ComingSoon title="الغياب" />
    </MobilePage>
  );
}

export function AttendanceRecordPage() {
  return (
    <MobilePage title="تسجيل الغياب">
      <ComingSoon title="تسجيل الغياب" />
    </MobilePage>
  );
}

export function AdminAttendancePage() {
  return (
    <AdminPage title="تسجيل الغياب">
      <ComingSoon title="تسجيل الغياب" />
    </AdminPage>
  );
}

export function StudentAttendanceSummary(_props: { studentId: string }) {
  return <ComingSoon title="StudentAttendanceSummary" />;
}

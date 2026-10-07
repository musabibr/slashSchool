// Feature entry point — pages and panels are imported by routes.tsx and other features.
// Placeholder implementations; replace each with the real screen.
import { AdminPage } from '../../components/AdminPage';
import { ComingSoon } from '../../components/States';
import { MobilePage } from '../../components/MobilePage';

export function GuardianAnnouncementsPage() {
  return (
    <MobilePage title="الإعلانات">
      <ComingSoon title="الإعلانات" />
    </MobilePage>
  );
}

export function GuardianCalendarPage() {
  return (
    <MobilePage title="التقويم الدراسي">
      <ComingSoon title="التقويم الدراسي" />
    </MobilePage>
  );
}

export function AdminAnnouncementsPage() {
  return (
    <AdminPage title="الإعلانات">
      <ComingSoon title="الإعلانات" />
    </AdminPage>
  );
}

export function AdminCalendarPage() {
  return (
    <AdminPage title="التقويم">
      <ComingSoon title="التقويم" />
    </AdminPage>
  );
}

export function MessageGuardianButton(_props: { studentId: string; schoolId: string; studentName: string }) {
  return <ComingSoon title="MessageGuardianButton" />;
}

// Feature entry point — pages and panels are imported by routes.tsx and other features.
// Placeholder implementations; replace each with the real screen.
import { AdminPage } from '../../components/AdminPage';
import { ComingSoon } from '../../components/States';
import { MobilePage } from '../../components/MobilePage';

export function GuardianFeesPage() {
  return (
    <MobilePage title="الرسوم الدراسية">
      <ComingSoon title="الرسوم الدراسية" />
    </MobilePage>
  );
}

export function AdminFeesPage() {
  return (
    <AdminPage title="الرسوم الدراسية">
      <ComingSoon title="الرسوم الدراسية" />
    </AdminPage>
  );
}

export function StudentFeesPanel(_props: { studentId: string; schoolId: string }) {
  return <ComingSoon title="StudentFeesPanel" />;
}

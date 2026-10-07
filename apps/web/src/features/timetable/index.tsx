// Feature entry point — pages and panels are imported by routes.tsx and other features.
// Placeholder implementations; replace each with the real screen.
import { AdminPage } from '../../components/AdminPage';
import { ComingSoon } from '../../components/States';
import { MobilePage } from '../../components/MobilePage';

export function StaffTimetablePage() {
  return (
    <MobilePage title="الجداول الدراسية">
      <ComingSoon title="الجداول الدراسية" />
    </MobilePage>
  );
}

export function AdminTimetablePage() {
  return (
    <AdminPage title="الجداول الدراسية">
      <ComingSoon title="الجداول الدراسية" />
    </AdminPage>
  );
}

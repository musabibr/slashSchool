// Feature entry point — pages and panels are imported by routes.tsx and other features.
// Placeholder implementations; replace each with the real screen.
import { AdminPage } from '../../components/AdminPage';
import { ComingSoon } from '../../components/States';
import { MobilePage } from '../../components/MobilePage';

export function GuardianBehaviorPage() {
  return (
    <MobilePage title="السلوك والإنضباط">
      <ComingSoon title="السلوك والإنضباط" />
    </MobilePage>
  );
}

export function BehaviorRecordPage() {
  return (
    <MobilePage title="السلوك والإنضباط">
      <ComingSoon title="السلوك والإنضباط" />
    </MobilePage>
  );
}

export function EvaluationPage() {
  return (
    <MobilePage title="تقييم الطلبة">
      <ComingSoon title="تقييم الطلبة" />
    </MobilePage>
  );
}

export function AdminRegulationsPage() {
  return (
    <AdminPage title="اللوائح المدرسية">
      <ComingSoon title="اللوائح المدرسية" />
    </AdminPage>
  );
}

export function StudentBehaviorPanel(_props: { studentId: string; schoolId: string }) {
  return <ComingSoon title="StudentBehaviorPanel" />;
}

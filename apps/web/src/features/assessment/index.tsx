// Feature entry point — pages and panels are imported by routes.tsx and other features.
// Placeholder implementations; replace each with the real screen.
import { ComingSoon } from '../../components/States';
import { MobilePage } from '../../components/MobilePage';

export function GuardianExamsHubPage() {
  return (
    <MobilePage title="الإمتحانات">
      <ComingSoon title="الإمتحانات" />
    </MobilePage>
  );
}

export function GuardianQuizzesPage() {
  return (
    <MobilePage title="إعلانات الإختبارات">
      <ComingSoon title="إعلانات الإختبارات" />
    </MobilePage>
  );
}

export function GuardianExamTimetablePage() {
  return (
    <MobilePage title="جدول الإمتحانات">
      <ComingSoon title="جدول الإمتحانات" />
    </MobilePage>
  );
}

export function GuardianResultsPage() {
  return (
    <MobilePage title="النتائج">
      <ComingSoon title="النتائج" />
    </MobilePage>
  );
}

export function GuardianResultSheetPage() {
  return (
    <MobilePage title="النتائج">
      <ComingSoon title="النتائج" />
    </MobilePage>
  );
}

export function StaffExamsHubPage() {
  return (
    <MobilePage title="الإمتحانات">
      <ComingSoon title="الإمتحانات" />
    </MobilePage>
  );
}

export function ExamTimetableBuilderPage() {
  return (
    <MobilePage title="اضافة/تعديل جدول إمتحان">
      <ComingSoon title="اضافة/تعديل جدول إمتحان" />
    </MobilePage>
  );
}

export function StaffQuizzesPage() {
  return (
    <MobilePage title="إعلانات الإختبارات">
      <ComingSoon title="إعلانات الإختبارات" />
    </MobilePage>
  );
}

export function QuizFormPage() {
  return (
    <MobilePage title="اضافة اعلان اختبار">
      <ComingSoon title="اضافة اعلان اختبار" />
    </MobilePage>
  );
}

export function GradesEntryPage() {
  return (
    <MobilePage title="اضافة درجات">
      <ComingSoon title="اضافة درجات" />
    </MobilePage>
  );
}

export function StudentResultsPanel(_props: { studentId: string }) {
  return <ComingSoon title="StudentResultsPanel" />;
}

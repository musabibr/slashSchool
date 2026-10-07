// Feature entry point — pages and panels are imported by routes.tsx and other features.
// Placeholder implementations; replace each with the real screen.
import type { Role } from '@slash/shared';
import { AdminPage } from '../../components/AdminPage';
import { ComingSoon } from '../../components/States';

export function AdminDashboardPage() {
  return (
    <AdminPage title="الرئيسية">
      <ComingSoon title="الرئيسية" />
    </AdminPage>
  );
}

export function AdminStudentsPage() {
  return (
    <AdminPage title="الطلاب">
      <ComingSoon title="الطلاب" />
    </AdminPage>
  );
}

export function AdmissionPage() {
  return (
    <AdminPage title="القبول والتسجيل">
      <ComingSoon title="القبول والتسجيل" />
    </AdminPage>
  );
}

export function StudentImportPage() {
  return (
    <AdminPage title="استيراد الطلاب">
      <ComingSoon title="استيراد الطلاب" />
    </AdminPage>
  );
}

export function AdminStudentProfilePage() {
  return (
    <AdminPage title="ملف الطالب">
      <ComingSoon title="ملف الطالب" />
    </AdminPage>
  );
}

export function AdminGuardiansPage() {
  return (
    <AdminPage title="أولياء الأمور">
      <ComingSoon title="أولياء الأمور" />
    </AdminPage>
  );
}

export function AdminSetupPage() {
  return (
    <AdminPage title="الفصول والمواد">
      <ComingSoon title="الفصول والمواد" />
    </AdminPage>
  );
}

export function AdminSettingsPage() {
  return (
    <AdminPage title="الإعدادات">
      <ComingSoon title="الإعدادات" />
    </AdminPage>
  );
}

/** Supervisors or teachers list (one page, two sidebar entries). */
export function AdminStaffPage({ role }: { role: Extract<Role, 'supervisor' | 'teacher'> }) {
  const title = role === 'supervisor' ? 'المشرفين' : 'الأساتذة';
  return (
    <AdminPage title={title}>
      <ComingSoon title={title} />
    </AdminPage>
  );
}

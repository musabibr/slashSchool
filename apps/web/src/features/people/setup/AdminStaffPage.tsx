import type { Role } from '@slash/shared';
import { AdminPage } from '../../../components/AdminPage';
import { ComingSoon } from '../../../components/States';

/** Supervisors or teachers list (one page, two sidebar entries). */
export function AdminStaffPage({ role }: { role: Extract<Role, 'supervisor' | 'teacher'> }) {
  const title = role === 'supervisor' ? 'المشرفين' : 'الأساتذة';
  return (
    <AdminPage title={title}>
      <ComingSoon title={title} />
    </AdminPage>
  );
}

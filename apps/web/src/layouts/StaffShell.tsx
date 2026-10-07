import { Navigate, Outlet } from 'react-router';
import { useMe, useScope } from '../api/hooks';
import { MobileHeaderContext } from '../components/MobilePage';
import { ErrorState, PageLoader } from '../components/States';
import { useSchoolId } from '../lib/params';

/** /s/:schoolId/* — supervisor & teacher mobile screens; the header shows the staff member and school. */
export function StaffShell() {
  const schoolId = useSchoolId();
  const me = useMe();
  const scope = useScope(schoolId);
  const membership = me.data?.schools.find((s) => s.id === schoolId);
  if (me.data && !membership) return <Navigate to="/select" replace />;
  return (
    <div className="mobile-frame">
      {scope.isLoading || !me.data ? (
        <PageLoader />
      ) : scope.error || !scope.data ? (
        <ErrorState error={scope.error} onRetry={() => scope.refetch()} />
      ) : (
        <MobileHeaderContext.Provider value={{ personName: me.data.user.fullName, schoolName: scope.data.school.name }}>
          <Outlet />
        </MobileHeaderContext.Provider>
      )}
    </div>
  );
}

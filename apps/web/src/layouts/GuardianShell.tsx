import { Outlet } from 'react-router';
import { useStudentSummary } from '../api/hooks';
import { MobileHeaderContext } from '../components/MobilePage';
import { ErrorState, PageLoader } from '../components/States';
import { useStudentId } from '../lib/params';

/** /g/:studentId/* — guardian screens for one child; the header shows the student and school. */
export function GuardianShell() {
  const studentId = useStudentId();
  const summary = useStudentSummary(studentId);
  return (
    <div className="mobile-frame">
      {summary.isLoading ? (
        <PageLoader />
      ) : summary.error || !summary.data ? (
        <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
      ) : (
        <MobileHeaderContext.Provider
          value={{ personName: summary.data.student.fullName, schoolName: summary.data.school.name }}
        >
          <Outlet />
        </MobileHeaderContext.Provider>
      )}
    </div>
  );
}

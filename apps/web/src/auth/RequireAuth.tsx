import { Navigate, Outlet, useLocation } from 'react-router';
import { useMe } from '../api/hooks';
import { ErrorState, PageLoader } from '../components/States';
import { DemoSwitcher } from './demo';

/** Gate for every logged-in route. */
export function RequireAuth() {
  const me = useMe();
  const location = useLocation();
  if (me.isLoading) return <PageLoader />;
  if (me.error) return <ErrorState error={me.error} onRetry={() => me.refetch()} />;
  if (!me.data) {
    const next = location.pathname + location.search;
    return <Navigate to={`/login${next && next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} replace />;
  }
  return (
    <>
      <Outlet />
      <DemoSwitcher />
    </>
  );
}

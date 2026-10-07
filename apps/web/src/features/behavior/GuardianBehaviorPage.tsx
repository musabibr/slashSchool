import { MobilePage } from '../../components/MobilePage';
import { QueryState } from '../../components/States';
import { useStudentId } from '../../lib/params';
import { useGuardianBehavior } from './api';
import { StudentBehaviorView } from './StudentBehaviorView';

/** P14 — "السلوك والإنضباط": violation / penalty counts, incidents, then the teachers' evaluations. */
export function GuardianBehaviorPage() {
  const studentId = useStudentId();
  const q = useGuardianBehavior(studentId);
  return (
    <MobilePage title="السلوك والإنضباط">
      <QueryState query={q}>{(data) => <StudentBehaviorView data={data} />}</QueryState>
    </MobilePage>
  );
}

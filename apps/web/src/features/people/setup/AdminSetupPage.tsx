import { Tabs } from '@mantine/core';
import { IconBook2, IconBuildingCommunity, IconCalendarStats, IconUsersGroup } from '@tabler/icons-react';
import { useSearchParams } from 'react-router';
import { AdminPage } from '../../../components/AdminPage';
import { QueryState } from '../../../components/States';
import { useSchoolId } from '../../../lib/params';
import { useStructure } from './api';
import { AssignmentsTab } from './AssignmentsTab';
import { StructureTab } from './StructureTab';
import { SubjectsTab } from './SubjectsTab';
import { YearsTab } from './YearsTab';

const TABS = ['classes', 'subjects', 'assignments', 'years'] as const;
type Tab = (typeof TABS)[number];
const isTab = (v: string | null): v is Tab => !!v && (TABS as readonly string[]).includes(v);

/** Director's "الفصول والمواد": school structure, subjects, who teaches what, academic years. */
export function AdminSetupPage() {
  const schoolId = useSchoolId();
  const q = useStructure(schoolId);
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: Tab = isTab(raw) ? raw : 'classes';
  const currentYear = q.data?.academicYears.find((y) => y.id === q.data?.currentAcademicYearId);

  return (
    <AdminPage title="الفصول والمواد" subtitle={currentYear ? `العام الدراسي الحالي: ${currentYear.name}` : undefined}>
      <Tabs
        value={tab}
        onChange={(v) => isTab(v) && setParams(v === 'classes' ? {} : { tab: v }, { replace: true })}
        keepMounted={false}
      >
        <Tabs.List mb="md">
          <Tabs.Tab value="classes" leftSection={<IconBuildingCommunity size={16} />}>
            الفصول
          </Tabs.Tab>
          <Tabs.Tab value="subjects" leftSection={<IconBook2 size={16} />}>
            المواد
          </Tabs.Tab>
          <Tabs.Tab value="assignments" leftSection={<IconUsersGroup size={16} />}>
            توزيع المواد
          </Tabs.Tab>
          <Tabs.Tab value="years" leftSection={<IconCalendarStats size={16} />}>
            الأعوام الدراسية
          </Tabs.Tab>
        </Tabs.List>
        <QueryState query={q}>
          {(structure) => (
            <>
              <Tabs.Panel value="classes">
                <StructureTab schoolId={schoolId} structure={structure} />
              </Tabs.Panel>
              <Tabs.Panel value="subjects">
                <SubjectsTab schoolId={schoolId} structure={structure} />
              </Tabs.Panel>
              <Tabs.Panel value="assignments">
                <AssignmentsTab schoolId={schoolId} structure={structure} />
              </Tabs.Panel>
              <Tabs.Panel value="years">
                <YearsTab schoolId={schoolId} structure={structure} />
              </Tabs.Panel>
            </>
          )}
        </QueryState>
      </Tabs>
    </AdminPage>
  );
}

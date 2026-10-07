import { SimpleGrid, Stack, Text } from '@mantine/core';
import { IconShieldCheck, IconStars } from '@tabler/icons-react';
import { EmptyState } from '../../components/States';
import type { StudentBehavior } from './api';
import { EvaluationList, IncidentCard, StatCard } from './ui';

/**
 * P14 body: the two counters, the incident cards and "تقييم المعلمين". Shared by the guardian
 * screen and the director's student panel (which passes `onDeleteIncident`).
 */
export function StudentBehaviorView({
  data,
  onDeleteIncident,
}: {
  data: StudentBehavior;
  onDeleteIncident?: (incident: StudentBehavior['incidents'][number]) => void;
}) {
  return (
    <Stack gap="md">
      <SimpleGrid cols={2} spacing="sm">
        <StatCard label="عدد المخالفات" value={data.violations} />
        <StatCard label="عدد العقوبات" value={data.penalties} />
      </SimpleGrid>

      <Stack gap="xs">
        <Text fw={700}>المخالفات</Text>
        {data.incidents.length === 0 ? (
          <EmptyState message="لا توجد مخالفات مسجلة" icon={<IconShieldCheck size={36} stroke={1.5} />} />
        ) : (
          data.incidents.map((i) => (
            <IncidentCard
              key={i.id}
              date={i.date}
              regulationTitle={i.regulationTitle}
              details={i.details}
              penalty={i.penalty}
              onDelete={onDeleteIncident ? () => onDeleteIncident(i) : undefined}
            />
          ))
        )}
      </Stack>

      <Stack gap="xs">
        <Text fw={700}>تقييم المعلمين</Text>
        {data.evaluations.length === 0 ? (
          <EmptyState message="لا توجد تقييمات من المعلمين بعد" icon={<IconStars size={36} stroke={1.5} />} />
        ) : (
          <EvaluationList items={data.evaluations} />
        )}
      </Stack>
    </Stack>
  );
}

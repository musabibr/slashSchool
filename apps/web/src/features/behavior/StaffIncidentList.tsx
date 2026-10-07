import { useState } from 'react';
import { Stack, Text } from '@mantine/core';
import { QueryState } from '../../components/States';
import { notifyError, notifySuccess } from '../../lib/notify';
import { useDeleteIncident, useIncidents, type Incident, type IncidentFilters } from './api';
import { ConfirmDialog, IncidentCard } from './ui';

/** Recent incidents (newest first) as cards with the student, the recorder and a delete action. */
export function StaffIncidentList({
  schoolId,
  filters,
  empty = 'لا توجد مخالفات مسجلة',
}: {
  schoolId: string;
  filters: IncidentFilters;
  empty?: string;
}) {
  const q = useIncidents(schoolId, filters);
  const [pending, setPending] = useState<Incident | null>(null);
  const remove = useDeleteIncident(schoolId);

  return (
    <>
      <QueryState query={q} empty={empty} isEmpty={(rows) => rows.length === 0}>
        {(rows) => (
          <Stack gap="xs">
            {rows.map((i) => (
              <IncidentCard
                key={i.id}
                date={i.date}
                regulationTitle={i.regulationTitle}
                details={i.details}
                penalty={i.penalty}
                heading={
                  <Text fw={700} truncate>
                    {i.studentName}
                    {i.classLabel && !filters.classId ? (
                      <Text span c="dimmed" size="xs" fw={400}>
                        {' '}
                        — {i.classLabel}
                      </Text>
                    ) : null}
                  </Text>
                }
                footer={
                  i.recordedByName ? (
                    <Text size="xs" c="dimmed">
                      سجلها: {i.recordedByName}
                    </Text>
                  ) : undefined
                }
                onDelete={() => setPending(i)}
              />
            ))}
          </Stack>
        )}
      </QueryState>
      <ConfirmDialog
        opened={!!pending}
        title="حذف المخالفة"
        message={pending ? `حذف مخالفة "${pending.regulationTitle}" للطالب ${pending.studentName}؟` : ''}
        loading={remove.isPending}
        onClose={() => setPending(null)}
        onConfirm={() =>
          pending &&
          remove.mutate(pending.id, {
            onSuccess: () => {
              notifySuccess('تم حذف المخالفة');
              setPending(null);
            },
            onError: notifyError,
          })
        }
      />
    </>
  );
}

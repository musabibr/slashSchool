import { useMemo, type ReactNode } from 'react';
import { Badge, Paper, Stack, Text } from '@mantine/core';
import { INSTALLMENT_STATUS_LABELS, type InstallmentStatus } from '@slash/shared';
import { useScope } from '../../api/hooks';
import { INSTALLMENT_STATUS_COLORS, money } from './labels';

/** Labelled amount card (P9 tiles, director summaries). */
export function MoneyCard({
  label,
  amount,
  color = 'dark',
  big = false,
  hint,
  children,
}: {
  label: string;
  amount: number;
  color?: string;
  big?: boolean;
  hint?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Paper withBorder radius="lg" p="md">
      <Stack gap={4} align="center">
        <Text size="sm" c="dimmed" ta="center" lh={1.3}>
          {label}
        </Text>
        <Text fw={700} fz={big ? 30 : 22} c={color} lh={1.2} ta="center">
          {money(amount)}
        </Text>
        {hint && (
          <Text size="xs" c="dimmed" ta="center">
            {hint}
          </Text>
        )}
        {children}
      </Stack>
    </Paper>
  );
}

/** Plain count card (e.g. "طلاب عليهم متأخرات"). */
export function CountCard({ label, value, color = 'dark' }: { label: string; value: number; color?: string }) {
  return (
    <Paper withBorder radius="lg" p="md">
      <Stack gap={4} align="center">
        <Text size="sm" c="dimmed" ta="center" lh={1.3}>
          {label}
        </Text>
        <Text fw={700} fz={22} c={color} lh={1.2}>
          {value}
        </Text>
      </Stack>
    </Paper>
  );
}

export function StatusBadge({ status }: { status: InstallmentStatus }) {
  return (
    <Badge color={INSTALLMENT_STATUS_COLORS[status]} variant="light" style={{ flexShrink: 0 }}>
      {INSTALLMENT_STATUS_LABELS[status]}
    </Badge>
  );
}

export interface GradeOption {
  value: string;
  label: string;
}

/** Grade levels of the current academic year (from the staff scope), in stage → grade order. */
export function useGradeOptions(schoolId: string): { options: GradeOption[]; today: string | null; loading: boolean } {
  const scope = useScope(schoolId);
  const options = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of scope.data?.classes ?? []) {
      if (!seen.has(c.gradeLevelId)) seen.set(c.gradeLevelId, c.gradeLevelName);
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [scope.data]);
  return { options, today: scope.data?.school.today ?? null, loading: scope.isLoading };
}

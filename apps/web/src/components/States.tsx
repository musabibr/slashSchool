import type { ReactNode } from 'react';
import { Alert, Button, Center, Loader, Paper, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconHourglassEmpty, IconMoodEmpty } from '@tabler/icons-react';
import { errorMessage } from '../lib/notify';

export function PageLoader() {
  return (
    <Center py="xl">
      <Loader />
    </Center>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Alert color="red" icon={<IconAlertTriangle />} title="تعذر تحميل البيانات" my="md">
      <Stack gap="xs" align="flex-start">
        <Text size="sm">{errorMessage(error)}</Text>
        {onRetry && (
          <Button size="xs" variant="light" color="red" onClick={onRetry}>
            إعادة المحاولة
          </Button>
        )}
      </Stack>
    </Alert>
  );
}

export function EmptyState({ message, icon }: { message: string; icon?: ReactNode }) {
  return (
    <Paper withBorder radius="md" p="xl" my="md">
      <Stack align="center" gap="xs" c="dimmed">
        {icon ?? <IconMoodEmpty size={36} stroke={1.5} />}
        <Text size="sm" ta="center">
          {message}
        </Text>
      </Stack>
    </Paper>
  );
}

/**
 * Renders loader / error / empty / content for a react-query result.
 * `isEmpty` decides when to show the empty message.
 */
export function QueryState<T>({
  query,
  empty,
  isEmpty,
  children,
}: {
  query: { data: T | undefined; isLoading: boolean; error: unknown; refetch: () => unknown };
  empty?: string;
  isEmpty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
}) {
  if (query.isLoading) return <PageLoader />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (query.data === undefined) return null;
  if (empty && isEmpty?.(query.data)) return <EmptyState message={empty} />;
  return <>{children(query.data)}</>;
}

/** Placeholder for screens not built yet. */
export function ComingSoon({ title }: { title: string }) {
  return (
    <Paper withBorder radius="md" p="xl" my="md">
      <Stack align="center" gap="xs" c="dimmed">
        <IconHourglassEmpty size={36} stroke={1.5} />
        <Text fw={600}>{title}</Text>
        <Text size="sm">قريباً</Text>
      </Stack>
    </Paper>
  );
}

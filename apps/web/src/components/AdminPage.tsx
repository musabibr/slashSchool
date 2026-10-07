import type { ReactNode } from 'react';
import { Box, Group, Stack, Text, Title } from '@mantine/core';

/** Desktop dashboard page frame: title (+ optional subtitle) and actions on one row. */
export function AdminPage({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <Box>
          <Title order={2}>{title}</Title>
          {subtitle && (
            <Text c="dimmed" size="sm">
              {subtitle}
            </Text>
          )}
        </Box>
        {actions && <Group gap="xs">{actions}</Group>}
      </Group>
      {children}
    </Stack>
  );
}

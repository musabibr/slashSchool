import type { ReactNode } from 'react';
import { Indicator, Paper, SimpleGrid, Stack, Text, UnstyledButton } from '@mantine/core';
import { Link } from 'react-router';

/** Menu tile with an optional red unread badge (P3, S3, T2, P4). */
export function Tile({
  label,
  icon,
  to,
  badge = 0,
  disabled = false,
  hint,
}: {
  label: string;
  icon?: ReactNode;
  to: string;
  badge?: number;
  disabled?: boolean;
  hint?: string;
}) {
  const body = (
    <Indicator
      label={badge > 99 ? '99+' : badge}
      size={20}
      color="red"
      disabled={!badge}
      offset={6}
      position="top-start"
      styles={{ indicator: { fontWeight: 700 } }}
    >
      <Paper
        withBorder
        radius="lg"
        p="sm"
        h={96}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.45 : 1,
          background: 'var(--mantine-color-body)',
        }}
      >
        <Stack gap={6} align="center">
          {icon}
          <Text fw={600} size="sm" ta="center" lh={1.3}>
            {label}
          </Text>
          {hint && (
            <Text size="10px" c="dimmed">
              {hint}
            </Text>
          )}
        </Stack>
      </Paper>
    </Indicator>
  );
  if (disabled) return <div aria-disabled>{body}</div>;
  return (
    <UnstyledButton component={Link} to={to} aria-label={label}>
      {body}
    </UnstyledButton>
  );
}

export function TileGrid({ children, cols = 3 }: { children: ReactNode; cols?: number }) {
  return (
    <SimpleGrid cols={cols} spacing="sm" verticalSpacing="md">
      {children}
    </SimpleGrid>
  );
}

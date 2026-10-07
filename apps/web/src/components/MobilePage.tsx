import { createContext, useContext, type ReactNode } from 'react';
import { Box, Button, Group, Stack, Text, Title } from '@mantine/core';
import { IconChevronLeft } from '@tabler/icons-react';
import { useLocation, useNavigate } from 'react-router';

/** Who the mobile header shows: the student (guardian app) or the staff member (staff app). */
export interface MobileHeaderInfo {
  personName: string;
  schoolName: string;
}

export const MobileHeaderContext = createContext<MobileHeaderInfo>({ personName: '', schoolName: '' });
export const useMobileHeader = () => useContext(MobileHeaderContext);

function parentPath(pathname: string): string {
  const parts = pathname.replace(/\/+$/, '').split('/');
  parts.pop();
  return parts.join('/') || '/';
}

/**
 * Standard mobile screen from the sketch: person name + school on one side, "الرجوع" on the other,
 * then the screen title in red. `backTo` defaults to the parent route; `back={false}` hides the button.
 */
export function MobilePage({
  title,
  children,
  backTo,
  back = true,
  actions,
}: {
  title: string;
  children: ReactNode;
  backTo?: string;
  back?: boolean;
  actions?: ReactNode;
}) {
  const { personName, schoolName } = useMobileHeader();
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <Box>
      <Box
        component="header"
        px="md"
        pt="md"
        pb="xs"
        style={{ borderBottom: '1px solid var(--mantine-color-gray-3)', background: 'var(--mantine-color-body)' }}
      >
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Stack gap={0} style={{ minWidth: 0 }}>
            <Text fw={700} size="lg" truncate>
              {personName}
            </Text>
            <Text c="dimmed" size="xs" truncate>
              {schoolName}
            </Text>
          </Stack>
          {back && (
            <Button
              variant="default"
              size="xs"
              rightSection={<IconChevronLeft size={16} />}
              onClick={() => navigate(backTo ?? parentPath(location.pathname))}
            >
              الرجوع
            </Button>
          )}
        </Group>
        <Group justify="space-between" mt="xs" wrap="nowrap">
          <Title order={4} c="red.7">
            {title}
          </Title>
          {actions}
        </Group>
      </Box>
      <Box p="md">{children}</Box>
    </Box>
  );
}

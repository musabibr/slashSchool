import { Center, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconSchool } from '@tabler/icons-react';

/** Logo block used on the login / activation screens. */
export function Brand() {
  return (
    <Center>
      <Stack align="center" gap={4}>
        <ThemeIcon size={72} radius={36} variant="light">
          <IconSchool size={40} stroke={1.5} />
        </ThemeIcon>
        <Title order={2}>سلاش سكول</Title>
        <Text c="dimmed" size="sm">
          قوم أقرأ — المدرسة في جيبك
        </Text>
      </Stack>
    </Center>
  );
}

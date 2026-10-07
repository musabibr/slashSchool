import { useEffect, useRef } from 'react';
import { Affix, ActionIcon, Alert, Button, Center, Loader, Menu, Stack, Text } from '@mantine/core';
import {
  IconChalkboard,
  IconFlask,
  IconLayoutDashboard,
  IconRefresh,
  IconUserShield,
  IconUsersGroup,
} from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import type { Role } from '@slash/shared';
import { api } from '../api/client';
import { usePublicConfig } from '../api/hooks';
import { errorMessage, notifySuccess } from '../lib/notify';

export const DEMO_ROLES: Array<{ role: Role; label: string; hint: string; icon: typeof IconFlask }> = [
  { role: 'guardian', label: 'ولي الأمر', hint: 'ثلاثة أبناء في مدرستين', icon: IconUsersGroup },
  { role: 'teacher', label: 'الأستاذ', hint: 'الدروس، الدرجات، التقييم', icon: IconChalkboard },
  { role: 'supervisor', label: 'المشرف', hint: 'الغياب، الإمتحانات، السلوك', icon: IconUserShield },
  { role: 'admin', label: 'المدير', hint: 'لوحة التحكم، الطلاب، الرسوم', icon: IconLayoutDashboard },
];

/** One-click demo login (demo mode only): no phone or PIN to type. */
export function useDemoLogin() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (role: Role) => api.post('/api/public/demo/login', { role }),
    onSuccess: async () => {
      qc.clear();
      await qc.fetchQuery({ queryKey: ['me'], queryFn: () => api.get('/api/me') });
      navigate('/select', { replace: true });
    },
  });
}

export function useDemoReset() {
  return useMutation({
    mutationFn: () => api.post('/api/public/demo/reset'),
    onSuccess: () => notifySuccess('تمت إعادة تعيين البيانات التجريبية'),
  });
}

/** /demo/:role — shareable link that logs straight in as that demo role. */
export function DemoLoginPage() {
  const { role } = useParams();
  const login = useDemoLogin();
  const started = useRef(false);
  const valid = DEMO_ROLES.some((r) => r.role === role);
  useEffect(() => {
    if (valid && !started.current) {
      started.current = true;
      login.mutate(role as Role);
    }
  }, [valid, role, login]);
  return (
    <Center h="100dvh" p="md">
      {login.error || !valid ? (
        <Stack align="center" maw={360}>
          <Alert color="red" w="100%">
            {valid ? errorMessage(login.error) : 'دور غير معروف'}
          </Alert>
          <Button component={Link} to="/login">
            صفحة الدخول
          </Button>
        </Stack>
      ) : (
        <Stack align="center" gap="xs">
          <Loader />
          <Text c="dimmed">جاري الدخول…</Text>
        </Stack>
      )}
    </Center>
  );
}

/** Floating switcher shown on every logged-in screen in demo mode: change role in one tap. */
export function DemoSwitcher() {
  const config = usePublicConfig();
  const login = useDemoLogin();
  const reset = useDemoReset();
  if (!config.data?.demoMode) return null;
  return (
    <Affix position={{ bottom: 88, left: 12 }} zIndex={300}>
      <Menu position="top-start" shadow="md" withinPortal>
        <Menu.Target>
          <ActionIcon size={44} radius="xl" color="yellow" variant="filled" aria-label="تبديل الدور (تجريبي)">
            {login.isPending || reset.isPending ? (
              <Loader size="xs" color="dark" />
            ) : (
              <IconFlask size={22} color="black" />
            )}
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>نسخة تجريبية — الدخول كـ</Menu.Label>
          {DEMO_ROLES.map((r) => (
            <Menu.Item key={r.role} leftSection={<r.icon size={16} />} onClick={() => login.mutate(r.role)}>
              {r.label}
            </Menu.Item>
          ))}
          <Menu.Divider />
          <Menu.Item leftSection={<IconRefresh size={16} />} color="red" onClick={() => reset.mutate()}>
            إعادة تعيين البيانات التجريبية
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Affix>
  );
}

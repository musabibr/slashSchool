import { AppShell, Burger, Button, Group, NavLink, ScrollArea, Select, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconBuildingCommunity,
  IconCalendarEvent,
  IconCalendarX,
  IconCash,
  IconChalkboard,
  IconGavel,
  IconHome,
  IconLogout,
  IconSettings,
  IconSpeakerphone,
  IconTable,
  IconUsers,
  IconUserShield,
  IconUsersGroup,
  IconSwitchHorizontal,
} from '@tabler/icons-react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { useMe } from '../api/hooks';
import { useLogout } from '../auth/SelectPage';
import { PageLoader } from '../components/States';
import { useSchoolId } from '../lib/params';

/** Sidebar from the sketch (D1) plus fees, announcements and settings. */
const NAV = [
  { to: '', label: 'الرئيسية', icon: IconHome },
  { to: 'students', label: 'الطلاب', icon: IconUsers },
  { to: 'supervisors', label: 'المشرفين', icon: IconUserShield },
  { to: 'teachers', label: 'الأساتذة', icon: IconChalkboard },
  { to: 'guardians', label: 'أولياء الأمور', icon: IconUsersGroup },
  { to: 'calendar', label: 'التقويم', icon: IconCalendarEvent },
  { to: 'classes', label: 'الفصول والمواد', icon: IconBuildingCommunity },
  { to: 'timetables', label: 'الجداول الدراسية', icon: IconTable },
  { to: 'regulations', label: 'اللوائح المدرسية', icon: IconGavel },
  { to: 'attendance', label: 'تسجيل الغياب', icon: IconCalendarX },
  { to: 'fees', label: 'الرسوم الدراسية', icon: IconCash },
  { to: 'announcements', label: 'الإعلانات', icon: IconSpeakerphone },
  { to: 'settings', label: 'الإعدادات', icon: IconSettings },
];

/** /a/:schoolId/* — director dashboard (desktop-first, right-hand sidebar in RTL). */
export function AdminShell() {
  const schoolId = useSchoolId();
  const me = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();
  const [opened, { toggle, close }] = useDisclosure();
  if (me.isLoading || !me.data) return <PageLoader />;
  const adminSchools = me.data.schools.filter((s) => s.roles.includes('admin'));
  const school = adminSchools.find((s) => s.id === schoolId);
  if (!school) return <Navigate to="/select" replace />;
  const base = `/a/${schoolId}`;
  const current = location.pathname.slice(base.length).replace(/^\//, '').split('/')[0] ?? '';

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 230, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Text fw={700} truncate>
              {school.name}
            </Text>
          </Group>
          <Group gap="xs" wrap="nowrap">
            {adminSchools.length > 1 && (
              <Select
                size="xs"
                w={200}
                data={adminSchools.map((s) => ({ value: s.id, label: s.name }))}
                value={schoolId}
                onChange={(v) => v && navigate(`/a/${v}`)}
                allowDeselect={false}
                visibleFrom="sm"
              />
            )}
            <Text size="sm" c="dimmed" visibleFrom="sm">
              {me.data.user.fullName}
            </Text>
            <Button
              size="xs"
              variant="default"
              component={Link}
              to="/select?stay=1"
              leftSection={<IconSwitchHorizontal size={14} />}
            >
              تبديل
            </Button>
            <Button size="xs" variant="subtle" color="red" leftSection={<IconLogout size={14} />} onClick={() => logout.mutate()}>
              خروج
            </Button>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        <ScrollArea>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              component={Link}
              to={item.to ? `${base}/${item.to}` : base}
              label={item.label}
              leftSection={<item.icon size={18} />}
              active={current === item.to}
              onClick={close}
              variant="filled"
              style={{ borderRadius: 8, marginBottom: 2 }}
            />
          ))}
        </ScrollArea>
      </AppShell.Navbar>
      <AppShell.Main bg="gray.0">
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}

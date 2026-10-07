import { forwardRef, useState } from 'react';
import { ActionIcon, Alert, Badge, Button, Card, Group, Modal, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconChevronLeft, IconLayoutDashboard, IconLogout, IconPlus, IconSchool, IconUser } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useSearchParams, type LinkProps } from 'react-router';
import { ROLE_LABELS, STUDENT_STATUS_LABELS } from '@slash/shared';
import { api } from '../api/client';
import { useMe } from '../api/hooks';
import type { Me } from '../api/types';
import { PageLoader } from '../components/States';
import { errorMessage, notifySuccess } from '../lib/notify';

/** Card-as-link helper (keeps client-side navigation). */
const GoTo = forwardRef<HTMLAnchorElement, LinkProps>(function GoTo(props, ref) {
  return <Link ref={ref} {...props} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }} />;
});

interface Destination {
  to: string;
}

/** Every screen a user can open, in display order. */
export function destinations(me: Me): Destination[] {
  const out: Destination[] = me.children.map((c) => ({ to: `/g/${c.id}` }));
  for (const s of me.schools) {
    if (s.roles.includes('admin')) out.push({ to: `/a/${s.id}` });
    if (s.roles.includes('supervisor') || s.roles.includes('teacher')) out.push({ to: `/s/${s.id}` });
  }
  return out;
}

export function useLogout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => api.post('/api/auth/logout'),
    onSettled: () => {
      qc.clear();
      navigate('/login', { replace: true });
    },
  });
}

function LinkChildModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const link = useMutation({
    mutationFn: () => api.post('/api/me/children/link', { code }),
    onSuccess: async () => {
      notifySuccess('تمت إضافة الطالب');
      setCode('');
      await qc.invalidateQueries({ queryKey: ['me'] });
      onClose();
    },
  });
  return (
    <Modal opened={opened} onClose={onClose} title="إضافة طالب" centered>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          link.mutate();
        }}
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            أدخل رمز الطالب الذي حصلت عليه من المدرسة لربطه بحسابك.
          </Text>
          <TextInput
            label="رمز الطالب"
            dir="ltr"
            value={code}
            onChange={(e) => setCode(e.currentTarget.value)}
            required
            autoFocus
          />
          {link.error && (
            <Alert color="red" variant="light">
              {errorMessage(link.error)}
            </Alert>
          )}
          <Button type="submit" loading={link.isPending}>
            إضافة
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}

/** P2 / S2: choose a child (grouped by school) or a staff workspace. Skipped when there is only one. */
export function SelectPage() {
  const me = useMe();
  const logout = useLogout();
  const [params] = useSearchParams();
  const [linkOpen, setLinkOpen] = useState(false);
  if (me.isLoading || !me.data) return <PageLoader />;
  const data = me.data;
  const dest = destinations(data);
  if (dest.length === 1 && !params.has('stay')) return <Navigate to={dest[0].to} replace />;

  const bySchool = new Map<string, { name: string; children: Me['children'] }>();
  for (const c of data.children) {
    const entry = bySchool.get(c.school.id) ?? { name: c.school.name, children: [] };
    entry.children.push(c);
    bySchool.set(c.school.id, entry);
  }

  return (
    <div className="mobile-frame">
      <Stack p="md" gap="md">
        <Group justify="space-between">
          <div>
            <Text size="sm" c="dimmed">
              مرحباً
            </Text>
            <Title order={3}>{data.user.fullName}</Title>
          </div>
          <Group gap="xs">
            <ActionIcon variant="light" size="lg" aria-label="إضافة طالب" onClick={() => setLinkOpen(true)}>
              <IconPlus size={20} />
            </ActionIcon>
            <ActionIcon variant="default" size="lg" aria-label="تسجيل الخروج" onClick={() => logout.mutate()}>
              <IconLogout size={20} />
            </ActionIcon>
          </Group>
        </Group>

        {[...bySchool.entries()].map(([schoolId, group]) => (
          <Stack key={schoolId} gap="xs">
            <Text fw={600} c="dimmed" size="sm">
              {group.name}
            </Text>
            {group.children.map((c) => (
              <Card key={c.id} withBorder radius="lg" padding="md" component={GoTo} to={`/g/${c.id}`}>
                <Group justify="space-between" wrap="nowrap">
                  <Group gap="sm" wrap="nowrap">
                    <IconUser size={22} />
                    <div>
                      <Text fw={700}>{c.fullName}</Text>
                      <Text size="xs" c="dimmed">
                        {c.classLabel ?? 'لم يحدد الفصل'}
                      </Text>
                    </div>
                  </Group>
                  <Group gap={6} wrap="nowrap">
                    {c.status !== 'active' && (
                      <Badge color="gray" variant="light">
                        {STUDENT_STATUS_LABELS[c.status as keyof typeof STUDENT_STATUS_LABELS] ?? c.status}
                      </Badge>
                    )}
                    <IconChevronLeft size={18} />
                  </Group>
                </Group>
              </Card>
            ))}
          </Stack>
        ))}

        {data.schools.map((s) => (
          <Stack key={s.id} gap="xs">
            <Text fw={600} c="dimmed" size="sm">
              {s.name} — {s.roles.map((r) => ROLE_LABELS[r]).join('، ')}
            </Text>
            {s.roles.includes('admin') && (
              <Card withBorder radius="lg" padding="md" component={GoTo} to={`/a/${s.id}`}>
                <Group gap="sm">
                  <IconLayoutDashboard size={22} />
                  <Text fw={700}>لوحة المدير</Text>
                </Group>
              </Card>
            )}
            {(s.roles.includes('supervisor') || s.roles.includes('teacher')) && (
              <Card withBorder radius="lg" padding="md" component={GoTo} to={`/s/${s.id}`}>
                <Group gap="sm">
                  <IconSchool size={22} />
                  <Text fw={700}>{s.roles.includes('supervisor') ? 'تطبيق المشرف' : 'تطبيق الأستاذ'}</Text>
                </Group>
              </Card>
            )}
          </Stack>
        ))}

        {dest.length === 0 && (
          <Alert color="yellow" title="لا يوجد ما يمكن عرضه">
            لم يتم ربط حسابك بأي طالب أو مدرسة بعد. إذا كان لديك رمز طالب اضغط على (+).
          </Alert>
        )}
      </Stack>
      <LinkChildModal opened={linkOpen} onClose={() => setLinkOpen(false)} />
    </div>
  );
}

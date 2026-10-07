import { useState } from 'react';
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Collapse,
  Divider,
  Group,
  Paper,
  PasswordInput,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  UnstyledButton,
} from '@mantine/core';
import { IconFlask, IconRefresh } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { api } from '../api/client';
import { useMe, usePublicConfig } from '../api/hooks';
import { PageLoader } from '../components/States';
import { errorMessage } from '../lib/notify';
import { Brand } from './Brand';
import { DEMO_ROLES, useDemoLogin, useDemoReset } from './demo';

function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/select';
}

export function LoginPage() {
  const me = useMe();
  const config = usePublicConfig();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [showForm, setShowForm] = useState(false);
  const demoLogin = useDemoLogin();
  const reset = useDemoReset();

  const login = useMutation({
    mutationFn: (body: { phone: string; pin: string }) => api.post('/api/auth/login', body),
    onSuccess: async () => {
      qc.clear();
      await qc.fetchQuery({ queryKey: ['me'], queryFn: () => api.get('/api/me') });
      navigate(safeNext(params.get('next')), { replace: true });
    },
  });

  if (me.isLoading || config.isLoading) return <PageLoader />;
  if (me.data) return <Navigate to={safeNext(params.get('next'))} replace />;

  const demo = config.data?.demo;
  const formOpen = !demo || showForm;

  const form = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        login.mutate({ phone, pin });
      }}
    >
      <Stack gap="sm">
        <TextInput
          label="رقم الهاتف"
          placeholder="09xxxxxxxx"
          inputMode="tel"
          autoComplete="username"
          dir="ltr"
          value={phone}
          onChange={(e) => setPhone(e.currentTarget.value)}
          required
        />
        <PasswordInput
          label="الرقم السري"
          placeholder="••••"
          inputMode="numeric"
          autoComplete="current-password"
          dir="ltr"
          value={pin}
          onChange={(e) => setPin(e.currentTarget.value)}
          required
        />
        {login.error && (
          <Alert color="red" variant="light">
            {errorMessage(login.error)}
          </Alert>
        )}
        <Button type="submit" size="md" loading={login.isPending}>
          دخول
        </Button>
        <Text ta="center" size="sm">
          أول مرة؟{' '}
          <Anchor component={Link} to="/activate">
            أدخل رمز التفعيل من المدرسة
          </Anchor>
        </Text>
      </Stack>
    </form>
  );

  return (
    <div className="mobile-frame">
      <Stack p="lg" pt={36} gap="lg">
        <Brand />

        {demo && (
          <Card withBorder radius="lg" padding="md" bg="yellow.0">
            <Stack gap="sm">
              <Group gap="xs" justify="space-between">
                <Group gap={6}>
                  <IconFlask size={18} />
                  <Text fw={700}>نسخة تجريبية مليئة بالبيانات</Text>
                </Group>
                <Badge variant="light" color="yellow">
                  بدون كلمات مرور
                </Badge>
              </Group>
              <Text size="sm" c="dimmed">
                اختر دوراً للدخول مباشرة:
              </Text>
              <SimpleGrid cols={2} spacing="sm">
                {DEMO_ROLES.map((r) => {
                  const account = demo.accounts.find((a) => a.role === r.role);
                  return (
                    <UnstyledButton
                      key={r.role}
                      onClick={() => demoLogin.mutate(r.role)}
                      disabled={demoLogin.isPending}
                      aria-label={`الدخول كـ ${r.label}`}
                    >
                      <Paper withBorder radius="md" p="sm" h="100%" bg="white">
                        <Stack gap={4} align="center" ta="center">
                          <ThemeIcon size={44} radius="xl" variant="light">
                            <r.icon size={24} />
                          </ThemeIcon>
                          <Text fw={700}>{r.label}</Text>
                          <Text size="xs" c="dimmed" lh={1.3}>
                            {account?.fullName}
                          </Text>
                          <Text size="10px" c="dimmed" lh={1.3}>
                            {r.hint}
                          </Text>
                        </Stack>
                      </Paper>
                    </UnstyledButton>
                  );
                })}
              </SimpleGrid>
              {demoLogin.isPending && (
                <Text size="sm" ta="center" c="dimmed">
                  جاري الدخول…
                </Text>
              )}
              {demoLogin.error && (
                <Alert color="red" variant="light">
                  {errorMessage(demoLogin.error)}
                </Alert>
              )}
              <Text size="xs" c="dimmed">
                داخل التطبيق اضغط الزر الأصفر <IconFlask size={12} /> لتبديل الدور في أي وقت. لتجربة التفعيل لأول مرة
                استخدم الرمز{' '}
                <Text span fw={700} dir="ltr">
                  {demo.activation.code}
                </Text>
                ، ولإضافة طالب (+) كولي أمر استخدم{' '}
                <Text span fw={700} dir="ltr">
                  {demo.linkCode}
                </Text>
                .
              </Text>
              <Button
                variant="subtle"
                color="gray"
                size="xs"
                leftSection={<IconRefresh size={14} />}
                loading={reset.isPending}
                onClick={() => reset.mutate()}
              >
                إعادة تعيين البيانات التجريبية
              </Button>
            </Stack>
          </Card>
        )}

        {demo && (
          <Divider
            label={
              <Anchor component="button" type="button" size="sm" onClick={() => setShowForm((v) => !v)}>
                {showForm ? 'إخفاء' : 'أو الدخول برقم الهاتف والرقم السري'}
              </Anchor>
            }
          />
        )}
        <Collapse in={formOpen}>{form}</Collapse>
      </Stack>
    </div>
  );
}

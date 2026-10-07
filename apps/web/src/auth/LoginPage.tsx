import { useState } from 'react';
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  PasswordInput,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { IconFlask, IconRefresh } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { api } from '../api/client';
import { useMe, usePublicConfig } from '../api/hooks';
import { PageLoader } from '../components/States';
import { errorMessage, notifySuccess } from '../lib/notify';
import { Brand } from './Brand';

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

  const login = useMutation({
    mutationFn: (body: { phone: string; pin: string }) => api.post('/api/auth/login', body),
    onSuccess: async () => {
      qc.clear();
      await qc.fetchQuery({ queryKey: ['me'], queryFn: () => api.get('/api/me') });
      navigate(safeNext(params.get('next')), { replace: true });
    },
  });
  const reset = useMutation({
    mutationFn: () => api.post('/api/public/demo/reset'),
    onSuccess: () => notifySuccess('تمت إعادة تعيين البيانات التجريبية'),
  });

  if (me.isLoading) return <PageLoader />;
  if (me.data) return <Navigate to={safeNext(params.get('next'))} replace />;

  const demo = config.data?.demo;

  return (
    <div className="mobile-frame">
      <Stack p="lg" pt={48} gap="lg">
        <Brand />
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
          </Stack>
        </form>
        <Text ta="center" size="sm">
          أول مرة؟{' '}
          <Anchor component={Link} to="/activate">
            أدخل رمز التفعيل من المدرسة
          </Anchor>
        </Text>

        {demo && (
          <Card withBorder radius="lg" padding="md" bg="yellow.0">
            <Stack gap="xs">
              <Group gap="xs">
                <IconFlask size={18} />
                <Text fw={700}>نسخة تجريبية</Text>
                <Badge variant="light" color="yellow">
                  الرقم السري للجميع: {demo.pin}
                </Badge>
              </Group>
              <Text size="xs" c="dimmed">
                ادخل مباشرةً بأي دور لتجربة التطبيق:
              </Text>
              {demo.accounts.map((a) => (
                <Button
                  key={a.phone}
                  variant="white"
                  justify="space-between"
                  rightSection={
                    <Text size="xs" c="dimmed" dir="ltr">
                      {a.phone}
                    </Text>
                  }
                  loading={login.isPending && login.variables?.phone === a.phone}
                  onClick={() => login.mutate({ phone: a.phone, pin: demo.pin })}
                >
                  {a.label} — {a.fullName}
                </Button>
              ))}
              <Divider my={4} />
              <Text size="xs">
                لتجربة التفعيل لأول مرة استخدم الرمز{' '}
                <Text span fw={700} dir="ltr">
                  {demo.activation.code}
                </Text>
                ، ولإضافة طالب (+) بعد الدخول كولي أمر استخدم{' '}
                <Text span fw={700} dir="ltr">
                  {demo.linkCode}
                </Text>
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
      </Stack>
    </div>
  );
}

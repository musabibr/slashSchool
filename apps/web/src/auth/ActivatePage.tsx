import { useState } from 'react';
import { Alert, Anchor, Button, Paper, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { api } from '../api/client';
import { errorMessage } from '../lib/notify';
import { Brand } from './Brand';

interface Preview {
  fullName: string;
  phone: string;
  alreadyActive: boolean;
}

/** P1 for first-time users: code from the school → confirm identity → choose a PIN. */
export function ActivatePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);

  const check = useMutation({
    mutationFn: () => api.post<Preview>('/api/auth/activate', { code }),
    onSuccess: setPreview,
  });
  const setPinMutation = useMutation({
    mutationFn: () => api.post('/api/auth/set-pin', { code, pin }),
    onSuccess: async () => {
      qc.clear();
      navigate('/select', { replace: true });
    },
  });
  const mismatch = pin2.length > 0 && pin !== pin2;

  return (
    <div className="mobile-frame">
      <Stack p="lg" pt={48} gap="lg">
        <Brand />
        {!preview ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              check.mutate();
            }}
          >
            <Stack gap="sm">
              <TextInput
                label="أدخل الرمز"
                description="الرمز الذي أرسلته لك المدرسة (واتساب أو ورقة)"
                placeholder="K7QF-M2XD-9P"
                dir="ltr"
                size="md"
                value={code}
                onChange={(e) => setCode(e.currentTarget.value)}
                required
                autoFocus
              />
              {check.error && (
                <Alert color="red" variant="light">
                  {errorMessage(check.error)}
                </Alert>
              )}
              <Button type="submit" size="md" loading={check.isPending}>
                متابعة
              </Button>
            </Stack>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!mismatch) setPinMutation.mutate();
            }}
          >
            <Stack gap="sm">
              <Paper withBorder p="md" radius="md">
                <Text size="sm" c="dimmed">
                  مرحباً
                </Text>
                <Text fw={700} size="lg">
                  {preview.fullName}
                </Text>
                <Text size="sm" c="dimmed" dir="ltr" ta="right">
                  {preview.phone}
                </Text>
              </Paper>
              <Text size="sm">
                {preview.alreadyActive
                  ? 'اختر رقماً سرياً جديداً لحسابك.'
                  : 'اختر رقماً سرياً من 4 إلى 6 أرقام لتسجيل الدخول لاحقاً.'}
              </Text>
              <PasswordInput
                label="الرقم السري"
                inputMode="numeric"
                dir="ltr"
                value={pin}
                onChange={(e) => setPin(e.currentTarget.value.replace(/\D/g, '').slice(0, 6))}
                required
                autoFocus
              />
              <PasswordInput
                label="تأكيد الرقم السري"
                inputMode="numeric"
                dir="ltr"
                value={pin2}
                onChange={(e) => setPin2(e.currentTarget.value.replace(/\D/g, '').slice(0, 6))}
                error={mismatch ? 'الرقمان غير متطابقين' : undefined}
                required
              />
              {setPinMutation.error && (
                <Alert color="red" variant="light">
                  {errorMessage(setPinMutation.error)}
                </Alert>
              )}
              <Button type="submit" size="md" loading={setPinMutation.isPending} disabled={pin.length < 4 || mismatch}>
                تفعيل الحساب
              </Button>
            </Stack>
          </form>
        )}
        <Text ta="center" size="sm">
          <Anchor component={Link} to="/login">
            لديك حساب مفعّل؟ تسجيل الدخول
          </Anchor>
        </Text>
      </Stack>
    </div>
  );
}

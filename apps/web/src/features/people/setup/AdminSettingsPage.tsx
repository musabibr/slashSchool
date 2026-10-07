import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Grid,
  Group,
  NumberInput,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { randomId } from '@mantine/hooks';
import { IconAlertTriangle, IconPlus, IconRestore, IconTrash } from '@tabler/icons-react';
import { DEFAULT_GRADE_BANDS, isValidPhone, normalizePhone, WEEKDAY_LABELS, type GradeBand } from '@slash/shared';
import { ApiError } from '../../../api/client';
import { AdminPage } from '../../../components/AdminPage';
import { QueryState } from '../../../components/States';
import { notifyError, notifySuccess } from '../../../lib/notify';
import { useSchoolId } from '../../../lib/params';
import { useSaveSettings, useSettings, type SchoolSettings, type SettingsPatch } from './api';

const MAX_BANDS = 10;

interface BandRow {
  key: string;
  min: number | string;
  label: string;
}

interface SettingsValues {
  name: string;
  phone: string;
  address: string;
  weekStart: string;
  gradeBands: BandRow[];
}

const toRows = (bands: GradeBand[]): BandRow[] =>
  [...bands].sort((a, b) => b.min - a.min).map((b) => ({ key: randomId(), min: b.min, label: b.label }));

const toValues = (s: SchoolSettings): SettingsValues => ({
  name: s.name,
  phone: s.phone ?? '',
  address: s.address ?? '',
  weekStart: String(s.weekStart),
  gradeBands: toRows(s.gradeBands),
});

const toBands = (rows: BandRow[]): GradeBand[] =>
  rows.map((r) => ({ min: typeof r.min === 'number' ? r.min : Number(r.min), label: r.label.trim() }));

const sameBands = (a: GradeBand[], b: GradeBand[]) =>
  JSON.stringify([...a].sort((x, y) => y.min - x.min)) === JSON.stringify([...b].sort((x, y) => y.min - x.min));

/** Same rules as the API: 1–10 bands, min 0–100, unique mins, one band starting at 0. */
function validate(values: SettingsValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!values.name.trim()) errors.name = 'اسم المدرسة مطلوب';
  if (values.phone.trim() && !isValidPhone(values.phone)) errors.phone = 'رقم الهاتف غير صالح';
  const bands = values.gradeBands;
  if (!bands.length) errors.gradeBands = 'أضف تقديراً واحداً على الأقل';
  const seen = new Set<number>();
  bands.forEach((b, i) => {
    if (!b.label.trim()) errors[`gradeBands.${i}.label`] = 'التقدير مطلوب';
    if (b.min === '' || typeof b.min !== 'number' || Number.isNaN(b.min)) {
      errors[`gradeBands.${i}.min`] = 'الحد الأدنى مطلوب';
      return;
    }
    if (b.min < 0 || b.min > 100) errors[`gradeBands.${i}.min`] = 'بين 0 و 100';
    else if (seen.has(b.min)) errors[`gradeBands.${i}.min`] = 'مكرر';
    seen.add(b.min);
  });
  if (bands.length && !seen.has(0)) errors.gradeBands = 'يجب أن يبدأ أحد التقديرات من 0';
  return errors;
}

function SettingsForm({ schoolId, settings }: { schoolId: string; settings: SchoolSettings }) {
  const save = useSaveSettings(schoolId);
  const form = useForm<SettingsValues>({ initialValues: toValues(settings), validate });
  const bands = form.values.gradeBands;
  const preview = toBands(bands)
    .filter((b, i) => !form.errors[`gradeBands.${i}.min`] && b.label && Number.isFinite(b.min))
    .sort((a, b) => b.min - a.min);

  const submit = form.onSubmit((v) => {
    const patch: SettingsPatch = {};
    if (v.name.trim() !== settings.name) patch.name = v.name.trim();
    const phone = v.phone.trim() ? normalizePhone(v.phone) : null;
    if (phone !== settings.phone) patch.phone = phone;
    const address = v.address.trim() || null;
    if (address !== settings.address) patch.address = address;
    if (Number(v.weekStart) !== settings.weekStart) patch.weekStart = Number(v.weekStart);
    const nextBands = toBands(v.gradeBands);
    if (!sameBands(nextBands, settings.gradeBands)) patch.gradeBands = nextBands;
    if (!Object.keys(patch).length) {
      notifySuccess('لا توجد تغييرات للحفظ');
      return;
    }
    save.mutate(patch, {
      onSuccess: (saved) => {
        notifySuccess('تم حفظ الإعدادات');
        const next = toValues(saved);
        form.setInitialValues(next);
        form.setValues(next);
        form.resetDirty(next);
      },
      onError: (err) => {
        if (err instanceof ApiError && err.details?.length) {
          form.setErrors(Object.fromEntries(err.details.map((d) => [d.path || 'gradeBands', d.message])));
        }
        notifyError(err);
      },
    });
  });

  return (
    <form onSubmit={submit}>
      <Grid gutter="md" align="flex-start">
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Paper withBorder radius="md" p="md">
            <Title order={4} mb="sm">
              بيانات المدرسة
            </Title>
            <Stack gap="sm">
              <TextInput label="اسم المدرسة" withAsterisk maxLength={120} {...form.getInputProps('name')} />
              <TextInput
                label="رمز المدرسة"
                description="يظهر في شاشة الدخول ولا يمكن تغييره"
                value={settings.code}
                readOnly
                dir="ltr"
                variant="filled"
              />
              <TextInput
                label="رقم الهاتف"
                placeholder="0183xxxxxx"
                inputMode="tel"
                dir="ltr"
                {...form.getInputProps('phone')}
              />
              <TextInput
                label="العنوان"
                placeholder="مثال: كرري، أم درمان"
                maxLength={300}
                {...form.getInputProps('address')}
              />
              <Select
                label="بداية الأسبوع الدراسي"
                description="تُحسب فلاتر «هذا الأسبوع» من هذا اليوم"
                data={WEEKDAY_LABELS.map((label, i) => ({ value: String(i), label }))}
                allowDeselect={false}
                {...form.getInputProps('weekStart')}
              />
              <TextInput label="المنطقة الزمنية" value={settings.timezone} readOnly dir="ltr" variant="filled" />
            </Stack>
          </Paper>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 6 }}>
          <Paper withBorder radius="md" p="md">
            <Group justify="space-between" mb={4}>
              <Title order={4}>التقديرات</Title>
              <Button
                size="compact-sm"
                variant="subtle"
                leftSection={<IconRestore size={14} />}
                onClick={() => form.setFieldValue('gradeBands', toRows(DEFAULT_GRADE_BANDS))}
              >
                استعادة الافتراضي
              </Button>
            </Group>
            <Text size="sm" c="dimmed" mb="sm">
              يُحسب تقدير الطالب في النتائج من النسبة المئوية: يأخذ أعلى تقدير يكون حده الأدنى أقل من النسبة أو يساويها.
            </Text>
            <Stack gap="xs">
              <Group gap="xs" wrap="nowrap">
                <Text size="xs" c="dimmed" w={110}>
                  من (%)
                </Text>
                <Text size="xs" c="dimmed" style={{ flex: 1 }}>
                  التقدير
                </Text>
              </Group>
              {bands.map((band, i) => (
                <Group key={band.key} gap="xs" wrap="nowrap" align="flex-start">
                  <NumberInput
                    w={110}
                    aria-label="الحد الأدنى"
                    min={0}
                    max={100}
                    decimalScale={1}
                    allowNegative={false}
                    suffix="%"
                    {...form.getInputProps(`gradeBands.${i}.min`)}
                  />
                  <TextInput
                    style={{ flex: 1 }}
                    aria-label="التقدير"
                    placeholder="مثال: ممتاز"
                    maxLength={30}
                    {...form.getInputProps(`gradeBands.${i}.label`)}
                  />
                  <Tooltip label="حذف" withArrow>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      mt={6}
                      aria-label="حذف التقدير"
                      disabled={bands.length <= 1}
                      onClick={() => form.removeListItem('gradeBands', i)}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              ))}
              {typeof form.errors.gradeBands === 'string' && (
                <Alert color="red" variant="light" icon={<IconAlertTriangle />} py="xs">
                  {form.errors.gradeBands}
                </Alert>
              )}
              <Group justify="space-between">
                <Button
                  size="xs"
                  variant="light"
                  leftSection={<IconPlus size={14} />}
                  disabled={bands.length >= MAX_BANDS}
                  onClick={() => form.insertListItem('gradeBands', { key: randomId(), min: '', label: '' })}
                >
                  إضافة تقدير
                </Button>
                <Text size="xs" c="dimmed">
                  {bands.length} / {MAX_BANDS}
                </Text>
              </Group>
              {preview.length > 0 && (
                <Group gap={6} mt="xs">
                  {preview.map((b) => (
                    <Badge key={`${b.min}:${b.label}`} variant="light" radius="sm" tt="none">
                      {b.label}: {b.min}% فأكثر
                    </Badge>
                  ))}
                </Group>
              )}
            </Stack>
          </Paper>
        </Grid.Col>
      </Grid>
      <Group justify="flex-end" mt="md">
        <Button variant="default" disabled={!form.isDirty() || save.isPending} onClick={() => form.reset()}>
          تراجع
        </Button>
        <Button type="submit" loading={save.isPending}>
          حفظ التغييرات
        </Button>
      </Group>
    </form>
  );
}

/** Director's "الإعدادات": school info, week start and grade bands. */
export function AdminSettingsPage() {
  const schoolId = useSchoolId();
  const q = useSettings(schoolId);
  return (
    <AdminPage title="الإعدادات">
      <QueryState query={q}>{(settings) => <SettingsForm key={schoolId} schoolId={schoolId} settings={settings} />}</QueryState>
    </AdminPage>
  );
}

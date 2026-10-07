import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Modal,
  NumberInput,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { randomId } from '@mantine/hooks';
import { IconInfoCircle, IconPlus, IconTrash } from '@tabler/icons-react';
import { ApiError } from '../../api/client';
import { IsoDateInput } from '../../components/IsoDateInput';
import { dayjs } from '../../lib/dayjs';
import { notifyError, notifySuccess } from '../../lib/notify';
import { useSavePlan, type FeePlan } from './api';
import { useGradeOptions, type GradeOption } from './components';
import { installmentLabel, money } from './labels';

/** Same limit as the server. */
export const MAX_INSTALLMENTS = 12;

interface InstallmentRow {
  key: string;
  amount: number | '';
  dueDate: string | null;
}

interface FormValues {
  name: string;
  gradeLevelId: string | null;
  installments: InstallmentRow[];
}

const addMonths = (iso: string, months: number) => dayjs(iso).add(months, 'month').format('YYYY-MM-DD');

/** A new plan starts with three installments, three months apart, from today. */
function defaultRows(today: string | null): InstallmentRow[] {
  return [0, 3, 6].map((m) => ({ key: randomId(), amount: '', dueDate: today ? addMonths(today, m) : null }));
}

const autoName = (gradeLevelId: string | null, grades: GradeOption[]) => {
  const grade = grades.find((g) => g.value === gradeLevelId);
  return grade ? `رسوم ${grade.label}` : '';
};

function PlanForm({ schoolId, plan, onDone }: { schoolId: string; plan: FeePlan | null; onDone: () => void }) {
  const { options: grades, today } = useGradeOptions(schoolId);
  const save = useSavePlan(schoolId);
  // A plan of a grade that is no longer offered keeps its grade in the picker.
  const gradeData =
    plan?.gradeLevelId && !grades.some((g) => g.value === plan.gradeLevelId)
      ? [...grades, { value: plan.gradeLevelId, label: plan.gradeLevelName ?? '' }]
      : grades;

  const form = useForm<FormValues>({
    initialValues: plan
      ? {
          name: plan.name,
          gradeLevelId: plan.gradeLevelId,
          installments: plan.installments.map((i) => ({ key: i.id, amount: i.amount, dueDate: i.dueDate })),
        }
      : { name: '', gradeLevelId: null, installments: defaultRows(today) },
    validate: {
      name: (v) => (v.trim() ? null : 'اسم الخطة مطلوب'),
      installments: {
        amount: (v) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? null : 'أدخل مبلغ القسط'),
        dueDate: (v, values, path) => {
          if (!v) return 'اختر تاريخ الاستحقاق';
          const index = Number(path.split('.')[1]);
          const previous = values.installments[index - 1]?.dueDate;
          return previous && v <= previous ? 'يجب أن يكون بعد تاريخ القسط السابق' : null;
        },
      },
    },
  });

  const rows = form.values.installments;
  const total = rows.reduce((sum, r) => sum + (typeof r.amount === 'number' ? r.amount : 0), 0);

  const addRow = () => {
    const last = rows[rows.length - 1];
    form.insertListItem('installments', {
      key: randomId(),
      amount: last?.amount ?? '',
      dueDate: last?.dueDate ? addMonths(last.dueDate, 1) : today,
    });
  };

  const onGradeChange = (value: string | null) => {
    const current = form.values.name.trim();
    if (!current || current === autoName(form.values.gradeLevelId, gradeData)) {
      form.setFieldValue('name', autoName(value, gradeData));
    }
    form.setFieldValue('gradeLevelId', value);
  };

  const submit = form.onSubmit((v) =>
    save.mutate(
      {
        id: plan?.id,
        input: {
          name: v.name.trim(),
          gradeLevelId: v.gradeLevelId,
          installments: v.installments.map((r) => ({ amount: Number(r.amount), dueDate: r.dueDate ?? '' })),
        },
      },
      {
        onSuccess: () => {
          notifySuccess(plan ? 'تم تعديل خطة الرسوم' : 'تمت إضافة خطة الرسوم');
          onDone();
        },
        onError: (err) => {
          if (err instanceof ApiError) for (const d of err.details ?? []) form.setFieldError(d.path, d.message);
          notifyError(err);
        },
      },
    ),
  );

  return (
    <form onSubmit={submit} noValidate>
      <Stack gap="sm">
        <Select
          label="الصف"
          placeholder="جميع الصفوف"
          description="اتركه فارغاً إذا كانت الخطة لكل الصفوف"
          data={gradeData}
          value={form.values.gradeLevelId}
          onChange={onGradeChange}
          clearable
          comboboxProps={{ withinPortal: true }}
        />
        <TextInput label="اسم الخطة" placeholder="مثال: رسوم الصف الخامس" required {...form.getInputProps('name')} />

        {plan?.hasPayments && (
          <Alert color="yellow" variant="light" icon={<IconInfoCircle />}>
            توجد دفعات مسجلة على هذه الخطة؛ تعديل الأقساط يعيد حساب أرصدة الطلاب ومتأخراتهم.
          </Alert>
        )}

        <Stack gap="xs">
          <Text fw={600} size="sm">
            الأقساط
          </Text>
          {rows.map((row, i) => (
            <Paper key={row.key} withBorder radius="md" p="xs">
              <Group gap="xs" align="flex-start" wrap="nowrap">
                <Text fw={600} size="sm" w={110} pt={8} style={{ flexShrink: 0 }}>
                  {installmentLabel(i + 1)}
                </Text>
                <NumberInput
                  aria-label={`مبلغ ${installmentLabel(i + 1)}`}
                  placeholder="المبلغ"
                  thousandSeparator=","
                  allowDecimal={false}
                  allowNegative={false}
                  hideControls
                  min={1}
                  style={{ flex: 1 }}
                  {...form.getInputProps(`installments.${i}.amount`)}
                />
                <IsoDateInput
                  aria-label={`تاريخ استحقاق ${installmentLabel(i + 1)}`}
                  placeholder="تاريخ الاستحقاق"
                  style={{ flex: 1 }}
                  value={row.dueDate}
                  onChange={(v) => form.setFieldValue(`installments.${i}.dueDate`, v)}
                  error={form.errors[`installments.${i}.dueDate`]}
                />
                <ActionIcon
                  variant="subtle"
                  color="red"
                  mt={4}
                  aria-label="حذف القسط"
                  disabled={rows.length === 1}
                  onClick={() => form.removeListItem('installments', i)}
                >
                  <IconTrash size={18} />
                </ActionIcon>
              </Group>
            </Paper>
          ))}
          {typeof form.errors.installments === 'string' && (
            <Text c="red" size="sm">
              {form.errors.installments}
            </Text>
          )}
          <Group justify="space-between">
            <Button
              variant="light"
              size="xs"
              leftSection={<IconPlus size={16} />}
              onClick={addRow}
              disabled={rows.length >= MAX_INSTALLMENTS}
            >
              إضافة قسط
            </Button>
            <Text fw={700}>الإجمالي: {money(total)}</Text>
          </Group>
        </Stack>

        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onDone}>
            إلغاء
          </Button>
          <Button type="submit" loading={save.isPending}>
            حفظ
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

/** Create (plan = null) or edit a fee plan: name, grade level and 1–12 installments with a running total. */
export function PlanFormModal({
  schoolId,
  plan,
  opened,
  onClose,
}: {
  schoolId: string;
  plan: FeePlan | null;
  opened: boolean;
  onClose: () => void;
}) {
  return (
    <Modal opened={opened} onClose={onClose} title={plan ? 'تعديل خطة الرسوم' : 'خطة رسوم جديدة'} size="lg" centered>
      {opened && <PlanForm key={plan?.id ?? 'new'} schoolId={schoolId} plan={plan} onDone={onClose} />}
    </Modal>
  );
}

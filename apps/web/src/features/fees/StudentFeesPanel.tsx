import { useState } from 'react';
import {
  ActionIcon,
  Alert,
  Button,
  CopyButton,
  Group,
  Modal,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconBrandWhatsapp, IconCash, IconCopy, IconPencil, IconPlus, IconSend, IconTrash } from '@tabler/icons-react';
import {
  formatDate,
  formatMoney,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type FeeAccount,
  type PaymentMethod,
} from '@slash/shared';
import { ApiError } from '../../api/client';
import { IsoDateInput } from '../../components/IsoDateInput';
import { EmptyState, QueryState } from '../../components/States';
import { notifyError, notifySuccess } from '../../lib/notify';
import {
  useAssignPlan,
  useDeletePayment,
  useFeePlans,
  useRecordPayment,
  useRemoveStudentFee,
  useSendFeeNotice,
  useStudentFees,
  useUpdateDiscount,
  type FeeNotice,
  type StaffPayment,
  type StudentFeeAccount,
  type StudentFees,
} from './api';
import { MoneyCard, StatusBadge } from './components';
import { installmentLabel, money } from './labels';

/** What the admin most likely collects now: the overdue amount, else the next installment's balance. */
function suggestedAmount(account: FeeAccount): number | '' {
  if (account.overdue > 0) return account.overdue;
  const next = account.installments.find((i) => i.remaining > 0);
  const amount = next?.remaining ?? account.remaining;
  return amount > 0 ? amount : '';
}

/** Small confirm dialog for destructive actions. */
function ConfirmModal({
  opened,
  title,
  message,
  loading,
  onConfirm,
  onClose,
}: {
  opened: boolean;
  title: string;
  message: string;
  loading: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal opened={opened} onClose={onClose} title={title} centered>
      <Text size="sm">{message}</Text>
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={onClose}>
          إلغاء
        </Button>
        <Button color="red" loading={loading} onClick={onConfirm}>
          حذف
        </Button>
      </Group>
    </Modal>
  );
}

// ───────────────────────────── Assign a plan ─────────────────────────────

function AssignPlanForm({
  schoolId,
  student,
  assignedPlanIds,
  onDone,
}: {
  schoolId: string;
  student: StudentFees['student'];
  assignedPlanIds: string[];
  onDone?: () => void;
}) {
  const plans = useFeePlans(schoolId);
  const assign = useAssignPlan(schoolId);
  const available = (plans.data ?? []).filter((p) => !assignedPlanIds.includes(p.id));
  const suggested =
    available.find((p) => p.gradeLevelId && p.gradeLevelId === student.gradeLevelId) ??
    available.find((p) => !p.gradeLevelId) ??
    available[0];
  const [picked, setPicked] = useState<string | null>(null);
  const planId = picked ?? suggested?.id ?? null;
  const plan = available.find((p) => p.id === planId);
  const [discount, setDiscount] = useState<number | ''>(0);
  const tooMuch = !!plan && typeof discount === 'number' && discount > plan.total;

  if (plans.isLoading) return null;
  if (!available.length) {
    return (
      <Text size="sm" c="dimmed">
        لا توجد خطط رسوم متاحة. أنشئ خطة من صفحة «الرسوم الدراسية» أولاً.
      </Text>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!planId || tooMuch) return;
        assign.mutate(
          { planId, studentIds: [student.id], discount: typeof discount === 'number' ? discount : 0 },
          {
            onSuccess: () => {
              notifySuccess('تم تسجيل الطالب في خطة الرسوم');
              onDone?.();
            },
            onError: notifyError,
          },
        );
      }}
    >
      <Group align="flex-end" gap="sm">
        <Select
          label="خطة الرسوم"
          data={available.map((p) => ({
            value: p.id,
            label: `${p.name} — ${money(p.total)}${p.gradeLevelName ? '' : ' (جميع الصفوف)'}`,
          }))}
          value={planId}
          onChange={setPicked}
          allowDeselect={false}
          w={320}
          comboboxProps={{ withinPortal: true }}
        />
        <NumberInput
          label="الخصم"
          thousandSeparator=","
          allowDecimal={false}
          allowNegative={false}
          hideControls
          w={140}
          value={discount}
          onChange={(v) => setDiscount(typeof v === 'number' ? v : '')}
          error={tooMuch ? 'أكبر من الإجمالي' : undefined}
        />
        <Button type="submit" loading={assign.isPending} disabled={!planId || tooMuch}>
          تطبيق الخطة
        </Button>
      </Group>
    </form>
  );
}

// ───────────────────────────── Record a payment ─────────────────────────────

interface PaymentValues {
  studentFeeId: string;
  amount: number | '';
  paidAt: string | null;
  method: PaymentMethod;
  receiptNo: string;
  note: string;
}

function PaymentForm({
  schoolId,
  accounts,
  today,
  onDone,
}: {
  schoolId: string;
  accounts: StudentFeeAccount[];
  today: string;
  onDone: () => void;
}) {
  const record = useRecordPayment(schoolId);
  const first = accounts.find((a) => a.account.remaining > 0) ?? accounts[0];
  const form = useForm<PaymentValues>({
    initialValues: {
      studentFeeId: first.studentFeeId,
      amount: suggestedAmount(first.account),
      paidAt: today,
      method: 'cash',
      receiptNo: '',
      note: '',
    },
    validate: {
      amount: (v) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? null : 'أدخل المبلغ المدفوع'),
      paidAt: (v) => (!v ? 'اختر تاريخ الدفع' : v > today ? 'تاريخ الدفع لا يمكن أن يكون بعد اليوم' : null),
    },
  });
  const selected = accounts.find((a) => a.studentFeeId === form.values.studentFeeId) ?? first;
  const extra =
    typeof form.values.amount === 'number' && form.values.amount > selected.account.remaining
      ? form.values.amount - selected.account.remaining
      : 0;

  const submit = form.onSubmit((v) =>
    record.mutate(
      {
        studentFeeId: v.studentFeeId,
        input: {
          amount: Number(v.amount),
          paidAt: v.paidAt ?? '',
          method: v.method,
          receiptNo: v.receiptNo.trim() || null,
          note: v.note.trim() || null,
        },
      },
      {
        onSuccess: () => {
          notifySuccess('تم تسجيل الدفعة');
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
        {accounts.length > 1 && (
          <Select
            label="خطة الرسوم"
            data={accounts.map((a) => ({ value: a.studentFeeId, label: a.planName }))}
            value={form.values.studentFeeId}
            onChange={(v) => {
              if (!v) return;
              const next = accounts.find((a) => a.studentFeeId === v);
              form.setFieldValue('studentFeeId', v);
              if (next) form.setFieldValue('amount', suggestedAmount(next.account));
            }}
            allowDeselect={false}
            comboboxProps={{ withinPortal: true }}
          />
        )}
        <Text size="sm" c="dimmed">
          المتبقي: {money(selected.account.remaining)}
          {selected.account.overdue > 0 && ` — المتأخرات: ${money(selected.account.overdue)}`}
        </Text>
        <NumberInput
          label="المبلغ"
          required
          thousandSeparator=","
          allowDecimal={false}
          allowNegative={false}
          hideControls
          data-autofocus
          {...form.getInputProps('amount')}
        />
        {extra > 0 && (
          <Alert color="yellow" variant="light" p="xs">
            المبلغ أكبر من المتبقي؛ سيُسجَّل {money(extra)} رصيداً زائداً.
          </Alert>
        )}
        <IsoDateInput
          label="تاريخ الدفع"
          required
          maxDate={today}
          value={form.values.paidAt}
          onChange={(v) => form.setFieldValue('paidAt', v)}
          error={form.errors.paidAt}
        />
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            طريقة الدفع
          </Text>
          <SegmentedControl
            fullWidth
            data={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))}
            value={form.values.method}
            onChange={(v) => form.setFieldValue('method', v as PaymentMethod)}
          />
        </Stack>
        <TextInput label="رقم الإيصال" placeholder="اختياري" {...form.getInputProps('receiptNo')} />
        <Textarea label="ملاحظة" placeholder="اختياري" autosize minRows={2} {...form.getInputProps('note')} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onDone}>
            إلغاء
          </Button>
          <Button type="submit" loading={record.isPending}>
            تسجيل الدفعة
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

// ───────────────────────────── Discount ─────────────────────────────

function DiscountForm({
  schoolId,
  account,
  onDone,
}: {
  schoolId: string;
  account: StudentFeeAccount;
  onDone: () => void;
}) {
  const update = useUpdateDiscount(schoolId);
  const [discount, setDiscount] = useState<number | ''>(account.discount);
  const value = typeof discount === 'number' ? discount : 0;
  const tooMuch = value > account.account.total;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (tooMuch) return;
        update.mutate(
          { studentFeeId: account.studentFeeId, discount: value },
          {
            onSuccess: () => {
              notifySuccess('تم تعديل الخصم');
              onDone();
            },
            onError: notifyError,
          },
        );
      }}
    >
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          إجمالي «{account.planName}»: {money(account.account.total)}. يُخصم المبلغ من آخر الأقساط أولاً.
        </Text>
        <NumberInput
          label="الخصم"
          thousandSeparator=","
          allowDecimal={false}
          allowNegative={false}
          hideControls
          data-autofocus
          value={discount}
          onChange={(v) => setDiscount(typeof v === 'number' ? v : '')}
          error={tooMuch ? 'الخصم أكبر من إجمالي الرسوم' : undefined}
        />
        <Text size="sm">الصافي بعد الخصم: {money(Math.max(account.account.total - value, 0))}</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onDone}>
            إلغاء
          </Button>
          <Button type="submit" loading={update.isPending} disabled={tooMuch}>
            حفظ
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

// ───────────────────────────── Fee notice ─────────────────────────────

function NoticeResult({ notice }: { notice: FeeNotice }) {
  return (
    <Stack gap="sm">
      <Alert color="teal" variant="light">
        تم نشر الإشعار لولي الأمر في تطبيق المدرسة. يمكنك أيضاً إرساله عبر واتساب.
      </Alert>
      <Paper withBorder radius="md" p="sm" bg="gray.0">
        <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
          {notice.body}
        </Text>
      </Paper>
      <CopyButton value={notice.body}>
        {({ copied, copy }) => (
          <Button variant="default" size="xs" leftSection={<IconCopy size={14} />} onClick={copy} w="fit-content">
            {copied ? 'تم النسخ' : 'نسخ النص'}
          </Button>
        )}
      </CopyButton>
      {notice.contacts.length === 0 ? (
        <Text size="sm" c="dimmed">
          لا يوجد ولي أمر مسجل لهذا الطالب.
        </Text>
      ) : (
        notice.contacts.map((c) => (
          <Group key={`${c.phone}-${c.fullName}`} justify="space-between" wrap="nowrap">
            <Stack gap={0} style={{ minWidth: 0 }}>
              <Text fw={600} truncate>
                {c.fullName}
              </Text>
              <Text size="xs" c="dimmed" dir="ltr" ta="right">
                {c.phone}
              </Text>
            </Stack>
            <Button
              component="a"
              href={c.whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              color="green"
              leftSection={<IconBrandWhatsapp size={18} />}
            >
              إرسال عبر واتساب
            </Button>
          </Group>
        ))
      )}
    </Stack>
  );
}

// ───────────────────────────── Account view ─────────────────────────────

function AccountCard({
  account,
  hasPayments,
  onEditDiscount,
  onRemove,
}: {
  account: StudentFeeAccount;
  hasPayments: boolean;
  onEditDiscount: () => void;
  onRemove: () => void;
}) {
  const a = account.account;
  const discounted = a.discount > 0;
  return (
    <Paper withBorder radius="md" p="md">
      <Group justify="space-between" mb="xs" wrap="wrap">
        <Title order={5}>{account.planName}</Title>
        <Group gap={4} wrap="nowrap">
          <Text size="sm">الخصم: {money(a.discount)}</Text>
          <Tooltip label="تعديل الخصم">
            <ActionIcon variant="subtle" aria-label="تعديل الخصم" onClick={onEditDiscount}>
              <IconPencil size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={hasPayments ? 'لا يمكن الإلغاء لوجود دفعات' : 'إلغاء تسجيل الطالب في الخطة'}>
            <ActionIcon
              variant="subtle"
              color="red"
              aria-label="إلغاء تسجيل الطالب في الخطة"
              disabled={hasPayments}
              onClick={onRemove}
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      <Text size="sm" c="dimmed" mb="xs">
        الصافي {money(a.net)} · المدفوع {money(a.paid)} · المتبقي {money(a.remaining)}
        {a.overdue > 0 && ` · المتأخرات ${money(a.overdue)}`}
        {a.credit > 0 && ` · رصيد زائد ${money(a.credit)}`}
      </Text>
      <div className="table-scroll">
        <Table verticalSpacing="xs" miw={560}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>القسط</Table.Th>
              <Table.Th>المبلغ</Table.Th>
              {discounted && <Table.Th>بعد الخصم</Table.Th>}
              <Table.Th>المدفوع</Table.Th>
              <Table.Th>المتبقي</Table.Th>
              <Table.Th>تاريخ الاستحقاق</Table.Th>
              <Table.Th>حالة السداد</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {a.installments.map((i) => (
              <Table.Tr key={i.id}>
                <Table.Td fw={600}>{installmentLabel(i.seq)}</Table.Td>
                <Table.Td>{formatMoney(i.amount)}</Table.Td>
                {discounted && <Table.Td>{formatMoney(i.due)}</Table.Td>}
                <Table.Td>{formatMoney(i.paid)}</Table.Td>
                <Table.Td c={i.status === 'late' ? 'red.7' : undefined} fw={i.status === 'late' ? 700 : undefined}>
                  {formatMoney(i.remaining)}
                </Table.Td>
                <Table.Td>{formatDate(i.dueDate)}</Table.Td>
                <Table.Td>
                  <StatusBadge status={i.status} />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </div>
    </Paper>
  );
}

function PaymentsTable({
  payments,
  planNames,
  onDelete,
}: {
  payments: StaffPayment[];
  planNames: Map<string, string> | null;
  onDelete: (p: StaffPayment) => void;
}) {
  if (!payments.length) return <EmptyState message="لا توجد مدفوعات مسجلة بعد" />;
  return (
    <div className="table-scroll">
      <Table verticalSpacing="xs" highlightOnHover miw={640}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>التاريخ</Table.Th>
            <Table.Th>المبلغ</Table.Th>
            {planNames && <Table.Th>الخطة</Table.Th>}
            <Table.Th>طريقة الدفع</Table.Th>
            <Table.Th>رقم الإيصال</Table.Th>
            <Table.Th>ملاحظة</Table.Th>
            <Table.Th>سجّلها</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {payments.map((p) => (
            <Table.Tr key={p.id}>
              <Table.Td>{formatDate(p.paidAt)}</Table.Td>
              <Table.Td fw={700}>{formatMoney(p.amount)}</Table.Td>
              {planNames && <Table.Td>{planNames.get(p.studentFeeId) ?? ''}</Table.Td>}
              <Table.Td>{PAYMENT_METHOD_LABELS[p.method]}</Table.Td>
              <Table.Td>{p.receiptNo ?? '—'}</Table.Td>
              <Table.Td maw={200}>
                <Text size="sm" truncate>
                  {p.note ?? ''}
                </Text>
              </Table.Td>
              <Table.Td>{p.recordedByName ?? '—'}</Table.Td>
              <Table.Td>
                <Tooltip label="حذف الدفعة">
                  <ActionIcon variant="subtle" color="red" aria-label="حذف الدفعة" onClick={() => onDelete(p)}>
                    <IconTrash size={16} />
                  </ActionIcon>
                </Tooltip>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </div>
  );
}

function FeesAccounts({ schoolId, data }: { schoolId: string; data: StudentFees }) {
  const { totals, accounts } = data;
  const [paying, setPaying] = useState(false);
  const [adding, setAdding] = useState(false);
  const [discountFor, setDiscountFor] = useState<StudentFeeAccount | null>(null);
  const [removing, setRemoving] = useState<StudentFeeAccount | null>(null);
  const [deletingPayment, setDeletingPayment] = useState<StaffPayment | null>(null);
  const [notice, setNotice] = useState<FeeNotice | null>(null);
  const sendNotice = useSendFeeNotice(schoolId);
  const removeFee = useRemoveStudentFee(schoolId);
  const deletePayment = useDeletePayment(schoolId);
  const paidAccounts = new Set(data.payments.map((p) => p.studentFeeId));
  const planNames = accounts.length > 1 ? new Map(accounts.map((a) => [a.studentFeeId, a.planName])) : null;

  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 2, sm: 3, md: 5 }} spacing="sm">
        <MoneyCard label="الرسوم" amount={totals.total} />
        <MoneyCard label="الخصم" amount={totals.discount} />
        <MoneyCard label="المبلغ المدفوع" amount={totals.paid} color="teal.7" />
        <MoneyCard label="المبلغ المتبقي" amount={totals.remaining} color="orange.7" />
        <MoneyCard label="المتأخرات" amount={totals.overdue} color={totals.overdue > 0 ? 'red.7' : 'dark'} />
      </SimpleGrid>

      <Group gap="xs">
        <Button leftSection={<IconCash size={18} />} onClick={() => setPaying(true)}>
          تسجيل دفعة
        </Button>
        <Button
          variant="light"
          leftSection={<IconSend size={18} />}
          loading={sendNotice.isPending}
          onClick={() =>
            sendNotice.mutate(data.student.id, {
              onSuccess: (result) => setNotice(result),
              onError: notifyError,
            })
          }
        >
          إرسال إشعار الرسوم الدراسية
        </Button>
        <Button variant="subtle" leftSection={<IconPlus size={18} />} onClick={() => setAdding(true)}>
          إضافة خطة أخرى
        </Button>
      </Group>

      {accounts.map((account) => (
        <AccountCard
          key={account.studentFeeId}
          account={account}
          hasPayments={paidAccounts.has(account.studentFeeId)}
          onEditDiscount={() => setDiscountFor(account)}
          onRemove={() => setRemoving(account)}
        />
      ))}

      <Paper withBorder radius="md" p="md">
        <Title order={5} mb="xs">
          سجل المدفوعات
        </Title>
        <PaymentsTable payments={data.payments} planNames={planNames} onDelete={setDeletingPayment} />
      </Paper>

      <Modal opened={paying} onClose={() => setPaying(false)} title="تسجيل دفعة" centered>
        {paying && (
          <PaymentForm schoolId={schoolId} accounts={accounts} today={data.today} onDone={() => setPaying(false)} />
        )}
      </Modal>

      <Modal opened={adding} onClose={() => setAdding(false)} title="إضافة خطة رسوم" size="lg" centered>
        {adding && (
          <AssignPlanForm
            schoolId={schoolId}
            student={data.student}
            assignedPlanIds={accounts.map((a) => a.planId)}
            onDone={() => setAdding(false)}
          />
        )}
      </Modal>

      <Modal opened={!!discountFor} onClose={() => setDiscountFor(null)} title="تعديل الخصم" centered>
        {discountFor && (
          <DiscountForm
            key={discountFor.studentFeeId}
            schoolId={schoolId}
            account={discountFor}
            onDone={() => setDiscountFor(null)}
          />
        )}
      </Modal>

      <Modal opened={!!notice} onClose={() => setNotice(null)} title="إشعار الرسوم الدراسية" centered size="lg">
        {notice && <NoticeResult notice={notice} />}
      </Modal>

      <ConfirmModal
        opened={!!removing}
        title="إلغاء تسجيل الطالب في الخطة"
        message={removing ? `هل تريد إلغاء تسجيل الطالب في «${removing.planName}»؟` : ''}
        loading={removeFee.isPending}
        onClose={() => setRemoving(null)}
        onConfirm={() =>
          removing &&
          removeFee.mutate(removing.studentFeeId, {
            onSuccess: () => {
              notifySuccess('تم إلغاء تسجيل الطالب في الخطة');
              setRemoving(null);
            },
            onError: notifyError,
          })
        }
      />

      <ConfirmModal
        opened={!!deletingPayment}
        title="حذف الدفعة"
        message={
          deletingPayment
            ? `هل تريد حذف دفعة بمبلغ ${money(deletingPayment.amount)} بتاريخ ${formatDate(deletingPayment.paidAt)}؟`
            : ''
        }
        loading={deletePayment.isPending}
        onClose={() => setDeletingPayment(null)}
        onConfirm={() =>
          deletingPayment &&
          deletePayment.mutate(deletingPayment.id, {
            onSuccess: () => {
              notifySuccess('تم حذف الدفعة');
              setDeletingPayment(null);
            },
            onError: notifyError,
          })
        }
      />
    </Stack>
  );
}

/**
 * Fees panel of the director's student profile (D4): balances, installments and payments, with
 * "تسجيل دفعة", discount edits, plan assignment and "إرسال إشعار الرسوم الدراسية".
 */
export function StudentFeesPanel({ studentId, schoolId }: { studentId: string; schoolId: string }) {
  const q = useStudentFees(schoolId, studentId);
  return (
    <QueryState query={q}>
      {(data) =>
        data.accounts.length === 0 ? (
          <Paper withBorder radius="md" p="md">
            <Stack gap="sm">
              <Text c="dimmed" size="sm">
                لم تُسجل رسوم دراسية لهذا الطالب بعد. اختر خطة الرسوم المناسبة لتطبيقها عليه.
              </Text>
              <AssignPlanForm schoolId={schoolId} student={data.student} assignedPlanIds={[]} />
            </Stack>
          </Paper>
        ) : (
          <FeesAccounts schoolId={schoolId} data={data} />
        )
      }
    </QueryState>
  );
}

import type { ReactNode } from 'react';
import { Alert, Group, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconReceipt } from '@tabler/icons-react';
import { formatDate, formatMoney, PAYMENT_METHOD_LABELS } from '@slash/shared';
import { MobilePage } from '../../components/MobilePage';
import { EmptyState, QueryState } from '../../components/States';
import { useStudentId } from '../../lib/params';
import { useGuardianFees, type GuardianFees } from './api';
import { MoneyCard, StatusBadge } from './components';
import { installmentLabel, money } from './labels';

type Plan = GuardianFees['plans'][number];
type Installment = Plan['installments'][number];

/** "Label: value" line of an installment card. */
function Line({ label, children, color }: { label: string; children: ReactNode; color?: string }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="xs">
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text size="sm" fw={600} c={color}>
        {children}
      </Text>
    </Group>
  );
}

function InstallmentCard({ inst }: { inst: Installment }) {
  const late = inst.status === 'late';
  return (
    <Paper withBorder radius="md" p="sm" style={late ? { borderColor: 'var(--mantine-color-red-4)' } : undefined}>
      <Stack gap={6}>
        <Group justify="space-between" wrap="nowrap">
          <Text fw={700}>
            {installmentLabel(inst.seq)}: {formatMoney(inst.amount)}
          </Text>
          <Text size="xs" c="dimmed">
            {formatDate(inst.dueDate)}
          </Text>
        </Group>
        {inst.due !== inst.amount && <Line label="بعد الخصم">{formatMoney(inst.due)}</Line>}
        <Line label="المدفوع">{formatMoney(inst.paid)}</Line>
        <Line label="متأخرات القسط" color={late ? 'red.7' : undefined}>
          {formatMoney(late ? inst.remaining : 0)}
        </Line>
        {!late && inst.remaining > 0 && <Line label="المتبقي من القسط">{formatMoney(inst.remaining)}</Line>}
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Text size="sm" c="dimmed">
            حالة السداد
          </Text>
          <StatusBadge status={inst.status} />
        </Group>
      </Stack>
    </Paper>
  );
}

function FeesView({ data }: { data: GuardianFees }) {
  const { totals } = data;
  const multiple = data.plans.length > 1;
  return (
    <Stack gap="md">
      <MoneyCard
        label="الرسوم"
        amount={totals.total}
        color="red.7"
        big
        hint={totals.discount > 0 ? `الخصم: ${money(totals.discount)} — الصافي: ${money(totals.net)}` : undefined}
      />
      <SimpleGrid cols={2} spacing="sm">
        <MoneyCard label="المبلغ المدفوع" amount={totals.paid} color="teal.7" />
        <MoneyCard label="المبلغ المتبقي" amount={totals.remaining} color="red.7" />
      </SimpleGrid>

      {totals.overdue > 0 && (
        <Alert color="red" variant="light" icon={<IconAlertTriangle />} title="متأخرات مستحقة">
          عليكم متأخرات بقيمة {money(totals.overdue)}، نرجو التكرم بالسداد في أقرب وقت.
        </Alert>
      )}
      {totals.credit > 0 && (
        <Alert color="teal" variant="light">
          لديكم رصيد زائد بقيمة {money(totals.credit)}.
        </Alert>
      )}

      {data.plans.map((plan, k) => (
        <Stack key={`${plan.planName}-${k}`} gap="xs">
          {multiple && (
            <Group justify="space-between" wrap="nowrap">
              <Title order={5}>{plan.planName}</Title>
              <Text size="sm" c="dimmed">
                {money(plan.net)}
              </Text>
            </Group>
          )}
          {plan.installments.map((inst) => (
            <InstallmentCard key={inst.seq} inst={inst} />
          ))}
        </Stack>
      ))}

      <Stack gap="xs">
        <Title order={5}>سجل المدفوعات</Title>
        {data.payments.length === 0 ? (
          <EmptyState message="لا توجد مدفوعات مسجلة بعد" icon={<IconReceipt size={36} stroke={1.5} />} />
        ) : (
          data.payments.map((p, k) => (
            <Paper key={`${p.paidAt}-${k}`} withBorder radius="md" px="md" py="xs">
              <Group justify="space-between" wrap="nowrap">
                <Text fw={700}>{money(p.amount)}</Text>
                <Text size="sm" c="dimmed">
                  {formatDate(p.paidAt)}
                </Text>
              </Group>
              <Text size="xs" c="dimmed" mt={2}>
                {PAYMENT_METHOD_LABELS[p.method]}
                {p.receiptNo ? ` · إيصال رقم ${p.receiptNo}` : ''}
              </Text>
            </Paper>
          ))
        )}
      </Stack>
    </Stack>
  );
}

/** P9 — "الرسوم الدراسية": total, paid, remaining, each installment and the payment history. */
export function GuardianFeesPage() {
  const studentId = useStudentId();
  const q = useGuardianFees(studentId);
  return (
    <MobilePage title="الرسوم الدراسية">
      <QueryState query={q} empty="لم تُسجل رسوم دراسية لهذا الطالب بعد" isEmpty={(d) => d.plans.length === 0}>
        {(data) => <FeesView data={data} />}
      </QueryState>
    </MobilePage>
  );
}

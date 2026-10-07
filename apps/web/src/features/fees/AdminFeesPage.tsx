import { useMemo, useState } from 'react';
import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Grid,
  Group,
  Modal,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconPencil, IconPlus, IconSearch, IconTrash, IconUsersPlus } from '@tabler/icons-react';
import { Link, useSearchParams } from 'react-router';
import {
  formatDate,
  formatMoney,
  PAYMENT_METHOD_LABELS,
  STUDENT_STATUS_LABELS,
  type StudentStatus,
} from '@slash/shared';
import { AdminPage } from '../../components/AdminPage';
import { EmptyState, QueryState } from '../../components/States';
import { notifyError, notifySuccess } from '../../lib/notify';
import { useSchoolId } from '../../lib/params';
import { useAssignPlan, useDeletePlan, useFeePlans, useFeesOverview, type FeePlan, type FeesOverview } from './api';
import { CountCard, MoneyCard, useGradeOptions } from './components';
import { installmentLabel, money } from './labels';
import { PlanFormModal } from './PlanFormModal';

type Tab = 'plans' | 'arrears';

// ───────────────────────────── Plans tab ─────────────────────────────

function AssignForm({ schoolId, plan, onDone }: { schoolId: string; plan: FeePlan; onDone: () => void }) {
  const { options } = useGradeOptions(schoolId);
  const [gradeLevelId, setGradeLevelId] = useState<string | null>(plan.gradeLevelId);
  const [discount, setDiscount] = useState<number | ''>(0);
  const assign = useAssignPlan(schoolId);
  const tooMuch = typeof discount === 'number' && discount > plan.total;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!gradeLevelId || tooMuch) return;
        assign.mutate(
          { planId: plan.id, gradeLevelId, discount: typeof discount === 'number' ? discount : 0 },
          {
            onSuccess: (r) => {
              notifySuccess(
                r.assigned
                  ? `تم تطبيق الخطة على ${r.assigned} من الطلاب${r.skipped ? ` (${r.skipped} مسجلون مسبقاً)` : ''}`
                  : 'جميع طلاب الصف مسجلون في هذه الخطة مسبقاً',
              );
              onDone();
            },
            onError: notifyError,
          },
        );
      }}
    >
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          تُسجَّل الخطة «{plan.name}» ({money(plan.total)}) لكل الطلاب المنتظمين في الصف المختار، ويُتخطى من سُجّل فيها
          مسبقاً.
        </Text>
        <Select
          label="الصف"
          placeholder="اختر الصف"
          data={options}
          value={gradeLevelId}
          onChange={setGradeLevelId}
          required
          comboboxProps={{ withinPortal: true }}
        />
        <NumberInput
          label="الخصم لكل طالب"
          description="اختياري، يمكن تعديله لكل طالب لاحقاً من ملفه"
          thousandSeparator=","
          allowDecimal={false}
          allowNegative={false}
          hideControls
          value={discount}
          onChange={(v) => setDiscount(typeof v === 'number' ? v : '')}
          error={tooMuch ? 'الخصم أكبر من إجمالي الرسوم' : undefined}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onDone}>
            إلغاء
          </Button>
          <Button type="submit" loading={assign.isPending} disabled={!gradeLevelId || tooMuch}>
            تطبيق على الصف
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

function PlansTab({ schoolId, onEdit }: { schoolId: string; onEdit: (plan: FeePlan) => void }) {
  const plans = useFeePlans(schoolId);
  const remove = useDeletePlan(schoolId);
  const [assigning, setAssigning] = useState<FeePlan | null>(null);
  const [deleting, setDeleting] = useState<FeePlan | null>(null);

  return (
    <>
      <QueryState
        query={plans}
        empty="لا توجد خطط رسوم بعد — أضف خطة جديدة ثم طبّقها على الصف"
        isEmpty={(list) => list.length === 0}
      >
        {(list) => (
          <Paper withBorder radius="md" p="md">
            <div className="table-scroll">
              <Table verticalSpacing="sm" highlightOnHover miw={820}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>الخطة</Table.Th>
                    <Table.Th>الصف</Table.Th>
                    <Table.Th>الأقساط</Table.Th>
                    <Table.Th>الإجمالي</Table.Th>
                    <Table.Th>الطلاب</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {list.map((plan) => (
                    <Table.Tr key={plan.id}>
                      <Table.Td>
                        <Text fw={600}>{plan.name}</Text>
                        <Text size="xs" c="dimmed">
                          {plan.academicYearName}
                        </Text>
                      </Table.Td>
                      <Table.Td>{plan.gradeLevelName ?? 'جميع الصفوف'}</Table.Td>
                      <Table.Td>
                        <Stack gap={0}>
                          {plan.installments.map((i) => (
                            <Text key={i.id} size="xs">
                              {installmentLabel(i.seq)}: {formatMoney(i.amount)} — {formatDate(i.dueDate)}
                            </Text>
                          ))}
                        </Stack>
                      </Table.Td>
                      <Table.Td fw={700}>{money(plan.total)}</Table.Td>
                      <Table.Td>{plan.studentCount}</Table.Td>
                      <Table.Td>
                        <Group gap={4} wrap="nowrap" justify="flex-end">
                          <Button
                            size="compact-sm"
                            variant="light"
                            leftSection={<IconUsersPlus size={16} />}
                            onClick={() => setAssigning(plan)}
                          >
                            تطبيق على الصف
                          </Button>
                          <Tooltip label="تعديل">
                            <ActionIcon variant="subtle" aria-label="تعديل الخطة" onClick={() => onEdit(plan)}>
                              <IconPencil size={18} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label={plan.hasPayments ? 'لا يمكن حذف خطة عليها دفعات' : 'حذف'}>
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              aria-label="حذف الخطة"
                              disabled={plan.hasPayments}
                              onClick={() => setDeleting(plan)}
                            >
                              <IconTrash size={18} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>
          </Paper>
        )}
      </QueryState>

      <Modal opened={!!assigning} onClose={() => setAssigning(null)} title="تطبيق على الصف" centered>
        {assigning && (
          <AssignForm key={assigning.id} schoolId={schoolId} plan={assigning} onDone={() => setAssigning(null)} />
        )}
      </Modal>

      <Modal opened={!!deleting} onClose={() => setDeleting(null)} title="حذف خطة الرسوم" centered>
        {deleting && (
          <>
            <Text size="sm">
              هل تريد حذف خطة «{deleting.name}»؟
              {deleting.studentCount > 0 && ` سيُلغى تسجيل ${deleting.studentCount} من الطلاب فيها.`}
            </Text>
            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={() => setDeleting(null)}>
                إلغاء
              </Button>
              <Button
                color="red"
                loading={remove.isPending}
                onClick={() =>
                  remove.mutate(deleting.id, {
                    onSuccess: () => {
                      notifySuccess('تم حذف خطة الرسوم');
                      setDeleting(null);
                    },
                    onError: notifyError,
                  })
                }
              >
                حذف
              </Button>
            </Group>
          </>
        )}
      </Modal>
    </>
  );
}

// ───────────────────────────── Arrears tab ─────────────────────────────

function ArrearsView({ schoolId, data }: { schoolId: string; data: FeesOverview }) {
  const [search, setSearch] = useState('');
  const rows = useMemo(() => {
    const term = search.trim();
    if (!term) return data.arrears;
    return data.arrears.filter((a) => a.fullName.includes(term) || a.code.includes(term));
  }, [data.arrears, search]);

  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }} spacing="sm">
        <MoneyCard label="إجمالي الرسوم المستحقة" amount={data.expected} />
        <MoneyCard label="المبلغ المحصّل" amount={data.collected} color="teal.7" />
        <MoneyCard label="المبلغ المتبقي" amount={data.outstanding} color="orange.7" />
        <MoneyCard label="المتأخرات" amount={data.overdue} color="red.7" />
        <CountCard label="طلاب عليهم متأخرات" value={data.studentsWithArrears} color="red.7" />
      </SimpleGrid>

      <Grid gutter="md" align="flex-start">
        <Grid.Col span={{ base: 12, lg: 7 }}>
          <Paper withBorder radius="md" p="md">
            <Group justify="space-between" mb="sm">
              <Title order={4}>الطلاب المتأخرون في السداد</Title>
              <TextInput
                size="xs"
                w={220}
                placeholder="بحث بالاسم أو الكود"
                leftSection={<IconSearch size={14} />}
                value={search}
                onChange={(e) => setSearch(e.currentTarget.value)}
              />
            </Group>
            {data.arrears.length === 0 ? (
              <EmptyState message="لا توجد متأخرات، جميع الأقساط المستحقة مسددة" />
            ) : rows.length === 0 ? (
              <EmptyState message="لا توجد نتائج مطابقة" />
            ) : (
              <div className="table-scroll">
                <Table highlightOnHover verticalSpacing="xs" miw={560}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>الكود</Table.Th>
                      <Table.Th>الطالب</Table.Th>
                      <Table.Th>الفصل</Table.Th>
                      <Table.Th>المتبقي</Table.Th>
                      <Table.Th>المتأخرات</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {rows.map((a) => (
                      <Table.Tr key={a.studentId}>
                        <Table.Td>{a.code}</Table.Td>
                        <Table.Td>
                          <Anchor component={Link} to={`/a/${schoolId}/students/${a.studentId}`} fw={600}>
                            {a.fullName}
                          </Anchor>
                          {a.status !== 'active' && (
                            <Badge size="xs" color="gray" variant="light" ms={6}>
                              {STUDENT_STATUS_LABELS[a.status as StudentStatus] ?? a.status}
                            </Badge>
                          )}
                        </Table.Td>
                        <Table.Td>{a.classLabel ?? '—'}</Table.Td>
                        <Table.Td>{formatMoney(a.remaining)}</Table.Td>
                        <Table.Td fw={700} c="red.7">
                          {formatMoney(a.overdue)}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </div>
            )}
            {data.studentsWithArrears > data.arrears.length && (
              <Text size="xs" c="dimmed" mt="xs">
                يُعرض أعلى {data.arrears.length} طالباً من حيث المتأخرات من أصل {data.studentsWithArrears}.
              </Text>
            )}
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 5 }}>
          <Paper withBorder radius="md" p="md">
            <Title order={4} mb="sm">
              آخر المدفوعات
            </Title>
            {data.recentPayments.length === 0 ? (
              <EmptyState message="لم تُسجل أي دفعات بعد" />
            ) : (
              <div className="table-scroll">
                <Table verticalSpacing="xs" miw={420}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>التاريخ</Table.Th>
                      <Table.Th>الطالب</Table.Th>
                      <Table.Th>المبلغ</Table.Th>
                      <Table.Th>الطريقة</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {data.recentPayments.map((p) => (
                      <Table.Tr key={p.id}>
                        <Table.Td>{formatDate(p.paidAt)}</Table.Td>
                        <Table.Td>
                          <Anchor component={Link} to={`/a/${schoolId}/students/${p.studentId}`} size="sm">
                            {p.studentName}
                          </Anchor>
                          {p.receiptNo && (
                            <Text size="xs" c="dimmed">
                              إيصال {p.receiptNo}
                            </Text>
                          )}
                        </Table.Td>
                        <Table.Td fw={600}>{formatMoney(p.amount)}</Table.Td>
                        <Table.Td>{PAYMENT_METHOD_LABELS[p.method]}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </div>
            )}
          </Paper>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

function ArrearsTab({ schoolId }: { schoolId: string }) {
  const overview = useFeesOverview(schoolId);
  return <QueryState query={overview}>{(data) => <ArrearsView schoolId={schoolId} data={data} />}</QueryState>;
}

// ───────────────────────────── Page ─────────────────────────────

/** Director's fees page: fee plans (create / edit / apply to a grade) and the arrears overview. */
export function AdminFeesPage() {
  const schoolId = useSchoolId();
  // Load the grade levels (and today) up front so the plan form opens with its pickers and dates filled.
  const { loading: scopeLoading } = useGradeOptions(schoolId);
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'arrears' ? 'arrears' : 'plans';
  const [editing, setEditing] = useState<FeePlan | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const openForm = (plan: FeePlan | null) => {
    setEditing(plan);
    setFormOpen(true);
  };

  return (
    <AdminPage
      title="الرسوم الدراسية"
      subtitle="تُسجَّل الدفعات يدوياً من ملف كل طالب"
      actions={
        tab === 'plans' && (
          <Button leftSection={<IconPlus size={18} />} onClick={() => openForm(null)} disabled={scopeLoading}>
            خطة رسوم جديدة
          </Button>
        )
      }
    >
      <Tabs
        value={tab}
        onChange={(v) =>
          setParams(
            (prev) => {
              const next = new URLSearchParams(prev);
              if (v === 'arrears') next.set('tab', 'arrears');
              else next.delete('tab');
              return next;
            },
            { replace: true },
          )
        }
        keepMounted={false}
      >
        <Tabs.List>
          <Tabs.Tab value="plans">خطط الرسوم</Tabs.Tab>
          <Tabs.Tab value="arrears">المتأخرات</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="plans" pt="md">
          <PlansTab schoolId={schoolId} onEdit={(plan) => openForm(plan)} />
        </Tabs.Panel>
        <Tabs.Panel value="arrears" pt="md">
          <ArrearsTab schoolId={schoolId} />
        </Tabs.Panel>
      </Tabs>
      <PlanFormModal schoolId={schoolId} plan={editing} opened={formOpen} onClose={() => setFormOpen(false)} />
    </AdminPage>
  );
}

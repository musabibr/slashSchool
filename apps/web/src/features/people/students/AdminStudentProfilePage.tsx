import { lazy, Suspense, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  Button,
  Grid,
  Group,
  Loader,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  Textarea,
} from '@mantine/core';
import {
  IconArrowRight,
  IconCalendarX,
  IconCash,
  IconChartBar,
  IconEdit,
  IconGavel,
  IconLink,
  IconLogout,
  IconRefresh,
  IconUserOff,
} from '@tabler/icons-react';
import { Link, useParams, useSearchParams } from 'react-router';
import { formatDate, GENDER_LABELS, joinName, STUDENT_STATUS_LABELS, type StudentStatus } from '@slash/shared';
import { AdminPage } from '../../../components/AdminPage';
import { QueryState } from '../../../components/States';
import { notifyError, notifySuccess } from '../../../lib/notify';
import { useSchoolId } from '../../../lib/params';
import { useChangeStudentStatus, useIssueLinkCode, useStudentProfile, type StudentProfile } from './api';
import { GuardiansCard } from './GuardiansCard';
import { linkCodeMessage } from './helpers';
import { CodeCard, StudentStatusBadge, useSchoolName } from './shared';

// Panels owned by other features, loaded when their tab opens.
const StudentAttendanceSummary = lazy(() =>
  import('../../attendance').then((m) => ({ default: m.StudentAttendanceSummary })),
);
const StudentResultsPanel = lazy(() => import('../../assessment').then((m) => ({ default: m.StudentResultsPanel })));
const StudentBehaviorPanel = lazy(() => import('../../behavior').then((m) => ({ default: m.StudentBehaviorPanel })));
const StudentFeesPanel = lazy(() => import('../../fees').then((m) => ({ default: m.StudentFeesPanel })));
const MessageGuardianButton = lazy(() => import('../../comms').then((m) => ({ default: m.MessageGuardianButton })));

const TABS = ['info', 'attendance', 'results', 'behavior', 'fees'] as const;
type Tab = (typeof TABS)[number];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack gap={2}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={600} size="sm" component="div">
        {children || '—'}
      </Text>
    </Stack>
  );
}

type StatusAction = Extract<StudentStatus, 'expelled' | 'withdrawn' | 'active'>;

const STATUS_ACTIONS: Record<
  StatusAction,
  { title: string; confirm: string; color: string; reasonLabel?: string; reasonRequired?: boolean; done: string }
> = {
  expelled: {
    title: 'فصل طالب',
    confirm: 'تأكيد الفصل',
    color: 'red',
    reasonLabel: 'سبب الفصل',
    reasonRequired: true,
    done: 'تم فصل الطالب',
  },
  withdrawn: {
    title: 'انسحاب الطالب',
    confirm: 'تأكيد الانسحاب',
    color: 'orange',
    reasonLabel: 'سبب الانسحاب (اختياري)',
    done: 'تم تسجيل انسحاب الطالب',
  },
  active: { title: 'إعادة تفعيل الطالب', confirm: 'إعادة التفعيل', color: 'teal', done: 'عاد الطالب منتظماً' },
};

function StatusModal({
  schoolId,
  student,
  action,
  onClose,
}: {
  schoolId: string;
  student: StudentProfile;
  action: StatusAction | null;
  onClose: () => void;
}) {
  const change = useChangeStudentStatus(schoolId, student.id);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cfg = action ? STATUS_ACTIONS[action] : null;
  const close = () => {
    setReason('');
    setError(null);
    onClose();
  };
  const submit = () => {
    if (!action || !cfg) return;
    if (cfg.reasonRequired && !reason.trim()) {
      setError('سبب الفصل مطلوب');
      return;
    }
    change.mutate(
      { status: action, reason: reason.trim() || null },
      {
        onSuccess: () => {
          notifySuccess(cfg.done);
          close();
        },
        onError: notifyError,
      },
    );
  };
  return (
    <Modal opened={!!action} onClose={close} title={cfg?.title} centered>
      {cfg && (
        <Stack gap="sm">
          <Text size="sm">
            {action === 'expelled'
              ? `سيتم فصل ${student.fullName}. تبقى سجلاته محفوظة ويمكن إعادة تفعيله لاحقاً.`
              : action === 'withdrawn'
                ? `سيتم تسجيل انسحاب ${student.fullName} من المدرسة. تبقى سجلاته محفوظة.`
                : `سيعود ${student.fullName} طالباً منتظماً.`}
          </Text>
          {cfg.reasonLabel && (
            <Textarea
              label={cfg.reasonLabel}
              required={cfg.reasonRequired}
              autosize
              minRows={2}
              maxLength={500}
              value={reason}
              onChange={(e) => {
                setReason(e.currentTarget.value);
                setError(null);
              }}
              error={error}
              data-autofocus
            />
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              إلغاء
            </Button>
            <Button color={cfg.color} loading={change.isPending} onClick={submit}>
              {cfg.confirm}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

function LinkCodeButton({ schoolId, student }: { schoolId: string; student: StudentProfile }) {
  const schoolName = useSchoolName(schoolId);
  const issue = useIssueLinkCode(schoolId, student.id);
  const [opened, setOpened] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const primary = student.guardians.find((g) => g.isPrimary) ?? student.guardians[0];
  const close = () => {
    setOpened(false);
    setCode(null);
  };
  return (
    <>
      <Button variant="default" leftSection={<IconLink size={16} />} onClick={() => setOpened(true)}>
        رمز ربط الطالب
      </Button>
      <Modal opened={opened} onClose={close} title="رمز ربط الطالب" centered>
        <Stack gap="sm">
          <Text size="sm">
            يستخدم ولي الأمر هذا الرمز من زر «+» في قائمة الأبناء ليُضاف {student.fullName} إلى حسابه. الرمز يُستخدم مرة
            واحدة.
          </Text>
          {code ? (
            <CodeCard
              label="رمز الربط"
              code={code}
              phone={primary ? (primary.whatsapp ?? primary.phone) : ''}
              message={linkCodeMessage({ studentName: student.fullName, schoolName, code })}
            />
          ) : (
            <>
              {student.hasLinkCode && (
                <Alert color="orange" variant="light">
                  يوجد رمز ربط سابق لهذا الطالب، وإصدار رمز جديد يلغيه.
                </Alert>
              )}
              <Group justify="flex-end">
                <Button variant="default" onClick={close}>
                  إلغاء
                </Button>
                <Button
                  loading={issue.isPending}
                  onClick={() => issue.mutate(undefined, { onSuccess: (r) => setCode(r.code), onError: notifyError })}
                >
                  إصدار رمز
                </Button>
              </Group>
            </>
          )}
        </Stack>
      </Modal>
    </>
  );
}

function Profile({ schoolId, student }: { schoolId: string; student: StudentProfile }) {
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab') as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : 'info';
  const tabsRef = useRef<HTMLDivElement>(null);
  const [statusAction, setStatusAction] = useState<StatusAction | null>(null);

  const openTab = (next: Tab, scroll = true) => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next === 'info') p.delete('tab');
        else p.set('tab', next);
        return p;
      },
      { replace: true },
    );
    if (scroll) requestAnimationFrame(() => tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const fullName4 = joinName(
    student.firstName,
    student.fatherName,
    student.grandfatherName,
    student.greatGrandfatherName,
  );
  const panelFallback = (
    <Group justify="center" py="lg">
      <Loader size="sm" />
    </Group>
  );

  return (
    <AdminPage
      title={fullName4}
      subtitle={`ملف الطالب · ${student.code}`}
      actions={
        <>
          <Button
            variant="default"
            component={Link}
            to={`/a/${schoolId}/students`}
            leftSection={<IconArrowRight size={16} />}
          >
            الطلاب
          </Button>
          <Button
            variant="default"
            component={Link}
            to={`/a/${schoolId}/students/${student.id}/edit`}
            leftSection={<IconEdit size={16} />}
          >
            تعديل البيانات
          </Button>
          <LinkCodeButton schoolId={schoolId} student={student} />
        </>
      }
    >
      <Grid gutter="md" align="stretch">
        <Grid.Col span={{ base: 12, lg: 7 }}>
          <Stack gap="md" h="100%">
            <Paper withBorder radius="md" p="md">
              <SimpleGrid cols={{ base: 2, sm: 5 }} spacing="md">
                <Field label="الكود">
                  <Text span dir="ltr" inherit>
                    {student.code}
                  </Text>
                </Field>
                <Field label="إسم الطالب">{student.fullName}</Field>
                <Field label="الصف">
                  {student.classLabel ?? (student.gradeLevelName ? `${student.gradeLevelName} (بدون فصل)` : '')}
                </Field>
                <Field label="تاريخ التسجيل">{formatDate(student.registeredAt)}</Field>
                <Field label="الحالة">
                  <StudentStatusBadge status={student.status} />
                </Field>
              </SimpleGrid>
              {student.status !== 'active' && (
                <Alert color={student.status === 'expelled' ? 'red' : 'gray'} variant="light" mt="md">
                  {STUDENT_STATUS_LABELS[student.status]}
                  {student.statusChangedAt ? ` منذ ${formatDate(student.statusChangedAt)}` : ''}
                  {student.statusReason ? ` — ${student.statusReason}` : ''}
                </Alert>
              )}
            </Paper>

            <Paper withBorder radius="md" p="md">
              <Stack gap="sm">
                <Group gap="xs">
                  <Button variant="light" leftSection={<IconCash size={16} />} onClick={() => openTab('fees')}>
                    إرسال إشعار الرسوم الدراسية
                  </Button>
                  <Suspense fallback={<Loader size="xs" />}>
                    <MessageGuardianButton studentId={student.id} schoolId={schoolId} studentName={student.fullName} />
                  </Suspense>
                  <Button variant="light" leftSection={<IconGavel size={16} />} onClick={() => openTab('behavior')}>
                    مخالفة السلوك والإنضباط
                  </Button>
                  <Button
                    variant="light"
                    leftSection={<IconCalendarX size={16} />}
                    onClick={() => openTab('attendance')}
                  >
                    الغياب و الحضور
                  </Button>
                  <Button variant="light" leftSection={<IconChartBar size={16} />} onClick={() => openTab('results')}>
                    النتائج
                  </Button>
                </Group>
                <Group gap="xs">
                  {student.status === 'active' ? (
                    <>
                      <Button
                        color="red"
                        leftSection={<IconUserOff size={16} />}
                        onClick={() => setStatusAction('expelled')}
                      >
                        فصل طالب
                      </Button>
                      <Button
                        variant="default"
                        leftSection={<IconLogout size={16} />}
                        onClick={() => setStatusAction('withdrawn')}
                      >
                        انسحاب
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="light"
                      color="teal"
                      leftSection={<IconRefresh size={16} />}
                      onClick={() => setStatusAction('active')}
                    >
                      إعادة تفعيل الطالب
                    </Button>
                  )}
                </Group>
              </Stack>
            </Paper>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 5 }}>
          <GuardiansCard schoolId={schoolId} student={student} />
        </Grid.Col>
      </Grid>

      <Paper withBorder radius="md" p="md" ref={tabsRef} style={{ scrollMarginTop: 72 }}>
        <Tabs value={tab} onChange={(v) => v && openTab(v as Tab, false)} keepMounted={false}>
          <Tabs.List mb="md">
            <Tabs.Tab value="info">البيانات</Tabs.Tab>
            <Tabs.Tab value="attendance">الغياب و الحضور</Tabs.Tab>
            <Tabs.Tab value="results">النتائج</Tabs.Tab>
            <Tabs.Tab value="behavior">السلوك والإنضباط</Tabs.Tab>
            <Tabs.Tab value="fees">الرسوم الدراسية</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="info">
            <SimpleGrid cols={{ base: 2, sm: 3, lg: 4 }} spacing="md">
              <Field label="الاسم الكامل">{fullName4}</Field>
              <Field label="الجنس">{GENDER_LABELS[student.gender]}</Field>
              <Field label="تاريخ الميلاد">{formatDate(student.birthDate)}</Field>
              <Field label="المرحلة الدراسية">{student.stageName}</Field>
              <Field label="السنة الدراسية">{student.gradeLevelName}</Field>
              <Field label="الفصل">{student.classLabel}</Field>
              <Field label="اسم الوالدة">{student.motherName}</Field>
              <Field label="رقم الوالدة">
                {student.motherPhone && (
                  <Text span dir="ltr" inherit>
                    {student.motherPhone}
                  </Text>
                )}
              </Field>
              <Field label="رقم الوالدة (واتساب)">
                {student.motherWhatsapp && (
                  <Text span dir="ltr" inherit>
                    {student.motherWhatsapp}
                  </Text>
                )}
              </Field>
              {student.notes && <Field label="ملاحظات">{student.notes}</Field>}
            </SimpleGrid>
          </Tabs.Panel>
          <Tabs.Panel value="attendance">
            <Suspense fallback={panelFallback}>
              <StudentAttendanceSummary studentId={student.id} />
            </Suspense>
          </Tabs.Panel>
          <Tabs.Panel value="results">
            <Suspense fallback={panelFallback}>
              <StudentResultsPanel studentId={student.id} />
            </Suspense>
          </Tabs.Panel>
          <Tabs.Panel value="behavior">
            <Suspense fallback={panelFallback}>
              <StudentBehaviorPanel studentId={student.id} schoolId={schoolId} />
            </Suspense>
          </Tabs.Panel>
          <Tabs.Panel value="fees">
            <Suspense fallback={panelFallback}>
              <StudentFeesPanel studentId={student.id} schoolId={schoolId} />
            </Suspense>
          </Tabs.Panel>
        </Tabs>
      </Paper>

      <StatusModal schoolId={schoolId} student={student} action={statusAction} onClose={() => setStatusAction(null)} />
    </AdminPage>
  );
}

/** D4 — the director's student page (students/:studentId). */
export function AdminStudentProfilePage() {
  const schoolId = useSchoolId();
  const { studentId } = useParams();
  const profile = useStudentProfile(schoolId, studentId);
  if (profile.data) return <Profile schoolId={schoolId} student={profile.data} />;
  return (
    <AdminPage title="ملف الطالب">
      <QueryState query={profile}>{() => null}</QueryState>
    </AdminPage>
  );
}

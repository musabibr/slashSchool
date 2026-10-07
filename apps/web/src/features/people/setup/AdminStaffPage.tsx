import { useState } from 'react';
import { Badge, Button, Group, Modal, Paper, Stack, Table, Text, TextInput, Tooltip } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconKey, IconPlus, IconSearch, IconUserMinus } from '@tabler/icons-react';
import { isValidPhone, normalizePhone, ROLE_LABELS, type Role } from '@slash/shared';
import { ApiError } from '../../../api/client';
import { useMe } from '../../../api/hooks';
import { AdminPage } from '../../../components/AdminPage';
import { QueryState } from '../../../components/States';
import { dayjs } from '../../../lib/dayjs';
import { notifyError, notifySuccess } from '../../../lib/notify';
import { useSchoolId } from '../../../lib/params';
import { ActivationCodeModal, type IssuedCode } from './ActivationCodeModal';
import { useCreateStaff, useIssueStaffCode, useRemoveStaff, useStaff, type StaffMember } from './api';
import { ConfirmModal } from './dialogs';

type PageRole = Extract<Role, 'supervisor' | 'teacher'>;

const COPY: Record<PageRole, { title: string; one: string; empty: string; removeNote: string }> = {
  supervisor: {
    title: 'المشرفين',
    one: 'مشرف',
    empty: 'لا يوجد مشرفون بعد',
    removeNote: 'سيفقد صلاحيات المشرف في المدرسة.',
  },
  teacher: {
    title: 'الأساتذة',
    one: 'أستاذ',
    empty: 'لا يوجد أساتذة بعد',
    removeNote: 'سيفقد الوصول إلى فصوله، ويُلغى توزيع مواده وحصصه في الجدول الحالي.',
  },
};

const MAX_ASSIGNMENT_BADGES = 4;

function StatusBadge({ status }: { status: StaffMember['status'] }) {
  return status === 'active' ? (
    <Badge color="teal" variant="light">
      مفعّل
    </Badge>
  ) : (
    <Badge color="orange" variant="light">
      بانتظار التفعيل
    </Badge>
  );
}

function AssignmentsCell({ member }: { member: StaffMember }) {
  if (!member.assignments.length) {
    return (
      <Text size="sm" c="dimmed">
        —
      </Text>
    );
  }
  const shown = member.assignments.slice(0, MAX_ASSIGNMENT_BADGES);
  const rest = member.assignments.slice(MAX_ASSIGNMENT_BADGES);
  return (
    <Group gap={4}>
      {shown.map((a) => (
        <Badge key={`${a.classLabel}:${a.subjectName}`} variant="outline" color="gray" radius="sm" tt="none">
          {a.subjectName} — {a.classLabel}
        </Badge>
      ))}
      {rest.length > 0 && (
        <Tooltip label={rest.map((a) => `${a.subjectName} — ${a.classLabel}`).join('، ')} multiline maw={320} withArrow>
          <Badge variant="light" color="gray" radius="sm">
            +{rest.length}
          </Badge>
        </Tooltip>
      )}
    </Group>
  );
}

interface AddValues {
  fullName: string;
  phone: string;
}

function AddStaffForm({
  schoolId,
  role,
  onCreated,
  onCancel,
}: {
  schoolId: string;
  role: PageRole;
  onCreated: (issued: IssuedCode | null, fullName: string) => void;
  onCancel: () => void;
}) {
  const create = useCreateStaff(schoolId);
  const form = useForm<AddValues>({
    initialValues: { fullName: '', phone: '' },
    validate: {
      fullName: (v) => (v.trim() ? null : 'الاسم مطلوب'),
      phone: (v) => (!v.trim() ? 'رقم الهاتف مطلوب' : isValidPhone(v) ? null : 'رقم الهاتف غير صالح'),
    },
  });

  const submit = form.onSubmit((v) =>
    create.mutate(
      { fullName: v.fullName.trim(), phone: normalizePhone(v.phone), role },
      {
        onSuccess: (created) =>
          onCreated(
            created.activationCode && created.expiresAt
              ? {
                  fullName: created.fullName,
                  phone: created.phone,
                  code: created.activationCode,
                  expiresAt: created.expiresAt,
                }
              : null,
            created.fullName,
          ),
        onError: (err) => {
          if (err instanceof ApiError && err.details?.length) {
            form.setErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
          }
          notifyError(err);
        },
      },
    ),
  );

  return (
    <form onSubmit={submit}>
      <Stack gap="sm">
        <TextInput
          label="الاسم الكامل"
          placeholder="مثال: عثمان محمد الأمين"
          withAsterisk
          data-autofocus
          {...form.getInputProps('fullName')}
        />
        <TextInput
          label="رقم الهاتف"
          placeholder="09xxxxxxxx"
          description="يُستخدم لتسجيل الدخول ولإرسال رمز التفعيل عبر واتساب"
          inputMode="tel"
          dir="ltr"
          withAsterisk
          {...form.getInputProps('phone')}
        />
        <Group justify="flex-end" gap="xs" mt="xs">
          <Button variant="default" onClick={onCancel}>
            إلغاء
          </Button>
          <Button type="submit" loading={create.isPending}>
            إضافة
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

/** Supervisors or teachers list (one page, two sidebar entries): D5 and "المشرفين". */
export function AdminStaffPage({ role }: { role: PageRole }) {
  const schoolId = useSchoolId();
  const copy = COPY[role];
  const me = useMe();
  const schoolName = me.data?.schools.find((s) => s.id === schoolId)?.name ?? '';
  const q = useStaff(schoolId, role);
  const issue = useIssueStaffCode(schoolId);
  const remove = useRemoveStaff(schoolId);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [issued, setIssued] = useState<IssuedCode | null>(null);
  const [issuingFor, setIssuingFor] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<StaffMember | null>(null);

  const issueCode = (member: StaffMember) => {
    setIssuingFor(member.userId);
    issue.mutate(member.userId, {
      onSuccess: ({ code, expiresAt }) =>
        setIssued({ fullName: member.fullName, phone: member.phone, code, expiresAt }),
      onError: notifyError,
      onSettled: () => setIssuingFor(null),
    });
  };

  const needle = search.trim();
  const filter = (list: StaffMember[]) =>
    needle
      ? list.filter((m) => m.fullName.includes(needle) || m.phone.includes(normalizePhone(needle) || needle))
      : list;

  return (
    <AdminPage
      title={copy.title}
      subtitle={q.data ? `${q.data.length} ${copy.one}` : undefined}
      actions={
        <Button leftSection={<IconPlus size={16} />} onClick={() => setAdding(true)}>
          إضافة
        </Button>
      }
    >
      <Paper withBorder radius="md" p="md">
        <TextInput
          mb="sm"
          maw={320}
          placeholder="بحث بالاسم أو رقم الهاتف"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
        <QueryState query={q} empty={copy.empty} isEmpty={(d) => d.length === 0}>
          {(staff) => {
            const rows = filter(staff);
            if (!rows.length) {
              return (
                <Text c="dimmed" size="sm" ta="center" py="lg">
                  لا توجد نتائج مطابقة
                </Text>
              );
            }
            return (
              <div className="table-scroll">
                <Table highlightOnHover verticalSpacing="sm" miw={860}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>الاسم</Table.Th>
                      <Table.Th>رقم الهاتف</Table.Th>
                      <Table.Th>الحالة</Table.Th>
                      <Table.Th>المواد والفصول</Table.Th>
                      <Table.Th>آخر دخول</Table.Th>
                      <Table.Th />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {rows.map((m) => {
                      const otherRoles = m.roles.filter((r) => r !== role);
                      return (
                        <Table.Tr key={m.userId}>
                          <Table.Td>
                            <Text fw={600} size="sm">
                              {m.fullName}
                            </Text>
                            {otherRoles.length > 0 && (
                              <Group gap={4} mt={2}>
                                {otherRoles.map((r) => (
                                  <Badge key={r} size="xs" variant="light" color="grape">
                                    {ROLE_LABELS[r]}
                                  </Badge>
                                ))}
                              </Group>
                            )}
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm" dir="ltr" ta="right">
                              {m.phone}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <StatusBadge status={m.status} />
                          </Table.Td>
                          <Table.Td maw={360}>
                            <AssignmentsCell member={m} />
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm" c="dimmed">
                              {m.lastLoginAt ? dayjs(m.lastLoginAt).format('D/M/YYYY') : '—'}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Group gap={4} justify="flex-end" wrap="nowrap">
                              {m.status === 'pending' && (
                                <Button
                                  size="compact-xs"
                                  variant="light"
                                  leftSection={<IconKey size={14} />}
                                  loading={issuingFor === m.userId}
                                  onClick={() => issueCode(m)}
                                >
                                  إصدار رمز تفعيل
                                </Button>
                              )}
                              <Button
                                size="compact-xs"
                                variant="subtle"
                                color="red"
                                leftSection={<IconUserMinus size={14} />}
                                onClick={() => setToRemove(m)}
                              >
                                إزالة
                              </Button>
                            </Group>
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </div>
            );
          }}
        </QueryState>
      </Paper>

      <Modal opened={adding} onClose={() => setAdding(false)} title={`إضافة ${copy.one}`} centered>
        {adding && (
          <AddStaffForm
            schoolId={schoolId}
            role={role}
            onCancel={() => setAdding(false)}
            onCreated={(code, fullName) => {
              setAdding(false);
              if (code) {
                notifySuccess(`تمت إضافة ${fullName}`);
                setIssued(code);
              } else {
                notifySuccess(`تمت إضافة ${fullName} — حسابه مفعّل ويدخل برقمه السري الحالي`);
              }
            }}
          />
        )}
      </Modal>
      <ActivationCodeModal issued={issued} schoolName={schoolName} onClose={() => setIssued(null)} />
      <ConfirmModal
        opened={!!toRemove}
        title={`إزالة ${copy.one}`}
        message={toRemove ? `هل تريد إزالة ${toRemove.fullName} من ${copy.title}؟ ${copy.removeNote}` : ''}
        confirmLabel="إزالة"
        loading={remove.isPending}
        onConfirm={() =>
          toRemove &&
          remove.mutate(
            { userId: toRemove.userId, role },
            {
              onSuccess: () => {
                notifySuccess(`تمت إزالة ${toRemove.fullName}`);
                setToRemove(null);
              },
              onError: (err) => {
                setToRemove(null);
                notifyError(err);
              },
            },
          )
        }
        onClose={() => setToRemove(null)}
      />
    </AdminPage>
  );
}

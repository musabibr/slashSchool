import { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Divider,
  Group,
  Menu,
  Modal,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconDots, IconStar, IconTrash, IconUserPlus } from '@tabler/icons-react';
import { formatDate, RELATION_LABELS, type Relation } from '@slash/shared';
import { ApiError } from '../../../api/client';
import { notifyError, notifySuccess } from '../../../lib/notify';
import {
  useAddGuardian,
  useRemoveGuardian,
  useUpdateGuardianLink,
  type IssuedGuardian,
  type StudentGuardian,
  type StudentProfile,
} from './api';
import { optionalPhone, orNull, RELATION_OPTIONS, required, requiredPhone } from './helpers';
import { IssueCodeButton, IssuedGuardianCard, UserStatusBadge, useSchoolName } from './shared';

interface AddValues {
  fullName: string;
  phone: string;
  relation: Relation;
  whatsapp: string;
  occupation: string;
  workplace: string;
  locality: string;
  residence: string;
}

function AddGuardianModal({
  schoolId,
  student,
  opened,
  onClose,
}: {
  schoolId: string;
  student: StudentProfile;
  opened: boolean;
  onClose: () => void;
}) {
  const schoolName = useSchoolName(schoolId);
  const add = useAddGuardian(schoolId, student.id);
  const [issued, setIssued] = useState<IssuedGuardian | null>(null);
  const form = useForm<AddValues>({
    initialValues: {
      fullName: '',
      phone: '',
      relation: 'mother',
      whatsapp: '',
      occupation: '',
      workplace: '',
      locality: '',
      residence: '',
    },
    validate: {
      fullName: required('اسم ولي الأمر مطلوب'),
      phone: requiredPhone,
      whatsapp: optionalPhone,
    },
  });
  const close = () => {
    setIssued(null);
    form.reset();
    onClose();
  };
  const submit = form.onSubmit((v) =>
    add.mutate(
      {
        fullName: v.fullName.trim(),
        phone: v.phone.trim(),
        relation: v.relation,
        whatsapp: orNull(v.whatsapp),
        occupation: orNull(v.occupation),
        workplace: orNull(v.workplace),
        locality: orNull(v.locality),
        residence: orNull(v.residence),
      },
      {
        onSuccess: (g) => {
          notifySuccess('تمت إضافة ولي الأمر');
          setIssued(g);
        },
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
    <Modal opened={opened} onClose={close} title="إضافة ولي أمر" size="lg" centered>
      {issued ? (
        <Stack gap="sm">
          <IssuedGuardianCard guardian={issued} students={[student.fullName]} schoolName={schoolName} />
          <Group justify="flex-end">
            <Button onClick={close}>تم</Button>
          </Group>
        </Stack>
      ) : (
        <form onSubmit={submit} noValidate>
          <Stack gap="sm">
            <TextInput label="الاسم الكامل" required maxLength={150} {...form.getInputProps('fullName')} />
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
              <TextInput
                label="رقم الهاتف"
                required
                type="tel"
                inputMode="tel"
                dir="ltr"
                placeholder="09xxxxxxxx"
                {...form.getInputProps('phone')}
              />
              <TextInput
                label="رقم الواتساب"
                type="tel"
                inputMode="tel"
                dir="ltr"
                placeholder="اختياري"
                {...form.getInputProps('whatsapp')}
              />
              <Select
                label="صلة القرابة"
                required
                data={RELATION_OPTIONS}
                allowDeselect={false}
                {...form.getInputProps('relation')}
              />
              <TextInput label="المهنة" maxLength={120} {...form.getInputProps('occupation')} />
              <TextInput label="مكان العمل" maxLength={120} {...form.getInputProps('workplace')} />
              <TextInput label="المحلية" maxLength={120} {...form.getInputProps('locality')} />
            </SimpleGrid>
            <TextInput label="مكان الاقامة" maxLength={200} {...form.getInputProps('residence')} />
            <Text size="xs" c="dimmed">
              إذا كان الرقم مسجلاً في التطبيق يُربط الطالب بنفس الحساب، وإلا يُنشأ حساب جديد مع رمز تفعيل.
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={close}>
                إلغاء
              </Button>
              <Button type="submit" loading={add.isPending}>
                إضافة
              </Button>
            </Group>
          </Stack>
        </form>
      )}
    </Modal>
  );
}

function GuardianRow({
  schoolId,
  student,
  guardian,
  onlyOne,
}: {
  schoolId: string;
  student: StudentProfile;
  guardian: StudentGuardian;
  onlyOne: boolean;
}) {
  const update = useUpdateGuardianLink(schoolId, student.id);
  const remove = useRemoveGuardian(schoolId, student.id);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const details = [guardian.occupation, guardian.workplace, guardian.locality, guardian.residence].filter(Boolean);

  return (
    <Stack gap={6}>
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Group gap={6}>
            <Text fw={700}>{guardian.fullName}</Text>
            {guardian.isPrimary && (
              <Badge size="xs" variant="light">
                أساسي
              </Badge>
            )}
          </Group>
          <Text size="sm" c="dimmed">
            {RELATION_LABELS[guardian.relation]} ·{' '}
            <Text span dir="ltr" inherit>
              {guardian.phone}
            </Text>
            {guardian.whatsapp && guardian.whatsapp !== guardian.phone && (
              <>
                {' '}
                · واتساب{' '}
                <Text span dir="ltr" inherit>
                  {guardian.whatsapp}
                </Text>
              </>
            )}
          </Text>
          {details.length > 0 && (
            <Text size="xs" c="dimmed">
              {details.join(' · ')}
            </Text>
          )}
          <Text size="xs" c="dimmed">
            {guardian.lastLoginAt ? `آخر دخول ${formatDate(guardian.lastLoginAt)}` : 'لم يدخل التطبيق بعد'}
          </Text>
        </Stack>
        <Group gap={4} wrap="nowrap">
          <UserStatusBadge status={guardian.status} />
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" aria-label="خيارات">
                <IconDots size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<IconStar size={16} />}
                disabled={guardian.isPrimary}
                onClick={() =>
                  update.mutate(
                    { userId: guardian.userId, patch: { isPrimary: true } },
                    { onSuccess: () => notifySuccess('تم تعيين ولي الأمر الأساسي'), onError: notifyError },
                  )
                }
              >
                جعله ولي الأمر الأساسي
              </Menu.Item>
              <Menu.Item
                color="red"
                leftSection={<IconTrash size={16} />}
                disabled={onlyOne}
                onClick={() => setConfirmRemove(true)}
              >
                إزالة من الطالب
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
      <Group gap="xs">
        <IssueCodeButton
          schoolId={schoolId}
          userId={guardian.userId}
          guardianName={guardian.fullName}
          phone={guardian.whatsapp ?? guardian.phone}
          students={[student.fullName]}
          canIssue={guardian.canIssueCode}
        />
      </Group>
      <Modal opened={confirmRemove} onClose={() => setConfirmRemove(false)} title="إزالة ولي الأمر" centered>
        <Stack gap="sm">
          <Text size="sm">
            هل تريد إزالة {guardian.fullName} من أولياء أمور {student.fullName}؟ لن يتمكن من متابعة الطالب في التطبيق.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirmRemove(false)}>
              إلغاء
            </Button>
            <Button
              color="red"
              loading={remove.isPending}
              onClick={() =>
                remove.mutate(guardian.userId, {
                  onSuccess: () => {
                    notifySuccess('تمت إزالة ولي الأمر');
                    setConfirmRemove(false);
                  },
                  onError: notifyError,
                })
              }
            >
              إزالة
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

/** D4 guardians card: each guardian with activation code issuing (+ WhatsApp), primary flag, add / remove. */
export function GuardiansCard({ schoolId, student }: { schoolId: string; student: StudentProfile }) {
  const [adding, setAdding] = useState(false);
  return (
    <Paper withBorder radius="md" p="md" h="100%">
      <Group justify="space-between" mb="sm">
        <Title order={4}>أولياء الأمور</Title>
        <Button size="xs" variant="light" leftSection={<IconUserPlus size={14} />} onClick={() => setAdding(true)}>
          إضافة ولي أمر
        </Button>
      </Group>
      {student.guardians.length === 0 ? (
        <Text size="sm" c="dimmed">
          لا يوجد ولي أمر لهذا الطالب — أضف ولي أمر ليتابع الطالب من التطبيق.
        </Text>
      ) : (
        <Stack gap="sm">
          {student.guardians.map((g, i) => (
            <Stack key={g.userId} gap="sm">
              {i > 0 && <Divider />}
              <GuardianRow
                schoolId={schoolId}
                student={student}
                guardian={g}
                onlyOne={student.guardians.length === 1}
              />
            </Stack>
          ))}
        </Stack>
      )}
      <AddGuardianModal schoolId={schoolId} student={student} opened={adding} onClose={() => setAdding(false)} />
    </Paper>
  );
}

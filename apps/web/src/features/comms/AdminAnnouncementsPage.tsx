import { useState } from 'react';
import {
  ActionIcon,
  Button,
  Grid,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconSend, IconTrash } from '@tabler/icons-react';
import { AUDIENCE_TYPE_LABELS, AUDIENCE_TYPES, type AudienceType } from '@slash/shared';
import { ApiError } from '../../api/client';
import { useScope } from '../../api/hooks';
import type { ScopeClass } from '../../api/types';
import { AdminPage } from '../../components/AdminPage';
import { PageLoader, QueryState } from '../../components/States';
import { notifyError, notifySuccess } from '../../lib/notify';
import { useSchoolId } from '../../lib/params';
import {
  useAnnouncements,
  useCreateAnnouncement,
  useDeleteAnnouncement,
  type StaffAnnouncement,
  type StudentOption,
} from './api';
import { AUDIENCE_COLORS, audiencePreview, dayLabel, localDate } from './format';
import { StudentPicker } from './StudentPicker';

interface ComposeValues {
  audienceType: AudienceType;
  gradeLevelId: string | null;
  classId: string | null;
  student: StudentOption | null;
  title: string;
  body: string;
}

type SelectGroup = { group: string; items: Array<{ value: string; label: string }> };

/** Grade levels and classes of the current year, grouped by stage, for the audience pickers. */
function audienceOptions(classes: ScopeClass[]) {
  const grades: SelectGroup[] = [];
  const sections: SelectGroup[] = [];
  const groupOf = (list: SelectGroup[], stage: string) => {
    let g = list.find((x) => x.group === stage);
    if (!g) list.push((g = { group: stage, items: [] }));
    return g;
  };
  for (const c of classes) {
    const g = groupOf(grades, c.stageName);
    if (!g.items.some((i) => i.value === c.gradeLevelId))
      g.items.push({ value: c.gradeLevelId, label: c.gradeLevelName });
    groupOf(sections, c.stageName).items.push({ value: c.id, label: c.label });
  }
  return { grades, sections };
}

function ComposeForm({ schoolId, classes }: { schoolId: string; classes: ScopeClass[] }) {
  const create = useCreateAnnouncement(schoolId);
  const { grades, sections } = audienceOptions(classes);
  const form = useForm<ComposeValues>({
    initialValues: { audienceType: 'school', gradeLevelId: null, classId: null, student: null, title: '', body: '' },
    validate: {
      gradeLevelId: (v, values) => (values.audienceType === 'grade_level' && !v ? 'اختر الصف الدراسي' : null),
      classId: (v, values) => (values.audienceType === 'class_section' && !v ? 'اختر الفصل' : null),
      student: (v, values) => (values.audienceType === 'student' && !v ? 'اختر الطالب' : null),
      title: (v) => (v.trim() ? null : 'عنوان الإعلان مطلوب'),
      body: (v) => (v.trim() ? null : 'نص الإعلان مطلوب'),
    },
  });
  const v = form.values;
  /** The picked target of the current audience type, its display name and the form field holding it. */
  const targets: Record<AudienceType, { id: string | null; name: string | null; field: keyof ComposeValues | null }> = {
    school: { id: null, name: null, field: null },
    grade_level: {
      id: v.gradeLevelId,
      name: classes.find((c) => c.gradeLevelId === v.gradeLevelId)?.gradeLevelName ?? null,
      field: 'gradeLevelId',
    },
    class_section: { id: v.classId, name: classes.find((c) => c.id === v.classId)?.label ?? null, field: 'classId' },
    student: { id: v.student?.id ?? null, name: v.student?.fullName ?? null, field: 'student' },
  };
  const target = targets[v.audienceType];
  const preview = audiencePreview(v.audienceType, target.name);

  const submit = form.onSubmit((values) =>
    create.mutate(
      {
        title: values.title.trim(),
        body: values.body.trim(),
        audienceType: values.audienceType,
        audienceId: target.id,
      },
      {
        onSuccess: () => {
          notifySuccess('تم إرسال الإعلان');
          form.setValues({ title: '', body: '' });
          form.resetDirty();
        },
        onError: (err) => {
          if (err instanceof ApiError && err.details?.length) {
            const errors: Record<string, string> = {};
            for (const d of err.details) {
              const field = d.path === 'audienceId' ? target.field : d.path;
              if (field && field in values) errors[field] = d.message;
            }
            form.setErrors(errors);
          }
          notifyError(err);
        },
      },
    ),
  );

  return (
    <form onSubmit={submit} noValidate>
      <Stack gap="sm">
        <Select
          label="المستلمون"
          data={AUDIENCE_TYPES.map((t) => ({ value: t, label: AUDIENCE_TYPE_LABELS[t] }))}
          value={v.audienceType}
          onChange={(t) => t && form.setFieldValue('audienceType', t as AudienceType)}
          allowDeselect={false}
          comboboxProps={{ withinPortal: true }}
        />
        {v.audienceType === 'grade_level' && (
          <Select
            label="الصف الدراسي"
            placeholder="اختر الصف الدراسي"
            required
            searchable
            data={grades}
            nothingFoundMessage="لا توجد صفوف"
            comboboxProps={{ withinPortal: true }}
            {...form.getInputProps('gradeLevelId')}
          />
        )}
        {v.audienceType === 'class_section' && (
          <Select
            label="الفصل"
            placeholder="اختر الفصل"
            required
            searchable
            data={sections}
            nothingFoundMessage="لا توجد فصول"
            comboboxProps={{ withinPortal: true }}
            {...form.getInputProps('classId')}
          />
        )}
        {v.audienceType === 'student' && (
          <StudentPicker
            schoolId={schoolId}
            required
            value={v.student}
            onChange={(s) => {
              form.setFieldValue('student', s);
              form.clearFieldError('student');
            }}
            error={form.errors.student as string | undefined}
          />
        )}
        <TextInput label="عنوان الإعلان" required maxLength={200} {...form.getInputProps('title')} />
        <Textarea
          label="نص الإعلان"
          required
          autosize
          minRows={4}
          maxRows={12}
          maxLength={5000}
          {...form.getInputProps('body')}
        />
        {preview && (
          <Text size="sm" c="dimmed">
            سيظهر لأولياء الأمور تحت عنوان:{' '}
            <Text span fw={700} c={AUDIENCE_COLORS[v.audienceType]}>
              {preview}
            </Text>
          </Text>
        )}
        <Group justify="flex-end">
          <Button type="submit" leftSection={<IconSend size={18} />} loading={create.isPending}>
            إرسال
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

function SentItem({ item, onDelete }: { item: StaffAnnouncement; onDelete?: () => void }) {
  return (
    <Paper withBorder radius="md" p="sm">
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
        <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
          <Text size="sm" fw={700} c={AUDIENCE_COLORS[item.audienceType]} style={{ overflowWrap: 'anywhere' }}>
            {item.audienceLabel}
          </Text>
          <Text fw={700} style={{ overflowWrap: 'anywhere' }}>
            {item.title}
          </Text>
          <Text size="sm" lineClamp={4} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {item.body}
          </Text>
          <Text size="xs" c="dimmed">
            {dayLabel(localDate(item.publishedAt))}
            {item.createdByName ? ` · ${item.createdByName}` : ''}
          </Text>
        </Stack>
        {onDelete && (
          <ActionIcon variant="subtle" color="red" aria-label="حذف الإعلان" onClick={onDelete}>
            <IconTrash size={18} />
          </ActionIcon>
        )}
      </Group>
    </Paper>
  );
}

function SentList({ schoolId, canDelete }: { schoolId: string; canDelete: boolean }) {
  const [audienceType, setAudienceType] = useState<AudienceType | null>(null);
  const q = useAnnouncements(schoolId, audienceType);
  const remove = useDeleteAnnouncement(schoolId);
  const [deleting, setDeleting] = useState<StaffAnnouncement | null>(null);
  const items = q.data?.pages.flat() ?? [];

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="flex-end">
        <Title order={4}>الإعلانات المرسلة</Title>
        <Select
          w={200}
          aria-label="تصفية حسب المستلمين"
          placeholder="كل المستلمين"
          data={AUDIENCE_TYPES.map((t) => ({ value: t, label: AUDIENCE_TYPE_LABELS[t] }))}
          value={audienceType}
          onChange={(t) => setAudienceType((t as AudienceType | null) ?? null)}
          clearable
          comboboxProps={{ withinPortal: true }}
        />
      </Group>
      <QueryState query={q} empty="لم يتم إرسال إعلانات بعد" isEmpty={() => items.length === 0}>
        {() => (
          <Stack gap="xs" style={{ opacity: q.isPlaceholderData ? 0.6 : 1 }}>
            {items.map((a) => (
              <SentItem key={a.id} item={a} onDelete={canDelete ? () => setDeleting(a) : undefined} />
            ))}
            {q.hasNextPage && (
              <Button variant="default" onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage}>
                عرض المزيد
              </Button>
            )}
          </Stack>
        )}
      </QueryState>
      <Modal opened={!!deleting} onClose={() => setDeleting(null)} title="حذف الإعلان" centered>
        <Stack gap="sm">
          <Text>هل تريد حذف الإعلان «{deleting?.title}»؟ سيختفي من تطبيق أولياء الأمور.</Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setDeleting(null)}>
              إلغاء
            </Button>
            <Button
              color="red"
              loading={remove.isPending}
              onClick={() =>
                deleting &&
                remove.mutate(deleting.id, {
                  onSuccess: () => {
                    notifySuccess('تم حذف الإعلان');
                    setDeleting(null);
                  },
                  onError: notifyError,
                })
              }
            >
              حذف
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

/** Director's announcements: compose (to everyone, a grade, a class or one guardian) and the sent list. */
export function AdminAnnouncementsPage() {
  const schoolId = useSchoolId();
  const scope = useScope(schoolId);
  const isAdmin = scope.data?.school.roles.includes('admin') ?? false;
  return (
    <AdminPage title="الإعلانات" subtitle="رسائل تصل إلى تطبيق أولياء الأمور">
      {scope.isLoading ? (
        <PageLoader />
      ) : (
        <Grid gutter="md" align="flex-start">
          {isAdmin && (
            <Grid.Col span={{ base: 12, md: 5 }}>
              <Paper withBorder radius="md" p="md">
                <Title order={4} mb="sm">
                  إعلان جديد
                </Title>
                <ComposeForm schoolId={schoolId} classes={scope.data?.classes ?? []} />
              </Paper>
            </Grid.Col>
          )}
          <Grid.Col span={{ base: 12, md: isAdmin ? 7 : 12 }}>
            <Paper withBorder radius="md" p="md">
              <SentList schoolId={schoolId} canDelete={isAdmin} />
            </Paper>
          </Grid.Col>
        </Grid>
      )}
    </AdminPage>
  );
}

import { useState } from 'react';
import {
  Button,
  Grid,
  Group,
  Modal,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { CALENDAR_KIND_LABELS, CALENDAR_KINDS, monthBounds, type CalendarKind } from '@slash/shared';
import { ApiError } from '../../api/client';
import { useScope } from '../../api/hooks';
import { AdminPage } from '../../components/AdminPage';
import { IsoDateInput } from '../../components/IsoDateInput';
import { EmptyState, PageLoader, QueryState } from '../../components/States';
import { dayjs } from '../../lib/dayjs';
import { notifyError, notifySuccess } from '../../lib/notify';
import { useSchoolId } from '../../lib/params';
import { useDeleteEvent, useSaveEvent, useSchoolCalendar, type CalendarEvent } from './api';
import { EventRow, EventsMonth, KindLegend } from './CalendarParts';
import { coversDay, dayLabel, monthTitle } from './format';

interface EventValues {
  title: string;
  kind: CalendarKind;
  startsOn: string | null;
  endsOn: string | null;
  details: string;
}

/** What the modal edits: an existing event, or a new one starting on `day`. */
type Editing = { event: CalendarEvent } | { day: string };

function EventForm({ schoolId, editing, onDone }: { schoolId: string; editing: Editing; onDone: () => void }) {
  const existing = 'event' in editing ? editing.event : null;
  const save = useSaveEvent(schoolId);
  const remove = useDeleteEvent(schoolId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const day = 'day' in editing ? editing.day : null;
  const form = useForm<EventValues>({
    initialValues: {
      title: existing?.title ?? '',
      kind: existing?.kind ?? 'event',
      startsOn: existing?.startsOn ?? day,
      endsOn: existing?.endsOn ?? day,
      details: existing?.details ?? '',
    },
    validate: {
      title: (v) => (v.trim() ? null : 'عنوان الحدث مطلوب'),
      startsOn: (v) => (v ? null : 'اختر تاريخ البداية'),
      endsOn: (v, values) =>
        !v ? 'اختر تاريخ النهاية' : values.startsOn && v < values.startsOn ? 'تاريخ النهاية قبل تاريخ البداية' : null,
    },
  });

  const submit = form.onSubmit((v) =>
    save.mutate(
      {
        id: existing?.id ?? null,
        input: {
          title: v.title.trim(),
          kind: v.kind,
          startsOn: v.startsOn ?? '',
          endsOn: v.endsOn ?? '',
          details: v.details.trim() || null,
        },
      },
      {
        onSuccess: () => {
          notifySuccess(existing ? 'تم تعديل الحدث' : 'تمت إضافة الحدث');
          onDone();
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
    <form onSubmit={submit} noValidate>
      <Stack gap="sm">
        <TextInput label="عنوان الحدث" required maxLength={200} data-autofocus {...form.getInputProps('title')} />
        <div>
          <Text size="sm" fw={500} mb={4}>
            النوع
          </Text>
          <SegmentedControl
            fullWidth
            data={CALENDAR_KINDS.map((k) => ({ value: k, label: CALENDAR_KIND_LABELS[k] }))}
            value={form.values.kind}
            onChange={(k) => form.setFieldValue('kind', k as CalendarKind)}
          />
        </div>
        <Group grow align="flex-start">
          <IsoDateInput
            label="من"
            required
            value={form.values.startsOn}
            onChange={(v) => {
              form.setFieldValue('startsOn', v);
              // Keep the range valid: a start after the end moves the end along.
              if (v && (!form.values.endsOn || form.values.endsOn < v)) form.setFieldValue('endsOn', v);
            }}
            error={form.errors.startsOn}
          />
          <IsoDateInput
            label="إلى"
            required
            minDate={form.values.startsOn ?? undefined}
            value={form.values.endsOn}
            onChange={(v) => form.setFieldValue('endsOn', v)}
            error={form.errors.endsOn}
          />
        </Group>
        <Textarea
          label="التفاصيل"
          placeholder="اختياري"
          autosize
          minRows={2}
          maxRows={8}
          maxLength={2000}
          {...form.getInputProps('details')}
        />
        <Group justify="space-between" mt="xs">
          {existing ? (
            confirmDelete ? (
              <Group gap="xs">
                <Button
                  color="red"
                  loading={remove.isPending}
                  onClick={() =>
                    remove.mutate(existing.id, {
                      onSuccess: () => {
                        notifySuccess('تم حذف الحدث');
                        onDone();
                      },
                      onError: notifyError,
                    })
                  }
                >
                  تأكيد الحذف
                </Button>
                <Button variant="subtle" color="gray" onClick={() => setConfirmDelete(false)}>
                  تراجع
                </Button>
              </Group>
            ) : (
              <Button
                variant="light"
                color="red"
                leftSection={<IconTrash size={16} />}
                onClick={() => setConfirmDelete(true)}
              >
                حذف
              </Button>
            )
          ) : (
            <span />
          )}
          <Group gap="xs">
            <Button variant="default" onClick={onDone}>
              إلغاء
            </Button>
            <Button type="submit" loading={save.isPending}>
              {existing ? 'حفظ التعديل' : 'إضافة'}
            </Button>
          </Group>
        </Group>
      </Stack>
    </form>
  );
}

/** Director's academic calendar: month view with event dots, the month's events, add / edit / delete. */
export function AdminCalendarPage() {
  const schoolId = useSchoolId();
  const scope = useScope(schoolId);
  const today = scope.data?.school.today ?? dayjs().format('YYYY-MM-DD');
  const isAdmin = scope.data?.school.roles.includes('admin') ?? false;
  const [pickedMonth, setPickedMonth] = useState<string | null>(null);
  const month = pickedMonth ?? today.slice(0, 7);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const q = useSchoolCalendar(schoolId, monthBounds(`${month}-01`));
  const events = q.data ?? [];
  const shown = selectedDay ? events.filter((e) => coversDay(e, selectedDay)) : events;
  const newDay = selectedDay ?? (month === today.slice(0, 7) ? today : `${month}-01`);

  return (
    <AdminPage
      title="التقويم الدراسي"
      subtitle="العطلات والفعاليات والامتحانات والاجتماعات كما تظهر لأولياء الأمور"
      actions={
        isAdmin && (
          <Button leftSection={<IconPlus size={18} />} onClick={() => setEditing({ day: newDay })}>
            إضافة حدث
          </Button>
        )
      }
    >
      {scope.isLoading ? (
        <PageLoader />
      ) : (
        <Grid gutter="md" align="flex-start">
          <Grid.Col span={{ base: 12, md: 5 }}>
            <Paper withBorder radius="md" p="md">
              <EventsMonth
                month={month}
                onMonthChange={(m) => {
                  setSelectedDay(null);
                  setPickedMonth(m);
                }}
                events={events}
                selectedDay={selectedDay}
                onSelectDay={setSelectedDay}
                today={today}
              />
              <KindLegend />
            </Paper>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 7 }}>
            <Paper withBorder radius="md" p="md">
              <Group justify="space-between" mb="sm">
                <Title order={4}>{selectedDay ? `أحداث ${dayLabel(selectedDay)}` : `أحداث ${monthTitle(month)}`}</Title>
                {selectedDay && (
                  <Button variant="subtle" size="compact-sm" onClick={() => setSelectedDay(null)}>
                    كل الشهر
                  </Button>
                )}
              </Group>
              <QueryState query={q}>
                {() =>
                  shown.length === 0 ? (
                    <EmptyState message={selectedDay ? 'لا توجد أحداث في هذا اليوم' : 'لا توجد أحداث في هذا الشهر'} />
                  ) : (
                    <Stack gap="xs" style={{ opacity: q.isPlaceholderData ? 0.6 : 1 }}>
                      {shown.map((e) => (
                        <EventRow key={e.id} event={e} onClick={isAdmin ? () => setEditing({ event: e }) : undefined} />
                      ))}
                    </Stack>
                  )
                }
              </QueryState>
            </Paper>
          </Grid.Col>
        </Grid>
      )}
      <Modal
        opened={!!editing}
        onClose={() => setEditing(null)}
        title={editing && 'event' in editing ? 'تعديل الحدث' : 'إضافة حدث'}
        centered
        size="lg"
      >
        {editing && (
          <EventForm
            key={'event' in editing ? editing.event.id : `new:${editing.day}`}
            schoolId={schoolId}
            editing={editing}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
    </AdminPage>
  );
}

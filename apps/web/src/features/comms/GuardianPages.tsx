import { useEffect, useState } from 'react';
import { Badge, Button, Group, Paper, Stack, Text } from '@mantine/core';
import { IconCalendar, IconSpeakerphone } from '@tabler/icons-react';
import { useSearchParams } from 'react-router';
import { useStudentSummary } from '../../api/hooks';
import { MobilePage } from '../../components/MobilePage';
import { EmptyState, QueryState } from '../../components/States';
import { dayjs } from '../../lib/dayjs';
import { useStudentId } from '../../lib/params';
import { useGuardianAnnouncements, useGuardianCalendar, type GuardianAnnouncement } from './api';
import { EventRow, EventsMonth, KindLegend } from './CalendarParts';
import { AUDIENCE_COLORS, coversDay, dayLabel, isMonth, localDate, monthTitle } from './format';

// ───────────────────────────── P16 — announcements ─────────────────────────────

function AnnouncementCard({ announcement, isNew }: { announcement: GuardianAnnouncement; isNew: boolean }) {
  return (
    <Paper withBorder radius="md" p="md" style={isNew ? { borderColor: 'var(--mantine-color-red-3)' } : undefined}>
      <Stack gap={6}>
        <Group justify="space-between" wrap="nowrap">
          <Group gap={4} c="dimmed" wrap="nowrap">
            <IconCalendar size={14} />
            <Text size="sm">{dayLabel(localDate(announcement.publishedAt))}</Text>
          </Group>
          {isNew && (
            <Badge color="red" variant="filled" size="sm" style={{ flexShrink: 0 }}>
              جديد
            </Badge>
          )}
        </Group>
        <Text fw={700} c={AUDIENCE_COLORS[announcement.audienceType]} style={{ overflowWrap: 'anywhere' }}>
          {announcement.audienceLabel}
        </Text>
        <Text fw={700} size="lg" lh={1.35} style={{ overflowWrap: 'anywhere' }}>
          {announcement.title}
        </Text>
        <Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {announcement.body}
        </Text>
      </Stack>
    </Paper>
  );
}

/** P16 — messages to this guardian, to the student's grade or class, or to everyone. Newest first. */
export function GuardianAnnouncementsPage() {
  const studentId = useStudentId();
  const q = useGuardianAnnouncements(studentId);
  // Opening the list marks everything seen, so a later refetch (e.g. on window focus) would drop the "جديد"
  // marks while the guardian is still reading: keep the ones that were new when the screen opened.
  const [fresh, setFresh] = useState<Set<string> | null>(null);
  const { data, isFetchedAfterMount } = q;
  useEffect(() => {
    if (fresh || !isFetchedAfterMount || !data) return;
    setFresh(new Set(data.filter((a) => a.isNew).map((a) => a.id)));
  }, [fresh, isFetchedAfterMount, data]);
  return (
    <MobilePage title="الإعلانات">
      <QueryState query={q} empty="لا توجد إعلانات بعد" isEmpty={(list) => list.length === 0}>
        {(list) => (
          <Stack gap="sm">
            {list.map((a) => (
              <AnnouncementCard
                key={a.id}
                announcement={a}
                isNew={!!fresh?.has(a.id) || (!fresh && isFetchedAfterMount && a.isNew)}
              />
            ))}
          </Stack>
        )}
      </QueryState>
    </MobilePage>
  );
}

// ───────────────────────────── P15 — academic calendar ─────────────────────────────

/** `?month=YYYY-MM` in the URL so the month survives going back; defaults to the school's current month. */
function useMonthParam(fallback: string): [string, (month: string) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('month');
  const month = isMonth(raw) ? raw : fallback;
  const setMonth = (next: string) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        out.set('month', next);
        return out;
      },
      { replace: true },
    );
  return [month, setMonth];
}

/** P15 — month view with event dots, the month's events, then what is coming up in the next 30 days. */
export function GuardianCalendarPage() {
  const studentId = useStudentId();
  // The shell has already loaded the summary; the browser date is only a fallback.
  const today = useStudentSummary(studentId).data?.school.today ?? dayjs().format('YYYY-MM-DD');
  const [month, setMonth] = useMonthParam(today.slice(0, 7));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const q = useGuardianCalendar(studentId, month);
  const events = q.data?.events ?? [];
  const shown = selectedDay ? events.filter((e) => coversDay(e, selectedDay)) : events;
  const listed = new Set(events.map((e) => e.id));
  const upcoming = (q.data?.upcoming ?? []).filter((e) => !listed.has(e.id));

  return (
    <MobilePage title="التقويم الدراسي">
      <Stack gap="md">
        <Paper withBorder radius="lg" p="xs">
          <EventsMonth
            month={month}
            onMonthChange={(m) => {
              setSelectedDay(null);
              setMonth(m);
            }}
            events={events}
            selectedDay={selectedDay}
            onSelectDay={setSelectedDay}
            today={today}
          />
          <KindLegend />
        </Paper>

        <Group justify="space-between" wrap="nowrap">
          <Text fw={700}>{selectedDay ? `أحداث ${dayLabel(selectedDay)}` : `أحداث شهر ${monthTitle(month)}`}</Text>
          {selectedDay && (
            <Button variant="subtle" size="compact-sm" onClick={() => setSelectedDay(null)}>
              كل الشهر
            </Button>
          )}
        </Group>
        <QueryState query={q}>
          {() =>
            shown.length === 0 ? (
              <EmptyState
                message={selectedDay ? 'لا توجد أحداث في هذا اليوم' : 'لا توجد أحداث في هذا الشهر'}
                icon={<IconSpeakerphone size={36} stroke={1.5} />}
              />
            ) : (
              <Stack gap="sm" style={{ opacity: q.isPlaceholderData ? 0.6 : 1 }}>
                {shown.map((e) => (
                  <EventRow key={e.id} event={e} />
                ))}
              </Stack>
            )
          }
        </QueryState>

        {!selectedDay && upcoming.length > 0 && (
          <Stack gap="sm">
            <Text fw={700}>الأحداث القادمة</Text>
            {upcoming.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </Stack>
        )}
      </Stack>
    </MobilePage>
  );
}

import type { ReactNode } from 'react';
import { Box, Group, Paper, Stack, Text, UnstyledButton } from '@mantine/core';
import { Calendar } from '@mantine/dates';
import { CALENDAR_KIND_LABELS, CALENDAR_KINDS, type CalendarKind } from '@slash/shared';
import type { CalendarEvent } from './api';
import { eventDates, KIND_COLORS, kindsByDay, monthName } from './format';

const MAX_DOTS = 3;

function Dot({ kind, size = 6 }: { kind: CalendarKind; size?: number }) {
  return (
    <Box
      component="span"
      w={size}
      h={size}
      style={{ borderRadius: '50%', background: `var(--mantine-color-${KIND_COLORS[kind]}-6)`, flexShrink: 0 }}
    />
  );
}

/**
 * A full-width month (P15) with small coloured dots under the days that have events. Navigating months
 * calls `onMonthChange('YYYY-MM')`; tapping a day toggles it as the selected day.
 */
export function EventsMonth({
  month,
  onMonthChange,
  events,
  selectedDay,
  onSelectDay,
  today,
}: {
  month: string;
  onMonthChange: (month: string) => void;
  events: CalendarEvent[];
  selectedDay: string | null;
  onSelectDay: (day: string | null) => void;
  today?: string;
}) {
  const dots = kindsByDay(events, month);
  return (
    <Calendar
      date={`${month}-01`}
      onDateChange={(d) => onMonthChange(String(d).slice(0, 7))}
      maxLevel="year"
      size="md"
      getDayProps={(date) => ({
        selected: date === selectedDay,
        onClick: () => {
          // A day of the previous/next month shown around the grid: move there first.
          if (!date.startsWith(month)) onMonthChange(date.slice(0, 7));
          onSelectDay(date === selectedDay ? null : date);
        },
        style:
          date === today && date !== selectedDay
            ? { outline: '1px solid var(--mantine-primary-color-filled)', outlineOffset: -2 }
            : undefined,
      })}
      renderDay={(date) => {
        const kinds = date.startsWith(month) ? (dots.get(date) ?? []) : [];
        return (
          <Stack gap={3} align="center" justify="center" style={{ lineHeight: 1 }}>
            <span>{Number(date.slice(8, 10))}</span>
            <Group gap={2} justify="center" h={6} wrap="nowrap">
              {kinds.slice(0, MAX_DOTS).map((k) => (
                <Dot key={k} kind={k} />
              ))}
            </Group>
          </Stack>
        );
      }}
      ariaLabels={{
        nextMonth: 'الشهر التالي',
        previousMonth: 'الشهر السابق',
        monthLevelControl: 'اختيار الشهر',
        nextYear: 'السنة التالية',
        previousYear: 'السنة السابقة',
        yearLevelControl: 'اختيار السنة',
      }}
      styles={{
        levelsGroup: { display: 'block' },
        calendarHeader: { maxWidth: 'none' },
        month: { width: '100%' },
        day: { width: '100%', height: 48 },
        monthsList: { width: '100%' },
        monthsListControl: { width: '100%' },
      }}
    />
  );
}

/** Colour key for the calendar dots. */
export function KindLegend() {
  return (
    <Group gap="md" justify="center" mt="xs">
      {CALENDAR_KINDS.map((k) => (
        <Group key={k} gap={6} wrap="nowrap">
          <Dot kind={k} size={8} />
          <Text size="xs" c="dimmed">
            {CALENDAR_KIND_LABELS[k]}
          </Text>
        </Group>
      ))}
    </Group>
  );
}

/** Coloured circle with the day number and month name (as in the reference calendar). */
function DateCircle({ event }: { event: CalendarEvent }) {
  const color = KIND_COLORS[event.kind];
  return (
    <Stack
      gap={0}
      align="center"
      justify="center"
      w={56}
      h={56}
      style={{
        borderRadius: '50%',
        flexShrink: 0,
        background: `var(--mantine-color-${color}-0)`,
        border: `2px solid var(--mantine-color-${color}-6)`,
      }}
    >
      <Text fw={700} fz={20} lh={1} c={`${color}.8`}>
        {Number(event.startsOn.slice(8, 10))}
      </Text>
      <Text fz={10} lh={1.3} c={`${color}.8`}>
        {monthName(event.startsOn)}
      </Text>
    </Stack>
  );
}

/** One event in a list: date circle, title, kind and dates. Clickable when `onClick` is given (director). */
export function EventRow({ event, onClick, aside }: { event: CalendarEvent; onClick?: () => void; aside?: ReactNode }) {
  const body = (
    <Paper withBorder radius="md" p="sm">
      <Group wrap="nowrap" align="center" gap="sm">
        <DateCircle event={event} />
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Text fw={700} lh={1.35} style={{ overflowWrap: 'anywhere' }}>
            {event.title}
          </Text>
          <Group gap={6} wrap="nowrap">
            <Dot kind={event.kind} size={8} />
            <Text size="sm" c={`${KIND_COLORS[event.kind]}.8`} fw={600}>
              {CALENDAR_KIND_LABELS[event.kind]}
            </Text>
          </Group>
          <Text size="xs" c="dimmed">
            {eventDates(event)}
          </Text>
          {event.details && (
            <Text size="sm" mt={2} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {event.details}
            </Text>
          )}
        </Stack>
        {aside}
      </Group>
    </Paper>
  );
  if (!onClick) return body;
  return (
    <UnstyledButton onClick={onClick} display="block" w="100%" aria-label={`تعديل ${event.title}`}>
      {body}
    </UnstyledButton>
  );
}

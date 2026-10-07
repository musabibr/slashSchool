import { useState, type ReactNode } from 'react';
import { Badge, Button, Checkbox, Group, Modal, Paper, Stack, Text } from '@mantine/core';
import { IconCalendar, IconPencil } from '@tabler/icons-react';
import { Link, useParams, useSearchParams } from 'react-router';
import { formatDate, type DateRange } from '@slash/shared';
import { useStudentSummary } from '../../api/hooks';
import { MobilePage } from '../../components/MobilePage';
import { RangeFilter } from '../../components/RangeFilter';
import { QueryState } from '../../components/States';
import { Tile, TileGrid } from '../../components/Tiles';
import { useStudentId } from '../../lib/params';
import { AttachmentGallery } from './Attachments';
import { dayLabel, emptyMessage, parseRange } from './format';
import {
  guardianKeys,
  useGuardianHomework,
  useGuardianLessons,
  useGuardianSubjects,
  useToggleHomework,
} from './queries';
import type { GuardianHomework, GuardianLesson, LessonModule } from './types';

const MODULE_TITLES: Record<LessonModule, string> = { lessons: 'الدروس', homework: 'الواجبات' };

/** `?range=` in the URL so the filter survives going back from another screen; P5/P7 default to this week. */
function useRangeParam(fallback: DateRange): [DateRange, (range: DateRange) => void] {
  const [params, setParams] = useSearchParams();
  const range = parseRange(params.get('range'), fallback);
  const setRange = (next: DateRange) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        out.set('range', next);
        return out;
      },
      { replace: true },
    );
  return [range, setRange];
}

/** "Label: value" line used on lesson and homework cards. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
      <Text span fw={600}>
        {label}:{' '}
      </Text>
      {children}
    </Text>
  );
}

function DateLine({ iso }: { iso: string }) {
  return (
    <Group gap={4} c="dimmed" wrap="nowrap">
      <IconCalendar size={14} />
      <Text size="sm">{dayLabel(iso)}</Text>
    </Group>
  );
}

function NewBadge() {
  return (
    <Badge color="red" variant="filled" size="sm" style={{ flexShrink: 0 }}>
      جديد
    </Badge>
  );
}

// ───────────────────────────── P4 / P6 — subjects ─────────────────────────────

function SubjectsGridPage({ module }: { module: LessonModule }) {
  const studentId = useStudentId();
  const summary = useStudentSummary(studentId);
  const subjects = useGuardianSubjects(studentId, module, { fresh: true });
  const noClass = summary.data ? !summary.data.student.classLabel : false;
  return (
    <MobilePage title={MODULE_TITLES[module]}>
      <QueryState
        query={subjects}
        empty={noClass ? 'لم يتم تسكين الطالب في فصل بعد' : 'لا توجد مواد لهذا الفصل بعد'}
        isEmpty={(list) => list.length === 0}
      >
        {(list) => (
          <TileGrid>
            {list.map((s) => (
              <Tile
                key={s.id}
                label={s.name}
                to={`/g/${studentId}/${module}/${s.id}`}
                badge={s.badge}
                hint={s.lastDate ? formatDate(s.lastDate) : undefined}
              />
            ))}
          </TileGrid>
        )}
      </QueryState>
    </MobilePage>
  );
}

/** P4 — the class subjects, each with its unread-lessons badge. */
export function LessonsSubjectsPage() {
  return <SubjectsGridPage module="lessons" />;
}

/** P6 — same grid for homework. */
export function HomeworkSubjectsPage() {
  return <SubjectsGridPage module="homework" />;
}

/** Subject name for the list title (cached from the grid; fetched when the list is opened directly). */
function useSubjectName(studentId: string, module: LessonModule, subjectId: string) {
  const subjects = useGuardianSubjects(studentId, module);
  return subjects.data?.find((s) => s.id === subjectId)?.name;
}

// ───────────────────────────── P5 — lessons of one subject ─────────────────────────────

function LessonCard({ lesson, onHomework }: { lesson: GuardianLesson; onHomework: () => void }) {
  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap={6}>
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Text fw={700} size="lg" lh={1.35} style={{ overflowWrap: 'anywhere' }}>
            {lesson.title}
          </Text>
          {lesson.isNew && <NewBadge />}
        </Group>
        <DateLine iso={lesson.date} />
        {lesson.pages && <Field label="الصفحة">{lesson.pages}</Field>}
        {lesson.details && <Field label="التفاصيل">{lesson.details}</Field>}
        <AttachmentGallery attachments={lesson.attachments} />
        <Button
          mt={4}
          fullWidth
          color="orange"
          variant={lesson.hasHomework ? 'filled' : 'default'}
          leftSection={<IconPencil size={18} />}
          disabled={!lesson.hasHomework}
          onClick={onHomework}
        >
          واجب منزلي
        </Button>
      </Stack>
    </Paper>
  );
}

function HomeworkModal({
  studentId,
  lesson,
  onClose,
}: {
  studentId: string;
  lesson: GuardianLesson | null;
  onClose: () => void;
}) {
  return (
    <Modal opened={!!lesson} onClose={onClose} title="واجب منزلي" centered>
      {lesson && (
        <Stack gap="sm">
          <Text fw={700}>{lesson.title}</Text>
          <Field label="تفاصيل الواجب">{lesson.homeworkDetails ?? ''}</Field>
          {lesson.homeworkDueDate && <Field label="موعد التسليم">{dayLabel(lesson.homeworkDueDate)}</Field>}
          <Button
            component={Link}
            to={`/g/${studentId}/homework/${lesson.subjectId}?range=all`}
            variant="light"
            leftSection={<IconPencil size={16} />}
          >
            الذهاب إلى الواجبات
          </Button>
        </Stack>
      )}
    </Modal>
  );
}

export function LessonsListPage() {
  const studentId = useStudentId();
  const { subjectId = '' } = useParams();
  const [range, setRange] = useRangeParam('week');
  const subjectName = useSubjectName(studentId, 'lessons', subjectId);
  const lessons = useGuardianLessons(studentId, subjectId, range);
  const [homeworkOf, setHomeworkOf] = useState<GuardianLesson | null>(null);
  return (
    <MobilePage title={subjectName ?? MODULE_TITLES.lessons}>
      <Stack gap="md">
        <RangeFilter value={range} onChange={setRange} />
        <QueryState query={lessons} empty={emptyMessage('lessons', range)} isEmpty={(list) => list.length === 0}>
          {(list) => (
            <Stack gap="sm" style={{ opacity: lessons.isPlaceholderData ? 0.6 : 1 }}>
              {list.map((lesson) => (
                <LessonCard key={lesson.id} lesson={lesson} onHomework={() => setHomeworkOf(lesson)} />
              ))}
            </Stack>
          )}
        </QueryState>
      </Stack>
      <HomeworkModal studentId={studentId} lesson={homeworkOf} onClose={() => setHomeworkOf(null)} />
    </MobilePage>
  );
}

// ───────────────────────────── P7 — homework of one subject ─────────────────────────────

function HomeworkCard({
  homework,
  today,
  disabled,
  onToggle,
}: {
  homework: GuardianHomework;
  today: string | undefined;
  disabled: boolean;
  onToggle: (done: boolean) => void;
}) {
  const { done } = homework;
  const overdue = !done && !!today && !!homework.homeworkDueDate && homework.homeworkDueDate < today;
  return (
    <Paper
      withBorder
      radius="md"
      p="md"
      bg={done ? 'green.0' : 'red.0'}
      style={{ borderColor: done ? 'var(--mantine-color-green-4)' : 'var(--mantine-color-red-3)' }}
    >
      <Stack gap={6}>
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
            <Group gap="xs" wrap="nowrap" align="flex-start">
              <Text fw={700} size="lg" lh={1.35} style={{ overflowWrap: 'anywhere' }}>
                {homework.title}
              </Text>
              {homework.isNew && <NewBadge />}
            </Group>
            <DateLine iso={homework.date} />
          </Stack>
          <Checkbox
            size="lg"
            color="green"
            label="تم"
            checked={done}
            disabled={disabled}
            onChange={(e) => onToggle(e.currentTarget.checked)}
            styles={{ label: { fontWeight: 700 } }}
          />
        </Group>
        <Field label="تفاصيل الواجب">{homework.homeworkDetails ?? ''}</Field>
        {homework.homeworkDueDate && (
          <Group gap="xs">
            <Field label="موعد التسليم">{dayLabel(homework.homeworkDueDate)}</Field>
            {overdue && (
              <Badge color="red" size="sm">
                متأخر
              </Badge>
            )}
          </Group>
        )}
        <AttachmentGallery attachments={homework.attachments} />
      </Stack>
    </Paper>
  );
}

export function HomeworkListPage() {
  const studentId = useStudentId();
  const { subjectId = '' } = useParams();
  const [range, setRange] = useRangeParam('week');
  const subjectName = useSubjectName(studentId, 'homework', subjectId);
  const today = useStudentSummary(studentId).data?.school.today;
  const homework = useGuardianHomework(studentId, subjectId, range);
  const toggle = useToggleHomework(studentId, guardianKeys.list(studentId, 'homework', subjectId, range));
  return (
    <MobilePage title={subjectName ?? MODULE_TITLES.homework}>
      <Stack gap="md">
        <RangeFilter value={range} onChange={setRange} />
        <QueryState query={homework} empty={emptyMessage('homework', range)} isEmpty={(list) => list.length === 0}>
          {(list) => (
            <Stack gap="sm" style={{ opacity: homework.isPlaceholderData ? 0.6 : 1 }}>
              {list.map((h) => (
                <HomeworkCard
                  key={h.id}
                  homework={h}
                  today={today}
                  disabled={homework.isPlaceholderData}
                  onToggle={(done) => toggle.mutate({ lessonId: h.id, done })}
                />
              ))}
            </Stack>
          )}
        </QueryState>
      </Stack>
    </MobilePage>
  );
}

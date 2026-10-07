import type { ReactNode } from 'react';
import { Badge, Group, Paper, Stack, Table, Text, UnstyledButton } from '@mantine/core';
import { IconCalendar, IconCalendarEvent, IconChevronLeft, IconSpeakerphone } from '@tabler/icons-react';
import { Link, useParams } from 'react-router';
import { ASSESSMENT_KIND_LABELS, formatDate, WEEKDAY_LABELS } from '@slash/shared';
import { useStudentSummary } from '../../api/hooks';
import { MobilePage } from '../../components/MobilePage';
import { QueryState } from '../../components/States';
import { Tile, TileGrid } from '../../components/Tiles';
import { useStudentId } from '../../lib/params';
import { useGuardianExams, useResultSheet, useStudentResults } from './api';
import { dayLabel, scoreOf } from './format';
import { ResultSheetView } from './ResultSheetView';
import type { GuardianExamTimetable, GuardianQuiz, ResultItem } from './types';

/** "Label: value" line used on the cards. */
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

/** "الدرجة: 15 من 30" in a green strip. */
function ScoreStrip({ score, maxScore }: { score: number; maxScore: number }) {
  return (
    <Paper radius="sm" px="sm" py={6} bg="teal.0" style={{ border: '1px solid var(--mantine-color-teal-3)' }}>
      <Text fw={700} c="teal.9">
        الدرجة: {scoreOf(score, maxScore)}
      </Text>
    </Paper>
  );
}

function useToday(studentId: string): string | undefined {
  return useStudentSummary(studentId).data?.school.today;
}

// ───────────────────────────── P10 — exams hub ─────────────────────────────

/** P10 — "إعلانات الإختبارات" and "جدول الإمتحانات". */
export function GuardianExamsHubPage() {
  const studentId = useStudentId();
  const today = useToday(studentId);
  const exams = useGuardianExams(studentId);
  const upcoming = today ? (exams.data?.quizzes.filter((q) => q.date >= today).length ?? 0) : 0;
  const tables = exams.data?.timetables.length ?? 0;
  return (
    <MobilePage title="الإمتحانات">
      <TileGrid cols={2}>
        <Tile
          label="إعلانات الإختبارات"
          to={`/g/${studentId}/exams/quizzes`}
          icon={<IconSpeakerphone size={30} stroke={1.5} color="var(--mantine-color-cyan-8)" />}
          hint={upcoming ? `${upcoming} اختبار قادم` : undefined}
        />
        <Tile
          label="جدول الإمتحانات"
          to={`/g/${studentId}/exams/timetable`}
          icon={<IconCalendarEvent size={30} stroke={1.5} color="var(--mantine-color-cyan-8)" />}
          hint={tables ? `${tables} جدول` : undefined}
        />
      </TileGrid>
    </MobilePage>
  );
}

// ───────────────────────────── P11 — quiz announcements ─────────────────────────────

function QuizCard({ quiz, today }: { quiz: GuardianQuiz; today: string | undefined }) {
  const heading = `إختبار مادة ${quiz.subjectName}`;
  const isToday = !!today && quiz.date === today;
  const upcoming = !!today && quiz.date > today;
  return (
    <Paper
      withBorder
      radius="md"
      p="md"
      style={upcoming || isToday ? { borderColor: 'var(--mantine-color-orange-4)' } : undefined}
    >
      <Stack gap={6}>
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Text fw={700} size="lg" lh={1.35} style={{ overflowWrap: 'anywhere' }}>
            {heading}
          </Text>
          {isToday ? (
            <Badge color="orange" variant="filled" style={{ flexShrink: 0 }}>
              اليوم
            </Badge>
          ) : upcoming ? (
            <Badge color="orange" variant="light" style={{ flexShrink: 0 }}>
              قادم
            </Badge>
          ) : null}
        </Group>
        {quiz.title !== heading && (
          <Text fw={600} c="cyan.9" style={{ overflowWrap: 'anywhere' }}>
            {quiz.title}
          </Text>
        )}
        <DateLine iso={quiz.date} />
        {quiz.details && <Field label="التفاصيل">{quiz.details}</Field>}
        {quiz.score !== null ? (
          <ScoreStrip score={quiz.score} maxScore={quiz.maxScore} />
        ) : (
          <Text size="sm" c="dimmed">
            الدرجة النهائية: {quiz.maxScore}
            {!upcoming && !isToday ? ' — لم تُرصد الدرجة بعد' : ''}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

/** P11 — the class's quiz announcements, newest first, with the score once graded. */
export function GuardianQuizzesPage() {
  const studentId = useStudentId();
  const today = useToday(studentId);
  const exams = useGuardianExams(studentId);
  return (
    <MobilePage title="إعلانات الإختبارات">
      <QueryState query={exams} empty="لا توجد إعلانات اختبارات بعد" isEmpty={(d) => d.quizzes.length === 0}>
        {(d) => (
          <Stack gap="sm">
            {d.quizzes.map((q) => (
              <QuizCard key={q.id} quiz={q} today={today} />
            ))}
          </Stack>
        )}
      </QueryState>
    </MobilePage>
  );
}

// ───────────────────────────── Exam timetable ─────────────────────────────

function ExamTimetableCard({ timetable, today }: { timetable: GuardianExamTimetable; today: string | undefined }) {
  const last = timetable.rows[timetable.rows.length - 1]?.date;
  const done = !!today && !!last && last < today;
  return (
    <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
      <Group justify="space-between" px="md" py="sm" wrap="nowrap" bg="gray.0">
        <Text fw={700} style={{ overflowWrap: 'anywhere' }}>
          {timetable.name}
        </Text>
        <Badge variant="light" color={done ? 'gray' : 'cyan'} style={{ flexShrink: 0 }}>
          {done ? 'انتهت' : ASSESSMENT_KIND_LABELS[timetable.kind]}
        </Badge>
      </Group>
      <Table verticalSpacing="xs" horizontalSpacing="sm" fz="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>المادة</Table.Th>
            <Table.Th>اليوم</Table.Th>
            <Table.Th>التاريخ</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {timetable.rows.map((row) => (
            <Table.Tr key={`${row.subjectName}:${row.date}`} bg={today === row.date ? 'orange.0' : undefined}>
              <Table.Td fw={600}>{row.subjectName}</Table.Td>
              <Table.Td>{WEEKDAY_LABELS[row.weekday]}</Table.Td>
              <Table.Td>{formatDate(row.date)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}

/** "جدول الإمتحانات" — one table per exam period of the student's class. */
export function GuardianExamTimetablePage() {
  const studentId = useStudentId();
  const today = useToday(studentId);
  const exams = useGuardianExams(studentId);
  return (
    <MobilePage title="جدول الإمتحانات">
      <QueryState query={exams} empty="لم يُنشر جدول امتحانات بعد" isEmpty={(d) => d.timetables.length === 0}>
        {(d) => (
          <Stack gap="md">
            {d.timetables.map((tt) => (
              <ExamTimetableCard key={tt.periodId} timetable={tt} today={today} />
            ))}
          </Stack>
        )}
      </QueryState>
    </MobilePage>
  );
}

// ───────────────────────────── P12 — results list ─────────────────────────────

function ResultCard({ item, studentId }: { item: ResultItem; studentId: string }) {
  if (item.type === 'quiz') {
    return (
      <Paper withBorder radius="md" p="md">
        <Stack gap={6}>
          <Text fw={700} style={{ overflowWrap: 'anywhere' }}>
            إختبار مادة {item.subjectName}
          </Text>
          <Text size="sm" c="cyan.9" style={{ overflowWrap: 'anywhere' }}>
            {item.title}
          </Text>
          <DateLine iso={item.date} />
          <ScoreStrip score={item.score} maxScore={item.maxScore} />
        </Stack>
      </Paper>
    );
  }
  return (
    <UnstyledButton component={Link} to={`/g/${studentId}/results/${item.id}`} display="block" aria-label={item.name}>
      <Paper withBorder radius="md" p="md" style={{ borderInlineStart: '4px solid var(--mantine-color-cyan-6)' }}>
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Stack gap={4} style={{ minWidth: 0 }}>
            <Text fw={700} style={{ overflowWrap: 'anywhere' }}>
              {item.name}
            </Text>
            <Group gap={6}>
              <Badge variant="light" color="cyan">
                {ASSESSMENT_KIND_LABELS[item.kind]}
              </Badge>
              {!item.published && (
                <Badge variant="light" color="orange">
                  غير منشورة
                </Badge>
              )}
            </Group>
            {item.date && <DateLine iso={item.date} />}
          </Stack>
          <IconChevronLeft size={20} color="var(--mantine-color-gray-6)" style={{ flexShrink: 0 }} />
        </Group>
      </Paper>
    </UnstyledButton>
  );
}

/** P12 — result sheets and graded quizzes, newest first. */
export function GuardianResultsPage() {
  const studentId = useStudentId();
  const results = useStudentResults(studentId, { refreshBadges: true });
  return (
    <MobilePage title="النتائج">
      <QueryState query={results} empty="لا توجد نتائج منشورة بعد" isEmpty={(list) => list.length === 0}>
        {(list) => (
          <Stack gap="sm">
            {list.map((item) => (
              <ResultCard key={`${item.type}:${item.id}`} item={item} studentId={studentId} />
            ))}
          </Stack>
        )}
      </QueryState>
    </MobilePage>
  );
}

// ───────────────────────────── P13 — result sheet ─────────────────────────────

/** P13 — one exam period's result sheet. */
export function GuardianResultSheetPage() {
  const studentId = useStudentId();
  const { periodId = '' } = useParams();
  const sheet = useResultSheet(studentId, periodId);
  return (
    <MobilePage title={sheet.data?.period.name ?? 'النتائج'} backTo={`/g/${studentId}/results`}>
      <QueryState query={sheet}>{(data) => <ResultSheetView sheet={data} />}</QueryState>
    </MobilePage>
  );
}

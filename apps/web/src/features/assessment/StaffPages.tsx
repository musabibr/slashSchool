import type { ReactNode } from 'react';
import { Badge, Button, Divider, Group, Paper, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconCalendarPlus, IconListNumbers, IconPlus, IconSpeakerphone } from '@tabler/icons-react';
import { Link, useSearchParams } from 'react-router';
import { useScope } from '../../api/hooks';
import { qs } from '../../api/client';
import { ClassSubjectSelect } from '../../components/ClassSubjectSelect';
import { MobilePage } from '../../components/MobilePage';
import { QueryState } from '../../components/States';
import { useSchoolId } from '../../lib/params';
import { useAssessments } from './api';
import { dayLabel } from './format';
import type { Assessment } from './types';

/** Exam timetables and publishing are for admins and supervisors. */
export function useCanManageExams(schoolId: string): boolean {
  const roles = useScope(schoolId).data?.school.roles ?? [];
  return roles.includes('admin') || roles.includes('supervisor');
}

/** Link to grade entry (S14) preselected on one assessment. */
export function gradesLink(schoolId: string, a: Pick<Assessment, 'id' | 'classSectionId' | 'subjectId'>): string {
  return `/s/${schoolId}/grades${qs({ classId: a.classSectionId, subjectId: a.subjectId, assessmentId: a.id })}`;
}

function HubButton({
  to,
  icon,
  children,
  variant,
}: {
  to: string;
  icon: ReactNode;
  children: string;
  variant: string;
}) {
  return (
    <Button
      component={Link}
      to={to}
      variant={variant}
      h={96}
      size="xl"
      radius="lg"
      fullWidth
      leftSection={icon}
      styles={{ label: { fontSize: 'var(--mantine-font-size-lg)', whiteSpace: 'normal', lineHeight: 1.3 } }}
    >
      {children}
    </Button>
  );
}

/** Status of a quiz for staff: upcoming, or how many students were graded. */
function QuizProgress({ quiz, today }: { quiz: Assessment; today: string | undefined }) {
  if (today && quiz.date > today && quiz.scoredCount === 0) {
    return (
      <Badge color="orange" variant="light">
        قادم
      </Badge>
    );
  }
  const complete = quiz.studentCount > 0 && quiz.scoredCount >= quiz.studentCount;
  return (
    <Badge color={complete ? 'teal' : quiz.scoredCount ? 'blue' : 'gray'} variant="light">
      تم رصد {quiz.scoredCount}/{quiz.studentCount}
    </Badge>
  );
}

/** A quiz announcement in the staff list: tap → edit (S13); "رصد الدرجات" → S14. */
function QuizCard({ schoolId, quiz, today }: { schoolId: string; quiz: Assessment; today: string | undefined }) {
  return (
    <Paper withBorder radius="md" p="sm">
      <UnstyledButton
        component={Link}
        to={`/s/${schoolId}/exams/quizzes/${quiz.id}`}
        display="block"
        w="100%"
        aria-label={`تعديل ${quiz.title}`}
      >
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Badge variant="light" radius="sm" size="lg" style={{ flexShrink: 0 }}>
            {quiz.classLabel}
          </Badge>
          <Text size="sm" fw={600} c="cyan.9" truncate>
            {quiz.subjectName}
          </Text>
        </Group>
        <Text fw={700} mt={6} style={{ overflowWrap: 'anywhere' }}>
          {quiz.title}
        </Text>
        {quiz.details && (
          <Text size="sm" c="dimmed" lineClamp={2} style={{ overflowWrap: 'anywhere' }}>
            {quiz.details}
          </Text>
        )}
      </UnstyledButton>
      <Group justify="space-between" mt={6} gap="xs">
        <Text size="sm" c="dimmed">
          {dayLabel(quiz.date)} · من {quiz.maxScore}
        </Text>
        <Group gap={6}>
          <QuizProgress quiz={quiz} today={today} />
          <Button
            component={Link}
            to={gradesLink(schoolId, quiz)}
            size="compact-xs"
            variant="subtle"
            leftSection={<IconListNumbers size={14} />}
          >
            رصد الدرجات
          </Button>
        </Group>
      </Group>
    </Paper>
  );
}

/** S11 — exams hub: exam timetables (admins/supervisors) and quiz announcements. */
export function StaffExamsHubPage() {
  const schoolId = useSchoolId();
  const canManage = useCanManageExams(schoolId);
  const today = useScope(schoolId).data?.school.today;
  const quizzes = useAssessments(schoolId, { kind: 'quiz' });
  const upcoming = today
    ? (quizzes.data ?? [])
        .filter((q) => q.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 5)
    : [];
  return (
    <MobilePage title={canManage ? 'الإمتحانات' : 'الاختبارات'}>
      <Stack gap="md">
        {canManage && (
          <HubButton to={`/s/${schoolId}/exams/timetable`} icon={<IconCalendarPlus size={28} />} variant="filled">
            اضافة/تعديل جدول إمتحان
          </HubButton>
        )}
        <HubButton
          to={`/s/${schoolId}/exams/quizzes`}
          icon={<IconSpeakerphone size={28} />}
          variant={canManage ? 'light' : 'filled'}
        >
          إعلانات الإختبارات
        </HubButton>
        <Button
          component={Link}
          to={`/s/${schoolId}/grades`}
          variant="default"
          size="md"
          leftSection={<IconListNumbers size={20} />}
        >
          رصد الدرجات
        </Button>
        {upcoming.length > 0 && (
          <Stack gap="xs">
            <Divider label="الاختبارات القادمة" labelPosition="center" />
            {upcoming.map((q) => (
              <QuizCard key={q.id} schoolId={schoolId} quiz={q} today={today} />
            ))}
          </Stack>
        )}
      </Stack>
    </MobilePage>
  );
}

/** Quiz announcements in my scope, newest first, with optional class/subject filters. */
export function StaffQuizzesPage() {
  const schoolId = useSchoolId();
  const today = useScope(schoolId).data?.school.today;
  const [params, setParams] = useSearchParams();
  const classId = params.get('classId');
  const subjectId = params.get('subjectId');
  const quizzes = useAssessments(schoolId, { kind: 'quiz', classId, subjectId });
  const filtered = !!classId || !!subjectId;
  const newPath = `/s/${schoolId}/exams/quizzes/new${qs({ classId, subjectId })}`;

  const setFilters = (next: { classId: string | null; subjectId: string | null }) => {
    const out = new URLSearchParams();
    if (next.classId) out.set('classId', next.classId);
    if (next.subjectId) out.set('subjectId', next.subjectId);
    setParams(out, { replace: true });
  };

  return (
    <MobilePage title="إعلانات الإختبارات" backTo={`/s/${schoolId}/exams`}>
      <Stack gap="md">
        <Button component={Link} to={newPath} size="md" leftSection={<IconPlus size={20} />}>
          اضافة اعلان اختبار
        </Button>
        <ClassSubjectSelect
          schoolId={schoolId}
          classId={classId}
          subjectId={subjectId}
          onChange={setFilters}
          clearable
        />
        <QueryState
          query={quizzes}
          empty={filtered ? 'لا توجد اختبارات مطابقة' : 'لم تتم إضافة إعلانات اختبارات بعد'}
          isEmpty={(list) => list.length === 0}
        >
          {(list) => (
            <Stack gap="sm" style={{ opacity: quizzes.isPlaceholderData ? 0.6 : 1 }}>
              {list.map((q) => (
                <QuizCard key={q.id} schoolId={schoolId} quiz={q} today={today} />
              ))}
            </Stack>
          )}
        </QueryState>
      </Stack>
    </MobilePage>
  );
}

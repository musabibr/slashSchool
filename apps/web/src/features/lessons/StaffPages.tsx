import type { ReactNode } from 'react';
import { Badge, Button, Group, Paper, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import { IconHistory, IconPaperclip, IconPlus } from '@tabler/icons-react';
import { Link, useSearchParams } from 'react-router';
import { useScope } from '../../api/hooks';
import { ClassSubjectSelect } from '../../components/ClassSubjectSelect';
import { MobilePage } from '../../components/MobilePage';
import { QueryState } from '../../components/States';
import { useSchoolId } from '../../lib/params';
import { dayLabel } from './format';
import { useStaffLessons } from './queries';
import type { StaffLesson } from './types';

/** Admins and supervisors see every teacher's lessons, so the author is worth showing. */
function useSeesWholeSchool(schoolId: string) {
  const roles = useScope(schoolId).data?.school.roles ?? [];
  return roles.includes('admin') || roles.includes('supervisor');
}

/** A lesson in the staff lists (S6): class, subject, title, date, homework progress. Tap → edit (S7). */
function StaffLessonCard({
  schoolId,
  lesson,
  showTeacher,
}: {
  schoolId: string;
  lesson: StaffLesson;
  showTeacher: boolean;
}) {
  return (
    <UnstyledButton
      component={Link}
      to={`/s/${schoolId}/lessons/${lesson.id}`}
      display="block"
      aria-label={`تعديل ${lesson.title}`}
    >
      <Paper withBorder radius="md" p="sm">
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Badge variant="light" radius="sm" size="lg" style={{ flexShrink: 0 }}>
            {lesson.classLabel}
          </Badge>
          <Text size="sm" fw={600} c="cyan.9" truncate>
            {lesson.subjectName}
          </Text>
        </Group>
        <Text fw={700} mt={6} style={{ overflowWrap: 'anywhere' }}>
          {lesson.title}
        </Text>
        <Group justify="space-between" mt={4} gap="xs">
          <Text size="sm" c="dimmed">
            {dayLabel(lesson.date)}
          </Text>
          <Group gap={8}>
            {lesson.attachments.length > 0 && (
              <Group gap={2} c="dimmed" aria-label={`${lesson.attachments.length} مرفقات`}>
                <IconPaperclip size={14} />
                <Text size="xs">{lesson.attachments.length}</Text>
              </Group>
            )}
            {lesson.hasHomework && (
              <Badge color="orange" variant="light">
                واجب · تم {lesson.homeworkDoneCount}/{lesson.studentCount}
              </Badge>
            )}
          </Group>
        </Group>
        {showTeacher && lesson.teacherName && (
          <Text size="xs" c="dimmed" mt={4}>
            {lesson.teacherName}
          </Text>
        )}
      </Paper>
    </UnstyledButton>
  );
}

function HubButton({ to, icon, children, variant }: { to: string; icon: ReactNode; children: string; variant: string }) {
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
      styles={{ label: { fontSize: 'var(--mantine-font-size-lg)' } }}
    >
      {children}
    </Button>
  );
}

function TodayLessons({ schoolId, today }: { schoolId: string; today: string }) {
  const showTeacher = useSeesWholeSchool(schoolId);
  const lessons = useStaffLessons(schoolId, { classId: null, subjectId: null, from: today, to: today }, 50);
  const list = lessons.data?.pages.flat() ?? [];
  if (lessons.isLoading || lessons.error || !list.length) return null;
  return (
    <Stack gap="xs" mt="sm">
      <Title order={6}>دروس اليوم ({list.length})</Title>
      {list.map((l) => (
        <StaffLessonCard key={l.id} schoolId={schoolId} lesson={l} showTeacher={showTeacher} />
      ))}
    </Stack>
  );
}

/** S4 / T3 — "درس اليوم": add a new lesson or browse previous ones. */
export function StaffLessonsHubPage() {
  const schoolId = useSchoolId();
  const today = useScope(schoolId).data?.school.today;
  return (
    <MobilePage title="درس اليوم">
      <Stack gap="md">
        <HubButton to={`/s/${schoolId}/lessons/new`} icon={<IconPlus size={28} />} variant="filled">
          إضافة درس جديد
        </HubButton>
        <HubButton to={`/s/${schoolId}/lessons/list`} icon={<IconHistory size={28} />} variant="light">
          الدروس السابقة
        </HubButton>
        {today && <TodayLessons schoolId={schoolId} today={today} />}
      </Stack>
    </MobilePage>
  );
}

/** S6 / T5 — previous lessons, newest first, with optional class/subject filters. */
export function StaffLessonsListPage() {
  const schoolId = useSchoolId();
  const showTeacher = useSeesWholeSchool(schoolId);
  const [params, setParams] = useSearchParams();
  const classId = params.get('classId');
  const subjectId = params.get('subjectId');
  const lessons = useStaffLessons(schoolId, { classId, subjectId });
  const list = lessons.data?.pages.flat();
  const filtered = !!classId || !!subjectId;

  const setFilters = (next: { classId: string | null; subjectId: string | null }) => {
    const out = new URLSearchParams();
    if (next.classId) out.set('classId', next.classId);
    if (next.subjectId) out.set('subjectId', next.subjectId);
    setParams(out, { replace: true });
  };

  return (
    <MobilePage
      title="الدروس السابقة"
      actions={
        <Button
          component={Link}
          to={`/s/${schoolId}/lessons/new`}
          size="xs"
          variant="light"
          leftSection={<IconPlus size={14} />}
        >
          درس جديد
        </Button>
      }
    >
      <Stack gap="md">
        <ClassSubjectSelect
          schoolId={schoolId}
          classId={classId}
          subjectId={subjectId}
          onChange={setFilters}
          clearable
        />
        <QueryState
          query={{ data: list, isLoading: lessons.isLoading, error: lessons.error, refetch: lessons.refetch }}
          empty={filtered ? 'لا توجد دروس مطابقة' : 'لم تتم إضافة دروس بعد'}
          isEmpty={(l) => l.length === 0}
        >
          {(items) => (
            <Stack gap="sm" style={{ opacity: lessons.isPlaceholderData ? 0.6 : 1 }}>
              {items.map((l) => (
                <StaffLessonCard key={l.id} schoolId={schoolId} lesson={l} showTeacher={showTeacher} />
              ))}
              {lessons.hasNextPage && (
                <Button variant="default" onClick={() => lessons.fetchNextPage()} loading={lessons.isFetchingNextPage}>
                  عرض المزيد
                </Button>
              )}
            </Stack>
          )}
        </QueryState>
      </Stack>
    </MobilePage>
  );
}

import { useState } from 'react';
import { Accordion, Badge, Group, Paper, Stack, Table, Text, Title } from '@mantine/core';
import { IconReportAnalytics } from '@tabler/icons-react';
import { ASSESSMENT_KIND_LABELS, formatDate } from '@slash/shared';
import { EmptyState, QueryState } from '../../components/States';
import { useResultSheet, useStudentResults } from './api';
import { formatScore, scoreOf } from './format';
import { ResultSheetView } from './ResultSheetView';
import type { ResultItem } from './types';

type PeriodItem = Extract<ResultItem, { type: 'period' }>;
type QuizItem = Extract<ResultItem, { type: 'quiz' }>;

/** Loads a sheet only once its accordion item has been opened. */
function PeriodSheet({ studentId, periodId, opened }: { studentId: string; periodId: string; opened: boolean }) {
  const sheet = useResultSheet(studentId, periodId, opened);
  if (!opened && !sheet.data) return null;
  return <QueryState query={sheet}>{(data) => <ResultSheetView sheet={data} />}</QueryState>;
}

function PeriodSummary({ studentId, item }: { studentId: string; item: PeriodItem }) {
  // Cached after the first expand, so the header can show the percentage and grade.
  const sheet = useResultSheet(studentId, item.id, false).data;
  return (
    <Group justify="space-between" wrap="nowrap" gap="sm" pe="sm">
      <Stack gap={2} style={{ minWidth: 0 }}>
        <Text fw={700} truncate>
          {item.name}
        </Text>
        <Group gap={6}>
          <Badge variant="light" color="cyan" size="sm">
            {ASSESSMENT_KIND_LABELS[item.kind]}
          </Badge>
          {!item.published && (
            <Badge variant="light" color="orange" size="sm">
              غير منشورة لأولياء الأمور
            </Badge>
          )}
          {item.date && (
            <Text size="xs" c="dimmed">
              {formatDate(item.date)}
            </Text>
          )}
        </Group>
      </Stack>
      {sheet && sheet.max > 0 && (
        <Text fw={700} style={{ flexShrink: 0 }}>
          {formatScore(sheet.total)}/{sheet.max} · {sheet.percentage}% · {sheet.grade}
        </Text>
      )}
    </Group>
  );
}

function QuizTable({ quizzes }: { quizzes: QuizItem[] }) {
  return (
    <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
      <Table striped verticalSpacing="xs" fz="sm">
        <Table.Thead bg="gray.1">
          <Table.Tr>
            <Table.Th>المادة</Table.Th>
            <Table.Th>الاختبار</Table.Th>
            <Table.Th>التاريخ</Table.Th>
            <Table.Th ta="center">الدرجة</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {quizzes.map((q) => (
            <Table.Tr key={q.id}>
              <Table.Td fw={600}>{q.subjectName}</Table.Td>
              <Table.Td>{q.title}</Table.Td>
              <Table.Td>{formatDate(q.date)}</Table.Td>
              <Table.Td ta="center" fw={700}>
                {scoreOf(q.score, q.maxScore)}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}

/**
 * Admin student profile (D4 "النتائج"): every exam period of the student (unpublished ones flagged), each
 * expandable to the full result sheet, then the graded quizzes. Staff viewing does not clear guardian badges.
 */
export function StudentResultsPanel({ studentId }: { studentId: string }) {
  const results = useStudentResults(studentId);
  const [opened, setOpened] = useState<string[]>([]);
  return (
    <QueryState query={results}>
      {(items) => {
        const periods = items.filter((i): i is PeriodItem => i.type === 'period');
        const quizzes = items.filter((i): i is QuizItem => i.type === 'quiz');
        if (!items.length) {
          return (
            <EmptyState message="لا توجد نتائج لهذا الطالب بعد" icon={<IconReportAnalytics size={36} stroke={1.5} />} />
          );
        }
        return (
          <Stack gap="md">
            {periods.length > 0 && (
              <Stack gap="xs">
                <Title order={5}>نتائج الامتحانات</Title>
                <Accordion multiple variant="separated" radius="md" value={opened} onChange={setOpened}>
                  {periods.map((p) => (
                    <Accordion.Item key={p.id} value={p.id}>
                      <Accordion.Control>
                        <PeriodSummary studentId={studentId} item={p} />
                      </Accordion.Control>
                      <Accordion.Panel>
                        <PeriodSheet studentId={studentId} periodId={p.id} opened={opened.includes(p.id)} />
                      </Accordion.Panel>
                    </Accordion.Item>
                  ))}
                </Accordion>
              </Stack>
            )}
            {quizzes.length > 0 && (
              <Stack gap="xs">
                <Title order={5}>درجات الاختبارات</Title>
                <QuizTable quizzes={quizzes} />
              </Stack>
            )}
          </Stack>
        );
      }}
    </QueryState>
  );
}

import type { ReactNode } from 'react';
import { ActionIcon, Badge, Button, Group, Modal, Paper, Select, Stack, Text, Tooltip } from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import { EVALUATION_RATING_LABELS, EVALUATION_RATINGS, formatDate, type EvaluationRating } from '@slash/shared';
import type { Regulation, StudentEvaluation } from './api';

/** Badge colors of the evaluation ratings (P14, S17). */
export const RATING_COLORS: Record<EvaluationRating, string> = {
  excellent: 'green',
  calm: 'teal',
  needs_attention: 'yellow',
  disruptive: 'red',
};

export const RATING_OPTIONS = EVALUATION_RATINGS.map((r) => ({ value: r, label: EVALUATION_RATING_LABELS[r] }));

export function RatingBadge({ rating }: { rating: EvaluationRating }) {
  return (
    <Badge color={RATING_COLORS[rating]} variant="light" size="lg" radius="sm" style={{ flexShrink: 0 }}>
      {EVALUATION_RATING_LABELS[rating]}
    </Badge>
  );
}

export function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Paper withBorder radius="lg" p="md">
      <Stack gap={4} align="center">
        <Text size="sm" c="dimmed" ta="center" lh={1.3}>
          {label}
        </Text>
        <Text fw={700} fz={32} c="red.7" lh={1}>
          {value}
        </Text>
      </Stack>
    </Paper>
  );
}

/** "اللائحة: …" style line; skipped when there is no value. */
function Line({ label, value, color }: { label: string; value: string | null; color?: string }) {
  if (!value) return null;
  return (
    <Text size="sm" c={color} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
      <Text span fw={700} inherit>
        {label}:
      </Text>{' '}
      {value}
    </Text>
  );
}

/**
 * One incident card (P14): date, regulation, details and penalty. Staff views add the student
 * (`heading`), who recorded it (`footer`) and a delete action.
 */
export function IncidentCard({
  date,
  regulationTitle,
  details,
  penalty,
  heading,
  footer,
  onDelete,
}: {
  date: string;
  regulationTitle: string;
  details: string | null;
  penalty: string | null;
  heading?: ReactNode;
  footer?: ReactNode;
  onDelete?: () => void;
}) {
  return (
    <Paper withBorder radius="md" p="sm">
      <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs" mb={4}>
        <Stack gap={0} style={{ minWidth: 0 }}>
          {heading}
          <Text fw={700} size="sm" c={heading ? 'dimmed' : undefined} dir="ltr" ta="right">
            {formatDate(date)}
          </Text>
        </Stack>
        <Group gap={6} wrap="nowrap">
          {!penalty && (
            <Badge color="gray" variant="light">
              بدون عقوبة
            </Badge>
          )}
          {onDelete && (
            <Tooltip label="حذف المخالفة">
              <ActionIcon variant="subtle" color="red" onClick={onDelete} aria-label="حذف المخالفة">
                <IconTrash size={18} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Group>
      <Stack gap={2}>
        <Line label="اللائحة" value={regulationTitle} />
        <Line label="التفاصيل" value={details} />
        <Line label="العقوبة" value={penalty} color="red.8" />
        {footer}
      </Stack>
    </Paper>
  );
}

/** "تقييم المعلمين" entries: subject + date, the rating badge, the comment and the teacher. */
export function EvaluationList({ items }: { items: StudentEvaluation[] }) {
  return (
    <Stack gap="xs">
      {items.map((e, i) => (
        <Paper key={`${e.date}:${e.subjectName}:${i}`} withBorder radius="md" p="sm">
          <Group justify="space-between" wrap="nowrap" gap="xs" align="flex-start">
            <Stack gap={0} style={{ minWidth: 0 }}>
              <Text fw={700} size="sm" truncate>
                {e.subjectName}
              </Text>
              <Text size="xs" c="dimmed">
                {formatDate(e.date)}
                {e.teacherName ? ` — ${e.teacherName}` : ''}
              </Text>
            </Stack>
            <RatingBadge rating={e.rating} />
          </Group>
          {e.comment && (
            <Text size="sm" mt={6} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {e.comment}
            </Text>
          )}
        </Paper>
      ))}
    </Stack>
  );
}

export function regulationLabel(r: Pick<Regulation, 'code' | 'title'>): string {
  return r.code ? `${r.code}. ${r.title}` : r.title;
}

/** "اختر اللائحة" picker; `onPick` receives the whole regulation so callers can pre-fill its penalty. */
export function RegulationSelect({
  regulations,
  value,
  onPick,
  error,
  loading = false,
}: {
  regulations: Regulation[];
  value: string | null;
  onPick: (regulation: Regulation | null) => void;
  error?: ReactNode;
  loading?: boolean;
}) {
  return (
    <Select
      label="اللائحة"
      placeholder="اختر اللائحة"
      data={regulations.map((r) => ({ value: r.id, label: regulationLabel(r) }))}
      value={value}
      onChange={(id) => onPick(regulations.find((r) => r.id === id) ?? null)}
      searchable
      required
      disabled={loading}
      nothingFoundMessage="لا توجد لوائح"
      error={error}
      comboboxProps={{ withinPortal: true }}
    />
  );
}

/** Small "are you sure" dialog for deletions. */
export function ConfirmDialog({
  opened,
  title,
  message,
  confirmLabel = 'حذف',
  loading,
  onConfirm,
  onClose,
}: {
  opened: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal opened={opened} onClose={onClose} title={title} centered size="sm">
      <Stack>
        <Text size="sm">{message}</Text>
        <Group grow>
          <Button color="red" loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
          <Button variant="default" onClick={onClose} disabled={loading}>
            إلغاء
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

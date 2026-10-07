import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Collapse,
  Group,
  Modal,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconCalendarRepeat,
  IconChartBar,
  IconEdit,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import { useSearchParams } from 'react-router';
import { formatDate, WEEKDAY_LABELS, weekdayOf, type ExamPeriodKind } from '@slash/shared';
import { useScope } from '../../api/hooks';
import type { ScopeClass } from '../../api/types';
import { IsoDateInput } from '../../components/IsoDateInput';
import { MobilePage } from '../../components/MobilePage';
import { EmptyState, PageLoader, QueryState } from '../../components/States';
import { notifyError, notifySuccess } from '../../lib/notify';
import { useSchoolId } from '../../lib/params';
import {
  useCreatePeriod,
  useDeletePeriod,
  usePeriodResults,
  usePeriods,
  usePeriodTimetable,
  usePublishPeriod,
  useSaveTimetable,
  useUpdatePeriod,
} from './api';
import {
  defaultPeriodName,
  formatScore,
  gradeColor,
  PERIOD_KIND_OPTIONS,
  PERIOD_KIND_SHORT,
  schoolDays,
} from './format';
import { useCanManageExams } from './StaffPages';
import type { ExamPeriod, PeriodTimetable } from './types';

const MAX_SCORE_LIMIT = 1000;
const DEFAULT_MAX: Record<ExamPeriodKind, number> = { weekly: 20, monthly: 50, term: 100, final: 100 };

interface Row {
  subjectId: string;
  subjectName: string;
  date: string | null;
  /** Number, or the raw text while typing. */
  maxScore: number | string;
}

const signature = (rows: Row[]) =>
  rows
    .filter((r) => r.date)
    .map((r) => `${r.subjectId}:${r.date}:${r.maxScore}`)
    .sort()
    .join('|');

const validMax = (v: number | string) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_SCORE_LIMIT;

/** Grade levels (and their classes) offered by the user's scope. */
function useGrades(schoolId: string) {
  const classes = useScope(schoolId).data?.classes;
  return useMemo(() => {
    const map = new Map<string, { id: string; name: string; classes: ScopeClass[] }>();
    for (const c of classes ?? []) {
      const g = map.get(c.gradeLevelId) ?? { id: c.gradeLevelId, name: c.gradeLevelName, classes: [] };
      g.classes.push(c);
      map.set(c.gradeLevelId, g);
    }
    return [...map.values()];
  }, [classes]);
}

// ───────────────────────────── New period ─────────────────────────────

function NewPeriodForm({
  schoolId,
  gradeLevelId,
  onCreated,
  onCancel,
}: {
  schoolId: string;
  gradeLevelId: string;
  onCreated: (period: ExamPeriod) => void;
  onCancel?: () => void;
}) {
  const today = useScope(schoolId).data?.school.today;
  const create = useCreatePeriod(schoolId);
  const [kind, setKind] = useState<ExamPeriodKind>('monthly');
  const [name, setName] = useState(() => defaultPeriodName('monthly', today));
  const [touched, setTouched] = useState(false);

  const submit = () => {
    if (!name.trim()) {
      setTouched(true);
      return;
    }
    create.mutate(
      { gradeLevelId, kind, name: name.trim() },
      {
        onSuccess: (period) => {
          notifySuccess('تم إنشاء جدول الامتحان');
          onCreated(period);
        },
        onError: notifyError,
      },
    );
  };

  return (
    <Paper withBorder radius="md" p="sm">
      <Stack gap="sm">
        <Text fw={700}>جدول امتحان جديد</Text>
        <div>
          <Text size="sm" fw={500} mb={4}>
            نوع الامتحان
          </Text>
          <SegmentedControl
            fullWidth
            data={PERIOD_KIND_OPTIONS}
            value={kind}
            onChange={(v) => {
              const next = v as ExamPeriodKind;
              setKind(next);
              if (!touched) setName(defaultPeriodName(next, today));
            }}
          />
        </div>
        <TextInput
          label="اسم الامتحان"
          required
          maxLength={200}
          value={name}
          error={touched && !name.trim() ? 'اسم الامتحان مطلوب' : undefined}
          onChange={(e) => {
            setTouched(true);
            setName(e.currentTarget.value);
          }}
        />
        <Group grow>
          <Button onClick={submit} loading={create.isPending} leftSection={<IconPlus size={18} />}>
            إنشاء
          </Button>
          {onCancel && (
            <Button variant="default" onClick={onCancel}>
              إلغاء
            </Button>
          )}
        </Group>
      </Stack>
    </Paper>
  );
}

// ───────────────────────────── Period settings (rename / delete) ─────────────────────────────

function PeriodSettingsModal({
  schoolId,
  period,
  opened,
  onClose,
  onDeleted,
}: {
  schoolId: string;
  period: ExamPeriod;
  opened: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const update = useUpdatePeriod(schoolId);
  const remove = useDeletePeriod(schoolId);
  const [name, setName] = useState(period.name);
  const [kind, setKind] = useState<ExamPeriodKind>(period.kind);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (opened) {
      setName(period.name);
      setKind(period.kind);
      setConfirm(false);
    }
  }, [opened, period.name, period.kind]);

  return (
    <Modal opened={opened} onClose={onClose} title="تعديل الامتحان" centered>
      <Stack gap="sm">
        <SegmentedControl
          fullWidth
          data={PERIOD_KIND_OPTIONS}
          value={kind}
          onChange={(v) => setKind(v as ExamPeriodKind)}
        />
        <TextInput
          label="اسم الامتحان"
          required
          maxLength={200}
          value={name}
          error={!name.trim() ? 'اسم الامتحان مطلوب' : undefined}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <Button
          loading={update.isPending}
          disabled={!name.trim()}
          onClick={() =>
            update.mutate(
              { id: period.id, name: name.trim(), kind },
              {
                onSuccess: () => {
                  notifySuccess('تم تعديل الامتحان');
                  onClose();
                },
                onError: notifyError,
              },
            )
          }
        >
          حفظ
        </Button>
        {period.hasScores ? (
          <Text size="xs" c="dimmed">
            لا يمكن حذف هذا الامتحان لأنه تم رصد درجات فيه.
          </Text>
        ) : confirm ? (
          <Alert color="red" variant="light" p="sm">
            <Text size="sm" mb="xs">
              سيُحذف «{period.name}» وجدوله من صفحات أولياء الأمور. هل أنت متأكد؟
            </Text>
            <Group justify="flex-end" gap="xs">
              <Button size="xs" variant="default" onClick={() => setConfirm(false)}>
                إلغاء
              </Button>
              <Button
                size="xs"
                color="red"
                loading={remove.isPending}
                onClick={() =>
                  remove.mutate(period.id, {
                    onSuccess: () => {
                      notifySuccess('تم حذف الامتحان');
                      onDeleted();
                    },
                    onError: notifyError,
                  })
                }
              >
                حذف
              </Button>
            </Group>
          </Alert>
        ) : (
          <Button color="red" variant="subtle" leftSection={<IconTrash size={16} />} onClick={() => setConfirm(true)}>
            حذف الامتحان
          </Button>
        )}
      </Stack>
    </Modal>
  );
}

// ───────────────────────────── Timetable rows ─────────────────────────────

function TimetableForm({
  schoolId,
  timetable,
  gradeClasses,
}: {
  schoolId: string;
  timetable: PeriodTimetable;
  gradeClasses: ScopeClass[];
}) {
  const today = useScope(schoolId).data?.school.today ?? null;
  const save = useSaveTimetable(schoolId);
  const { period } = timetable;
  const defaultMax = timetable.rows[0]?.maxScore ?? DEFAULT_MAX[period.kind];

  const initialRows = useMemo<Row[]>(() => {
    const saved = new Map(timetable.rows.map((r) => [r.subjectId, r]));
    const subjects = new Map<string, string>();
    for (const c of gradeClasses) for (const s of c.subjects) if (!subjects.has(s.id)) subjects.set(s.id, s.name);
    for (const r of timetable.rows) if (!subjects.has(r.subjectId)) subjects.set(r.subjectId, r.subjectName);
    return [...subjects].map(([subjectId, subjectName]) => ({
      subjectId,
      subjectName,
      date: saved.get(subjectId)?.date ?? null,
      maxScore: saved.get(subjectId)?.maxScore ?? defaultMax,
    }));
  }, [timetable.rows, gradeClasses, defaultMax]);

  const [rows, setRows] = useState<Row[]>(initialRows);
  const [baseline, setBaseline] = useState(() => signature(initialRows));
  const [showErrors, setShowErrors] = useState(false);
  const [quickStart, setQuickStart] = useState<string | null>(timetable.rows[0]?.date ?? today);
  const [quickMax, setQuickMax] = useState<number | string>(defaultMax);
  const dirty = signature(rows) !== baseline;
  const included = rows.filter((r) => r.date);

  const update = (subjectId: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.subjectId === subjectId ? { ...r, ...patch } : r)));

  /** One subject per school day from the chosen date, and the same max score for every subject. */
  const quickFill = () => {
    if (!quickStart) return;
    const days = schoolDays(quickStart, rows.length);
    setRows((prev) =>
      prev.map((r, i) => ({ ...r, date: days[i], maxScore: validMax(quickMax) ? quickMax : r.maxScore })),
    );
  };

  const submit = () => {
    if (included.some((r) => !validMax(r.maxScore))) {
      setShowErrors(true);
      return;
    }
    save.mutate(
      {
        periodId: period.id,
        rows: included.map((r) => ({ subjectId: r.subjectId, date: r.date ?? '', maxScore: Number(r.maxScore) })),
      },
      {
        onSuccess: (saved) => {
          const savedRows = new Map(saved.rows.map((r) => [r.subjectId, r]));
          const next = rows.map((r) => ({
            ...r,
            date: savedRows.get(r.subjectId)?.date ?? null,
            maxScore: savedRows.get(r.subjectId)?.maxScore ?? r.maxScore,
          }));
          setRows(next);
          setBaseline(signature(next));
          setShowErrors(false);
          notifySuccess('تم حفظ جدول الامتحان');
        },
        onError: notifyError,
      },
    );
  };

  if (!rows.length) return <EmptyState message="لا توجد مواد لهذا الصف بعد" />;

  return (
    <Stack gap="sm">
      <Paper withBorder radius="md" p="sm" bg="gray.0">
        <Text size="sm" fw={600} mb={6}>
          تعبئة سريعة
        </Text>
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <IsoDateInput label="أول يوم" size="xs" style={{ flex: 1 }} value={quickStart} onChange={setQuickStart} />
          <NumberInput
            label="الدرجة النهائية"
            size="xs"
            w={92}
            min={1}
            max={MAX_SCORE_LIMIT}
            allowDecimal={false}
            allowNegative={false}
            inputMode="numeric"
            value={quickMax}
            onChange={setQuickMax}
          />
          <Button size="xs" variant="light" leftSection={<IconCalendarRepeat size={14} />} onClick={quickFill}>
            تطبيق
          </Button>
        </Group>
        <Text size="xs" c="dimmed" mt={4}>
          مادة في كل يوم دراسي (بدون الجمعة والسبت)، بنفس الدرجة النهائية.
        </Text>
      </Paper>

      {rows.map((row) => {
        const maxError = showErrors && row.date && !validMax(row.maxScore);
        return (
          <Paper key={row.subjectId} withBorder radius="md" p="xs" style={row.date ? undefined : { opacity: 0.75 }}>
            <Group justify="space-between" wrap="nowrap" mb={6}>
              <Text fw={700} truncate>
                {row.subjectName}
              </Text>
              {row.date ? (
                <Badge variant="light" color="cyan" style={{ flexShrink: 0 }}>
                  {WEEKDAY_LABELS[weekdayOf(row.date)]}
                </Badge>
              ) : (
                <Badge variant="light" color="gray" style={{ flexShrink: 0 }}>
                  بدون امتحان
                </Badge>
              )}
            </Group>
            <Group gap="xs" wrap="nowrap" align="flex-start">
              <IsoDateInput
                aria-label={`تاريخ امتحان ${row.subjectName}`}
                placeholder="اختر التاريخ"
                clearable
                style={{ flex: 1 }}
                value={row.date}
                onChange={(date) => update(row.subjectId, { date })}
              />
              <NumberInput
                aria-label={`الدرجة النهائية لـ ${row.subjectName}`}
                w={92}
                min={1}
                max={MAX_SCORE_LIMIT}
                allowDecimal={false}
                allowNegative={false}
                hideControls
                inputMode="numeric"
                leftSection={
                  <Text size="xs" c="dimmed">
                    من
                  </Text>
                }
                value={row.maxScore}
                error={maxError ? true : undefined}
                onChange={(maxScore) => update(row.subjectId, { maxScore })}
              />
            </Group>
            {maxError && (
              <Text c="red" size="xs" mt={4}>
                الدرجة النهائية من 1 إلى {MAX_SCORE_LIMIT}
              </Text>
            )}
          </Paper>
        );
      })}
      {dirty && (
        <Text size="xs" c="orange.8" ta="center">
          لم يتم حفظ التغييرات بعد
        </Text>
      )}
      <Button fullWidth size="md" loading={save.isPending} onClick={submit}>
        اضافة/تحديث
      </Button>
      <Text size="xs" c="dimmed" ta="center">
        {included.length} مادة في الجدول. يظهر الجدول لأولياء أمور {gradeClasses.map((c) => c.label).join('، ')} بعد
        الحفظ.
      </Text>
    </Stack>
  );
}

// ───────────────────────────── Publishing & results review ─────────────────────────────

function PublishSwitch({ schoolId, period }: { schoolId: string; period: ExamPeriod }) {
  const publish = usePublishPeriod(schoolId);
  const published = !!period.resultsPublishedAt;
  return (
    <Paper withBorder radius="md" p="sm">
      <Switch
        size="md"
        label="نشر النتائج لأولياء الأمور"
        checked={published}
        disabled={publish.isPending || (!published && period.subjectCount === 0)}
        description={
          published
            ? `منشورة منذ ${formatDate(period.resultsPublishedAt?.slice(0, 10))}`
            : period.subjectCount === 0
              ? 'أضف جدول الامتحان أولاً'
              : 'النتائج مخفية عن أولياء الأمور حتى النشر'
        }
        onChange={(e) =>
          publish.mutate(
            { periodId: period.id, published: e.currentTarget.checked },
            {
              onSuccess: (p) => notifySuccess(p.resultsPublishedAt ? 'تم نشر النتائج' : 'تم إخفاء النتائج'),
              onError: notifyError,
            },
          )
        }
      />
    </Paper>
  );
}

function ResultsReview({
  schoolId,
  period,
  gradeClasses,
}: {
  schoolId: string;
  period: ExamPeriod;
  gradeClasses: ScopeClass[];
}) {
  const [open, setOpen] = useState(false);
  const [classId, setClassId] = useState<string | null>(gradeClasses[0]?.id ?? null);
  const results = usePeriodResults(schoolId, period.id, classId, open);
  return (
    <Paper withBorder radius="md" p="sm">
      <Button
        variant="subtle"
        fullWidth
        justify="space-between"
        leftSection={<IconChartBar size={18} />}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? 'إخفاء مراجعة النتائج' : 'مراجعة النتائج قبل النشر'}
      </Button>
      <Collapse in={open}>
        <Stack gap="xs" mt="xs">
          <Select
            label="الفصل"
            data={gradeClasses.map((c) => ({ value: c.id, label: c.label }))}
            value={classId}
            onChange={setClassId}
            allowDeselect={false}
            comboboxProps={{ withinPortal: true }}
          />
          {open && (
            <QueryState query={results} empty="لا يوجد طلاب في هذا الفصل" isEmpty={(d) => d.students.length === 0}>
              {(data) => (
                <Stack gap={6} style={{ opacity: results.isPlaceholderData ? 0.6 : 1 }}>
                  {[...data.students]
                    .sort((a, b) => b.percentage - a.percentage || a.fullName.localeCompare(b.fullName, 'ar'))
                    .map((s) => (
                      <Group key={s.id} justify="space-between" wrap="nowrap" gap="xs">
                        <Text size="sm" truncate style={{ minWidth: 0 }}>
                          {s.fullName}
                        </Text>
                        <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
                          <Text size="sm" fw={600}>
                            {formatScore(s.total)}/{s.max}
                          </Text>
                          {s.max > 0 ? (
                            <Badge variant="light" color={gradeColor(s.percentage)}>
                              {s.percentage}% {s.grade}
                            </Badge>
                          ) : (
                            <Badge variant="light" color="gray">
                              لم ترصد
                            </Badge>
                          )}
                          {s.incomplete && s.max > 0 && (
                            <Badge variant="outline" color="orange" size="xs">
                              ناقصة
                            </Badge>
                          )}
                        </Group>
                      </Group>
                    ))}
                </Stack>
              )}
            </QueryState>
          )}
        </Stack>
      </Collapse>
    </Paper>
  );
}

function PeriodEditor({
  schoolId,
  periodId,
  gradeClasses,
  onDeleted,
}: {
  schoolId: string;
  periodId: string;
  gradeClasses: ScopeClass[];
  onDeleted: () => void;
}) {
  const timetable = usePeriodTimetable(schoolId, periodId);
  const [settings, setSettings] = useState(false);
  return (
    <QueryState query={timetable}>
      {(data) => (
        <Stack gap="sm">
          <Group justify="space-between" wrap="nowrap">
            <Stack gap={2} style={{ minWidth: 0 }}>
              <Text fw={700} truncate>
                {data.period.name}
              </Text>
              <Text size="xs" c="dimmed">
                {PERIOD_KIND_SHORT[data.period.kind]}
                {data.period.firstDate &&
                  ` · ${formatDate(data.period.firstDate)} - ${formatDate(data.period.lastDate)}`}
              </Text>
            </Stack>
            <Button
              size="compact-sm"
              variant="default"
              leftSection={<IconEdit size={14} />}
              onClick={() => setSettings(true)}
            >
              تعديل
            </Button>
          </Group>
          <TimetableForm key={data.period.id} schoolId={schoolId} timetable={data} gradeClasses={gradeClasses} />
          <PublishSwitch schoolId={schoolId} period={data.period} />
          {data.period.subjectCount > 0 && (
            <ResultsReview schoolId={schoolId} period={data.period} gradeClasses={gradeClasses} />
          )}
          <PeriodSettingsModal
            schoolId={schoolId}
            period={data.period}
            opened={settings}
            onClose={() => setSettings(false)}
            onDeleted={() => {
              setSettings(false);
              onDeleted();
            }}
          />
        </Stack>
      )}
    </QueryState>
  );
}

// ───────────────────────────── Page ─────────────────────────────

function PeriodPicker({
  schoolId,
  gradeLevelId,
  gradeClasses,
  periodId,
  onChange,
}: {
  schoolId: string;
  gradeLevelId: string;
  gradeClasses: ScopeClass[];
  periodId: string | null;
  onChange: (periodId: string | null) => void;
}) {
  const periods = usePeriods(schoolId, gradeLevelId);
  const [creating, setCreating] = useState(false);
  return (
    <QueryState query={periods}>
      {(list) => {
        // The period in the URL when it belongs to this grade level, else the newest one.
        const selected = list.find((p) => p.id === periodId) ?? list[0];
        if (creating || !selected) {
          return (
            <NewPeriodForm
              schoolId={schoolId}
              gradeLevelId={gradeLevelId}
              onCreated={(p) => {
                setCreating(false);
                onChange(p.id);
              }}
              onCancel={list.length ? () => setCreating(false) : undefined}
            />
          );
        }
        return (
          <Stack gap="md">
            <Group gap="xs" align="flex-end" wrap="nowrap">
              <Select
                label="الامتحان"
                style={{ flex: 1 }}
                data={list.map((p) => ({
                  value: p.id,
                  label: `${p.name} (${PERIOD_KIND_SHORT[p.kind]})${p.resultsPublishedAt ? ' — منشورة' : ''}`,
                }))}
                value={selected.id}
                onChange={onChange}
                allowDeselect={false}
                comboboxProps={{ withinPortal: true }}
              />
              <Button variant="light" leftSection={<IconPlus size={16} />} onClick={() => setCreating(true)}>
                جديد
              </Button>
            </Group>
            <PeriodEditor
              key={selected.id}
              schoolId={schoolId}
              periodId={selected.id}
              gradeClasses={gradeClasses}
              onDeleted={() => onChange(null)}
            />
          </Stack>
        );
      }}
    </QueryState>
  );
}

/** S12 — grade level, exam (create or pick), one row per subject with date + max score, publish switch. */
export function ExamTimetableBuilderPage() {
  const schoolId = useSchoolId();
  const scope = useScope(schoolId);
  const canManage = useCanManageExams(schoolId);
  const grades = useGrades(schoolId);
  const [params, setParams] = useSearchParams();
  // The grade level in the URL when it is in scope, else the first one.
  const grade = grades.find((g) => g.id === params.get('gradeLevelId')) ?? grades[0];

  const setParam = (next: { gradeLevelId?: string | null; periodId?: string | null }) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        for (const [key, v] of Object.entries(next)) {
          if (v) p.set(key, v);
          else p.delete(key);
        }
        return p;
      },
      { replace: true },
    );

  return (
    <MobilePage title="اضافة/تعديل جدول إمتحان" backTo={`/s/${schoolId}/exams`}>
      {scope.isLoading ? (
        <PageLoader />
      ) : !canManage ? (
        <Alert color="orange" icon={<IconAlertTriangle />} title="غير مسموح">
          جداول الامتحانات يضيفها المدير أو المشرف.
        </Alert>
      ) : !grade ? (
        <EmptyState message="لا توجد فصول في العام الدراسي الحالي" />
      ) : (
        <Stack gap="md">
          <Select
            label="الصف"
            data={grades.map((g) => ({ value: g.id, label: g.name }))}
            value={grade.id}
            onChange={(v) => setParam({ gradeLevelId: v, periodId: null })}
            allowDeselect={false}
            comboboxProps={{ withinPortal: true }}
          />
          <PeriodPicker
            key={grade.id}
            schoolId={schoolId}
            gradeLevelId={grade.id}
            gradeClasses={grade.classes}
            periodId={params.get('periodId')}
            onChange={(id) => setParam({ periodId: id })}
          />
        </Stack>
      )}
    </MobilePage>
  );
}

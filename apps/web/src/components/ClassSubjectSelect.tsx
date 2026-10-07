import { useEffect, useRef } from 'react';
import { Group, Select } from '@mantine/core';
import { useScope } from '../api/hooks';

/**
 * "اختر الفصل/الصف" + "اختر المادة" pickers fed by the staff scope (teachers see only their classes/subjects).
 * Changing the class clears a subject that is not offered in the new class.
 * `autoSelect` picks the first class (and its first subject) once on entry when nothing is selected,
 * so a teacher with one class lands straight on its data.
 */
export function ClassSubjectSelect({
  schoolId,
  classId,
  subjectId,
  onChange,
  withSubject = true,
  required = false,
  clearable = false,
  autoSelect = false,
}: {
  schoolId: string;
  classId: string | null;
  subjectId?: string | null;
  onChange: (next: { classId: string | null; subjectId: string | null }) => void;
  withSubject?: boolean;
  required?: boolean;
  clearable?: boolean;
  autoSelect?: boolean;
}) {
  const scope = useScope(schoolId);
  const classes = scope.data?.classes ?? [];
  const autoDone = useRef(false);
  useEffect(() => {
    if (!autoSelect || autoDone.current || !scope.data) return;
    autoDone.current = true;
    const first = scope.data.classes[0];
    if (!classId && first) {
      onChange({ classId: first.id, subjectId: withSubject ? (first.subjects[0]?.id ?? null) : null });
    }
  }, [autoSelect, scope.data, classId, withSubject, onChange]);
  const selected = classes.find((c) => c.id === classId);
  const subjects = selected?.subjects ?? [];
  return (
    <Group grow align="flex-end" gap="xs">
      <Select
        label="الفصل / الصف"
        placeholder="اختر الفصل/الصف"
        data={classes.map((c) => ({ value: c.id, label: c.label }))}
        value={classId}
        onChange={(v) => {
          const next = classes.find((c) => c.id === v);
          const keep = next?.subjects.some((s) => s.id === subjectId) ? (subjectId ?? null) : null;
          onChange({ classId: v, subjectId: keep });
        }}
        required={required}
        clearable={clearable}
        searchable
        nothingFoundMessage="لا توجد فصول"
        disabled={scope.isLoading}
        comboboxProps={{ withinPortal: true }}
      />
      {withSubject && (
        <Select
          label="المادة"
          placeholder="اختر المادة"
          data={subjects.map((s) => ({ value: s.id, label: s.name }))}
          value={subjectId ?? null}
          onChange={(v) => onChange({ classId, subjectId: v })}
          required={required}
          clearable={clearable}
          disabled={!classId}
          nothingFoundMessage="لا توجد مواد"
          comboboxProps={{ withinPortal: true }}
        />
      )}
    </Group>
  );
}

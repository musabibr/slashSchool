import { Select } from '@mantine/core';
import { WEEKDAY_LABELS } from '@slash/shared';
import { SCHOOL_DAYS } from './api';

const OPTIONS = SCHOOL_DAYS.map((d) => ({ value: String(d), label: WEEKDAY_LABELS[d] }));

/** "اليوم" picker: Sunday … Thursday, plus Saturday. */
export function DaySelect({ value, onChange }: { value: number; onChange: (weekday: number) => void }) {
  return (
    <Select
      label="اليوم"
      data={OPTIONS}
      value={String(value)}
      onChange={(v) => v !== null && onChange(Number(v))}
      allowDeselect={false}
      comboboxProps={{ withinPortal: true }}
    />
  );
}

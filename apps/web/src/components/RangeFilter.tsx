import { SegmentedControl } from '@mantine/core';
import type { DateRange } from '@slash/shared';

const OPTIONS: Array<{ value: DateRange; label: string }> = [
  { value: 'today', label: 'اليوم' },
  { value: 'week', label: 'هذا الأسبوع' },
  { value: 'month', label: 'هذا الشهر' },
  { value: 'all', label: 'الكل' },
];

/** Today / This week / This month / All filter (P5, P7). */
export function RangeFilter({ value, onChange }: { value: DateRange; onChange: (v: DateRange) => void }) {
  return (
    <SegmentedControl
      fullWidth
      size="xs"
      radius="md"
      value={value}
      onChange={(v) => onChange(v as DateRange)}
      data={OPTIONS}
    />
  );
}
